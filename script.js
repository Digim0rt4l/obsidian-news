const FEED_URL = "feed.json";

const state = {
  posts: [],
  page: 1,
  pageSize: 9,
  filtered: []
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const fmtDate = (iso) =>
  new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit"
  });

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const fallback = () => {
  const now = new Date().toISOString();
  return {
    site: { title: "Obsidian News", description: "AI Tech News" },
    posts: [
      {
        id: "sample-1",
        slug: "welcome-to-obsidian-news",
        title: "Welcome to Obsidian News",
        date: now,
        excerpt:
          "This is a sample post. Connect your scheduled writer to generate new AI-written technology articles every 6 hours.",
        html:
          "<p>Obsidian News is a static, zero-backend blog focused solely on technology. Your scheduled writer will fetch tech headlines and draft articles that are appended to a feed.json in your repo, then Netlify redeploys—no servers required.</p><h2>How it works</h2><ul><li>GitHub Action runs every 6 hours</li><li>Generates a new technology article with OpenAI</li><li>Commits changes to the repo</li><li>Netlify serves the updated static site</li></ul>"
      }
    ]
  };
};

const loadFeed = async () => {
  try {
    const r = await fetch(FEED_URL, { cache: "no-store" });
    if (!r.ok) throw new Error("no feed");
    const data = await r.json();
    return data;
  } catch (e) {
    return fallback();
  }
};

const renderList = () => {
  const wrap = $("#articles");
  wrap.innerHTML = "";
  const start = (state.page - 1) * state.pageSize;
  const end = start + state.pageSize;
  const list = state.filtered.length ? state.filtered : state.posts;
  const items = list.slice(start, end);
  items.forEach((p) => {
    const a = document.createElement("a");
    a.className = "card";
    a.href = `?p=${encodeURIComponent(p.slug)}`;
    a.innerHTML = `<h3>${p.title}</h3><p>${p.excerpt || ""}</p><div class="meta"><span>${fmtDate(p.date)}</span><span class="tag">Tech</span></div>`;
    wrap.appendChild(a);
  });
  $("#loadMore").style.display = list.length > end ? "block" : "none";
};

const renderPost = (p) => {
  const el = $("#post");
  el.innerHTML = `<h1>${p.title}</h1><div class="post-meta">${fmtDate(
    p.date
  )}</div><div class="content">${p.html}</div>`;
  document.title = `${p.title} — Obsidian News`;
};

const route = () => {
  const url = new URL(location.href);
  const slug = url.searchParams.get("p");
  const show = (id) => {
    $$("#homeView,#postView,#aboutView").forEach((x) => x.classList.add("hidden"));
    $(id).classList.remove("hidden");
  };
  if (slug) {
    const p = state.posts.find((x) => x.slug === slug);
    if (p) {
      renderPost(p);
      show("#postView");
    } else {
      show("#homeView");
    }
  } else {
    document.title = "Obsidian News — AI-Written Tech News";
    show("#homeView");
  }
};

const filter = (term) => {
  const t = term.trim().toLowerCase();
  state.page = 1;
  if (!t) {
    state.filtered = [];
    renderList();
    return;
  }
  state.filtered = state.posts.filter((p) => {
    const text = [p.title, p.excerpt, (p.html || "").replace(/<[^>]+>/g, " ")].join(" ");
    return text.toLowerCase().includes(t);
  });
  renderList();
};

const bind = () => {
  $("#q").addEventListener("input", (e) => filter(e.target.value));
  $("#loadMore").addEventListener("click", () => {
    state.page += 1;
    renderList();
  });
  $("#aboutLink").addEventListener("click", (e) => {
    e.preventDefault();
    $$("#homeView,#postView").forEach((x) => x.classList.add("hidden"));
    $("#aboutView").classList.remove("hidden");
  });
  window.addEventListener("popstate", route);
  document.body.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="?p="]');
    if (a) {
      e.preventDefault();
      history.pushState({}, "", a.getAttribute("href"));
      route();
    }
  });
};

const boot = async () => {
  const data = await loadFeed();
  state.posts = (data.posts || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  renderList();
  bind();
  route();
};

boot();
