import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import OpenAI from "openai"
import Parser from "rss-parser"

const FEED_FILE=path.join(process.cwd(),"feed.json")
const MAX_POSTS=500
const FEEDS=[
  "https://hnrss.org/frontpage",
  "https://www.techmeme.com/feed.xml",
  "https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml"
]

function requireEnv(name){
  const v=process.env[name]
  if(!v){console.error(`Missing required env: ${name}`); process.exit(1)}
  return v
}

const client=new OpenAI({apiKey:requireEnv("OPENAI_API_KEY")})
const parser=new Parser()
const slugify=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"")
const nowISO=()=>new Date().toISOString()

async function readFeed(){
  try{
    const raw=await fs.readFile(FEED_FILE,"utf8")
    return JSON.parse(raw)
  }catch{
    return {site:{title:"Obsidian News"},posts:[]}
  }
}

async function writeFeed(feed){
  const trimmed={...feed,posts:feed.posts.slice(0,MAX_POSTS)}
  await fs.writeFile(FEED_FILE,JSON.stringify(trimmed,null,2))
}

async function fetchCandidates(){
  const items=[]
  for(const url of FEEDS){
    try{
      const feed=await parser.parseURL(url)
      for(const it of feed.items||[]){
        const title=it.title||""
        const summary=(it.contentSnippet||it.content||it.summary||"").toString()
        const link=it.link||""
        const t=it.isoDate||it.pubDate||nowISO()
        items.push({title,summary,link,date:new Date(t).toISOString()})
      }
    }catch(e){
      console.warn("RSS error:", url, e.message||e)
    }
  }
  items.sort((a,b)=>new Date(b.date)-new Date(a.date))
  return items
}

async function classifyTech(title,summary){
  const gate=`You are a strict gate for technology news only. Input is title and summary. Return exactly one token: TECH or NOT_TECH. TECH = software, hardware, AI/ML, chips, security, cloud, dev tools, web/mobile, VR/AR, enterprise IT, open-source, consumer gadgets, telecom, data infra, robotics (product/industry focused). NOT_TECH = general science/medicine/climate/astronomy/biology/space research unless tied to a shipping tech product/platform.

Title: ${title}
Summary: ${summary}
Answer:`
  try{
    const r=await client.responses.create({model:"gpt-4.1-mini",input:gate})
    const out=(r.output_text||"").trim().toUpperCase()
    return out.startsWith("TECH")
  }catch(e){
    console.warn("Classifier error:", e.message||e)
    return true
  }
}

async function draftArticle(title,summary,link){
  const prompt=[{role:"user",content:`Write a 600–850 word technology news article for a professional audience based on the item below. Focus on verified facts, product impact, developer relevance, and industry context. Exclude general science angles. Include a short, clear title and a 1–2 sentence excerpt. Return JSON only with keys: title, excerpt, html. The html should use <p>, <h2>, and <ul>/<li> where helpful. Do not include external scripts or images.

Source title: ${title}
Source summary: ${summary}
Source link: ${link}`}]
  const r=await client.responses.create({
    model:"gpt-4.1",
    input:prompt,
    text:{format:{type:"json_object"}}
  })
  const obj=JSON.parse(r.output_text)
  return {title:obj.title,excerpt:obj.excerpt,html:obj.html}
}

async function main(){
  try{
    const feed=await readFeed()
    const existingTitles=new Set(feed.posts.map(p=>p.title))
    const candidates=await fetchCandidates()
    if(!candidates.length){console.error("No RSS candidates fetched"); return}

    let picked=null
    for(const c of candidates){
      if(!c.title || existingTitles.has(c.title)) continue
      const ok=await classifyTech(c.title,c.summary||"")
      if(ok){picked=c;break}
    }
    if(!picked){console.log("No new tech candidate found"); return}

    let art
    try{
      art=await draftArticle(picked.title,picked.summary||"",picked.link||"")
    }catch(e){
      console.error("Article generation failed:", e.message||e)
      return
    }

    const slug=slugify(art.title)
    if(feed.posts.some(p=>p.slug===slug)){console.log("Duplicate slug, skipping");return}

    const post={
      id:crypto.randomUUID(),
      slug,
      title:art.title,
      date:nowISO(),
      excerpt:art.excerpt,
      html:art.html
    }
    feed.posts.unshift(post)
    await writeFeed(feed)
    console.log("Wrote:",post.title)
  }catch(e){
    console.error("Fatal error:", e.stack||e.message||e)
  }
}
main()
