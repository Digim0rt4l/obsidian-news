import fs from "fs/promises";
import path from "path";

const SITE = "https://obsidian-news.com";
const FEED_FILE = path.join(process.cwd(), "feed.json");
const SITEMAP_FILE = path.join(process.cwd(), "sitemap.xml");

function isoToLastmod(iso){
  if(!iso) return null;
  try{
    const d=new Date(iso);
    return d.toISOString().replace(".000Z","+00:00");
  }catch{return null}
}

async function build(){
  const raw = await fs.readFile(FEED_FILE,"utf8");
  const data = JSON.parse(raw);
  const posts = Array.isArray(data.posts)?data.posts:[];
  const urls = [];

  urls.push({loc: `${SITE}/`, lastmod: posts[0]?.date || new Date().toISOString()});

  for(const p of posts){
    if(!p || !p.slug) continue;
    urls.push({loc: `${SITE}/articles/${p.slug}/`, lastmod: p.date || null});
  }

  const items = urls.map(u=>{
    const last = u.lastmod ? `<lastmod>${isoToLastmod(u.lastmod)}</lastmod>` : "";
    return `<url><loc>${u.loc}</loc>${last}</url>`;
  }).join("");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>`+
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`+
    items+
    `</urlset>`;

  await fs.writeFile(SITEMAP_FILE, xml);
  console.log("Wrote sitemap:", urls.length);
}

build().catch(e=>{console.error("sitemap error:", e?.message||e); process.exit(1)});
