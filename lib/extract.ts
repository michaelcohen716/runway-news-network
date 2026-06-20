/**
 * Step 1 — Article extraction (robust, multi-strategy).
 *
 * News sites block bots, paywall content, and render client-side, so a single
 * fetch is fragile. We try a chain of independent strategies and keep the first
 * result with enough body text (falling back to the longest if none clear the
 * bar):
 *
 *   1. Direct fetch + Readability (with JSON-LD `articleBody` as a backstop)
 *   2. Jina Reader (r.jina.ai) — keyless, renders JS, returns clean text
 *   3. Wayback Machine — the most recent archived snapshot (beats paywalls)
 *   4. ScraperAPI — paid renderer, only if SCRAPER_API_KEY is set
 *
 * Each strategy is isolated: a failure or thin result just advances the chain.
 */
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import type { Article } from "@/lib/types";

/** Machine-readable failure category so the UI can show a clear label. */
export type ExtractCode = "paywall" | "not_found" | "unreadable" | "network" | "invalid_url";

/** An extraction failure carrying a category + a user-facing message. */
export class ExtractionError extends Error {
  constructor(
    readonly code: ExtractCode,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Browser-ish headers reduce naive bot blocking on direct fetches. */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent": UA,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

/** Characters of body text we consider a clean, complete extraction. */
const MIN_BODY_CHARS = 600;
/** Floor below which a result is too thin to script a segment from. */
const USABLE_BODY_CHARS = 350;
/** Per-request timeout so one slow strategy can't stall the pipeline. */
const FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    headers: BROWSER_HEADERS,
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** One retry with backoff for transient throttling (429 / 503). */
async function fetchJsonWithRetry(url: string): Promise<Response> {
  let res = await fetchWithTimeout(url);
  if (res.status === 429 || res.status === 503) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await fetchWithTimeout(url);
  }
  return res;
}

/**
 * Detect bot-walls and error pages that masquerade as long "articles" (e.g. an
 * AP "Page unavailable" shell or a Cloudflare challenge). These slip past a
 * naive length check, so reject them before they poison the script stage.
 */
const ERROR_TITLE = /\b(page (not found|unavailable)|404|403|access denied|forbidden|are you a (robot|human)|attention required|just a moment|enable javascript|please verify|subscribe to (read|continue)|sign in to (read|continue))\b/i;
const ERROR_BODY = /(enable javascript( and cookies)? to continue|verify you are (a )?human|checking your browser|you have been blocked|access to this page has been denied|to continue, please)/i;

function rejectIfErrorPage(article: Article): Article {
  const head = article.body.slice(0, 500);
  if (ERROR_TITLE.test(article.title) || ERROR_BODY.test(head)) {
    throw new Error(`looks like an error/bot wall ("${article.title.slice(0, 60)}")`);
  }
  return article;
}

/** Pull a NewsArticle `articleBody` out of JSON-LD, if present. */
function jsonLdArticle(doc: Document): { title?: string; body?: string; date?: string; byline?: string } | null {
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  const candidates: Record<string, unknown>[] = [];
  for (const s of scripts) {
    try {
      const data = JSON.parse(s.textContent ?? "");
      const items = Array.isArray(data) ? data : data["@graph"] ?? [data];
      for (const it of Array.isArray(items) ? items : [items]) {
        if (it && typeof it === "object") candidates.push(it as Record<string, unknown>);
      }
    } catch {
      /* skip malformed JSON-LD blocks */
    }
  }
  const isArticle = (t: unknown) => {
    const types = Array.isArray(t) ? t : [t];
    return types.some((x) => typeof x === "string" && /article/i.test(x));
  };
  const node = candidates.find((c) => isArticle(c["@type"]) && typeof c["articleBody"] === "string");
  if (!node) return null;
  const author = node["author"] as { name?: string } | { name?: string }[] | undefined;
  const byline = Array.isArray(author) ? author[0]?.name : author?.name;
  return {
    title: typeof node["headline"] === "string" ? node["headline"] : undefined,
    body: (node["articleBody"] as string).trim(),
    date: typeof node["datePublished"] === "string" ? node["datePublished"] : undefined,
    byline,
  };
}

/** Readability over a jsdom DOM, with JSON-LD as a backstop for thin bodies. */
function parseHtml(html: string, url: string): Article {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const metaImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? undefined;
  const metaSite =
    doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ?? undefined;
  const metaDate =
    doc.querySelector('meta[property="article:published_time"]')?.getAttribute("content") ??
    doc.querySelector("time[datetime]")?.getAttribute("datetime") ??
    undefined;

  const ld = jsonLdArticle(doc);

  let parsed: ReturnType<Readability["parse"]> = null;
  try {
    parsed = new Readability(doc).parse();
  } catch {
    /* Readability can throw on odd DOMs — fall back to JSON-LD below */
  }

  const readBody = (parsed?.textContent ?? "").replace(/\s+\n/g, "\n").trim();
  // Prefer whichever source gave us more text.
  const body = (ld?.body?.length ?? 0) > readBody.length ? ld!.body! : readBody;

  if (!body) throw new Error("no article body found");

  return {
    url,
    title: parsed?.title?.trim() || ld?.title?.trim() || doc.title || "Untitled",
    body,
    byline: parsed?.byline?.trim() || ld?.byline || undefined,
    publishedAt: metaDate ?? ld?.date,
    leadImage: metaImage,
    siteName: parsed?.siteName?.trim() || metaSite,
  };
}

/** Jina Reader: keyless readable-text proxy that also renders client-side pages. */
async function fetchViaJina(url: string): Promise<Article> {
  const headers: Record<string, string> = { Accept: "text/plain" };
  if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  const res = await fetchWithTimeout(`https://r.jina.ai/${url}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // Default Jina format: "Title: ...\nURL Source: ...\nMarkdown Content:\n<body>"
  const titleMatch = text.match(/^Title:\s*(.+)$/m);
  const dateMatch = text.match(/^Published Time:\s*(.+)$/m);
  const split = text.split(/^Markdown Content:\s*$/m);
  const body = (split[1] ?? text)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // links → text
    .replace(/\s+\n/g, "\n")
    .trim();
  if (!body) throw new Error("empty reader response");

  return {
    url,
    title: titleMatch?.[1]?.trim() || "Untitled",
    body,
    publishedAt: dateMatch?.[1]?.trim(),
  };
}

/** Most recent Wayback Machine snapshot — often has full text behind paywalls. */
async function fetchViaWayback(url: string): Promise<Article> {
  const api = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
  const res = await fetchJsonWithRetry(api);
  if (!res.ok) throw new Error(`availability HTTP ${res.status}`);
  const data = (await res.json()) as {
    archived_snapshots?: { closest?: { available?: boolean; url?: string } };
  };
  const snap = data.archived_snapshots?.closest;
  if (!snap?.available || !snap.url) throw new Error("no snapshot available");
  // `id_` serves the raw archived page without the Wayback toolbar injection.
  const rawUrl = snap.url.replace(/(\/web\/\d+)\//, "$1id_/");
  return parseHtml(await fetchHtml(rawUrl), url);
}

/** ScraperAPI fallback (renders JS); only when a key is configured. */
async function fetchViaScraper(url: string): Promise<Article> {
  if (!env.SCRAPER_API_KEY) throw new Error("no SCRAPER_API_KEY configured");
  const endpoint = `https://api.scraperapi.com/?api_key=${env.SCRAPER_API_KEY}&render=true&url=${encodeURIComponent(url)}`;
  const res = await fetchWithTimeout(endpoint, {}, 60_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseHtml(await res.text(), url);
}

export async function extractArticle(url: string): Promise<Article> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ExtractionError("invalid_url", "That doesn’t look like a valid link.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ExtractionError("invalid_url", "Only http(s) links are supported.");
  }

  const strategies: { name: string; run: () => Promise<Article> }[] = [
    { name: "direct", run: async () => parseHtml(await fetchHtml(url), url) },
    { name: "jina-reader", run: () => fetchViaJina(url) },
    { name: "wayback", run: () => fetchViaWayback(url) },
  ];
  if (env.SCRAPER_API_KEY) {
    strategies.push({ name: "scraperapi", run: () => fetchViaScraper(url) });
  }

  let best: Article | null = null;
  const failures: string[] = [];
  let sawBlocked = false; // 401/403/451 → paywall / bot wall
  let sawThin = false; // got the page but couldn't read enough text
  let sawAnyPage = false; // at least one strategy returned HTTP 200

  for (const { name, run } of strategies) {
    try {
      const article = rejectIfErrorPage(await run());
      sawAnyPage = true;
      const len = article.body.length;
      if (len > (best?.body.length ?? 0)) best = article;
      if (len >= MIN_BODY_CHARS) {
        log.info(`extraction: "${name}" succeeded (${len} chars)`);
        return article;
      }
      sawThin = true;
      log.warn(`extraction: "${name}" returned thin body (${len} chars), trying next`);
      failures.push(`${name}: thin (${len} chars)`);
    } catch (err) {
      const msg = (err as Error).message;
      if (/HTTP 40[13]|HTTP 451|bot wall/i.test(msg)) sawBlocked = true;
      if (/HTTP 200|bot wall|thin/i.test(msg)) sawAnyPage = true;
      log.warn(`extraction: "${name}" failed (${msg})`);
      failures.push(`${name}: ${msg}`);
    }
  }

  // Nothing cleared the bar — return the best partial if it's usable at all.
  if (best && best.body.length >= USABLE_BODY_CHARS) {
    log.warn(`extraction: using best partial result (${best.body.length} chars)`);
    return best;
  }

  const detail = failures.join("; ");
  if (sawBlocked) {
    throw new ExtractionError(
      "paywall",
      "This source is paywalled or blocking automated reading. Try a freely accessible link.",
      detail,
    );
  }
  if (sawThin || sawAnyPage) {
    throw new ExtractionError(
      "unreadable",
      "We couldn’t pull enough readable text from this page. Try a direct article link.",
      detail,
    );
  }
  if (failures.every((f) => /HTTP 404/.test(f))) {
    throw new ExtractionError("not_found", "That page couldn’t be found (404). Check the link.", detail);
  }
  throw new ExtractionError(
    "network",
    "We couldn’t reach that page. Check the link or try again.",
    detail,
  );
}
