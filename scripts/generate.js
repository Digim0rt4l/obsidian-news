import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import OpenAI from "openai";
import Parser from "rss-parser";

const FEED_FILE = path.join(process.cwd(), "feed.json");
const MAX_POSTS = 500;
const FEEDS = [
  "https://hnrss.org/frontpage",
  "https://www.theverge.com/rss/index.xml",
  "https://feeds.arstechnica.com/arstechnica/technology-lab",
  "https://techcrunch.com/feed/",
  "https://9to5mac.com/feed/",
  "https://feeds.macrumors.com/MacRumors-All"
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

const client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

function sanitizeToASCII(text) {
  if (!text) return text;
  text = text.normalize("NFKC");
  const replacements = [
    [/[\u201C\u201D\u2033\u2036\u3003]/g, '"'],
    [/[\u2018\u2019\u2032\u2035]/g, "'"],
    [/[\u00AB\u00BB\u2039\u203A]/g, '"'],
    [/[\u2013\u2014\u2015\u2212]/g, "-"],
    [/[\u2022\u2023\u2043]/g, "*"],
    [/[\u2026]/g, "..."],
    [/[\u00A0]/g, " "],
    [/[\u2000-\u200B]/g, " "],
    [/[\u202F\u205F]/g, " "],
    [/[\u00D7]/g, "x"],
    [/[\u00F7]/g, "/"],
    [/[\u2122]/g, " (TM)"],
    [/[\u00AE]/g, " (R)"],
    [/[\u00A9]/g, " (C)"]
  ];
  for (const [r, rep] of replacements) text = text.replace(r, rep);
  text = text.replace(/[\u0000-\u001F\u007F]/g, "");
  text = text.replace(/[^\x00-\x7F]/g, "");
  return text;
}

async function getLatestFirefoxVersion() {
  try {
    const res = await fetch("https://product-details.mozilla.org/1.0/firefox_versions.json");
    if (!res.ok) return null;
    const json = await res.json();
    return json.LATEST_FIREFOX_VERSION || null;
  } catch {
    return null;
  }
}

async function getUbuntuVersion() {
  try {
    const data = await fs.readFile("/etc/os-release", "utf8");
    const match = data.match(/VERSION_ID="([^"]+)"/);
    if (match) return match[1];
  } catch {}
  return null;
}

async function buildUserAgent() {
  const firefox = await getLatestFirefoxVersion();
  if (!firefox) return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Safari/537.36";
  const ubuntu = await getUbuntuVersion();
  if (ubuntu) return `Mozilla/5.0 (X11; Ubuntu/${ubuntu}; Linux x86_64; rv:${firefox}) Gecko/20100101 Firefox/${firefox}`;
  return `Mozilla/5.0 (X11; Linux x86_64; rv:${firefox}) Gecko/20100101 Firefox/${firefox}`;
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const nowISO = () => new Date().toISOString();

async function readFeed() {
  try {
    const raw = await fs.readFile(FEED_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return { site: { title: "Obsidian News" }, posts: [] };
  }
}

async function writeFeed(feed) {
  const trimmed = { ...feed, posts: feed.posts.slice(0, MAX_POSTS) };
  await fs.writeFile(FEED_FILE, JSON.stringify(trimmed, null, 2));
}

async function fetchCandidates(parser) {
  const items = [];
  for (const url of FEEDS) {
    try {
      const feed = await parser.parseURL(url);
      for (const it of feed.items || []) {
        const title = it.title || "";
        const summary = (it.contentSnippet || it.content || it.summary || "").toString();
        const link = it.link || "";
        const t = it.isoDate || it.pubDate || nowISO();
        items.push({
          title,
          summary,
          link,
          date: new Date(t).toISOString()
        });
      }
    } catch (e) {
      console.warn("RSS error:", url, e.message || e);
    }
  }
  items.sort((a, b) => new Date(b.date) - new Date(a.date));
  return items;
}

async function classifyTech(title, summary) {
  const gate = `You are a strict gate for technology news only. Input is title and summary. Return exactly one token: TECH or NOT_TECH. TECH = software, hardware, AI/ML, chips, security, cloud, dev tools, web/mobile, VR/AR, enterprise IT, open-source, consumer gadgets, telecom, data infra, robotics (product/industry focused). NOT_TECH = general science/medicine/climate/astronomy/biology/space research unless tied to a shipping tech product/platform.

Title: ${title}
Summary: ${summary}
Answer:`;
  try {
    const r = await client.responses.create({ model: "gpt-5.1", input: gate });
    const out = (r.output_text || "").trim().toUpperCase();
    return out.startsWith("TECH");
  } catch (e) {
    console.warn("Classifier error:", e.message || e);
    return true;
  }
}

async function draftArticle(title, summary, link) {
  const prompt = [
    {
      role: "user",
      content: `Write a 600-850 word technology news article for a professional audience based on the item below. Focus on verified facts, product impact, developer relevance, and industry context. Exclude general science angles. Include a short, clear title and a 1-2 sentence excerpt. Return JSON only with keys: title, excerpt, html. The html should use <p>, <h2>, and <ul>/<li> where helpful. Do not include external scripts or images. Use only plain ASCII characters for all output.

Source title: ${title}
Source summary: ${summary}
Source link: ${link}`
    }
  ];
  const r = await client.responses.create({
    model: "gpt-5.1",
    input: prompt,
    text: { format: { type: "json_object" } }
  });
  const obj = JSON.parse(r.output_text);
  return { title: obj.title, excerpt: obj.excerpt, html: obj.html };
}

async function main() {
  try {
    const feed = await readFeed();
    const existingTitles = new Set(feed.posts.map((p) => p.title));

    const userAgent = await buildUserAgent();
    const parser = new Parser({
      requestOptions: {
        headers: {
          "User-Agent": userAgent,
          "Accept": "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8"
        }
      }
    });

    const candidates = await fetchCandidates(parser);
    console.log("candidates", candidates.length);
    if (!candidates.length) {
      console.error("No RSS candidates fetched");
      return;
    }

    let picked = null;
    for (const c of candidates) {
      if (!c.title) {
        console.log("skip: empty title");
        continue;
      }
      if (existingTitles.has(c.title)) {
        console.log("skip: dup title", c.title);
        continue;
      }
      const ok = await classifyTech(c.title, c.summary || "");
      if (!ok) {
        console.log("skip: not tech", c.title);
        continue;
      }
      picked = c;
      console.log("picked:", c.title);
      break;
    }

    if (!picked) {
      console.log("No new tech candidate found");
      return;
    }

    let art;
    try {
      art = await draftArticle(picked.title, picked.summary || "", picked.link || "");
    } catch (e) {
      console.error("Article generation failed:", e.message || e);
      return;
    }

    art.title = sanitizeToASCII(art.title);
    art.excerpt = sanitizeToASCII(art.excerpt);
    art.html = sanitizeToASCII(art.html);

    const slug = slugify(art.title);
    if (feed.posts.some((p) => p.slug === slug)) {
      console.log("Duplicate slug, skipping");
      return;
    }

    const post = {
      id: crypto.randomUUID(),
      slug,
      title: art.title,
      date: nowISO(),
      excerpt: art.excerpt,
      html: art.html
    };

    console.log("writing post:", post.slug);
    feed.posts.unshift(post);
    await writeFeed(feed);
    console.log("Wrote:", post.title);
  } catch (e) {
    console.error("Fatal error:", e.stack || e.message || e);
  }
}

main();
