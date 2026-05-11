import type { ChapterPages, ChapterSummary, MangaDetail, MangaSource, MangaSummary, SearchOptions } from "./types";
import { absoluteUrl, decodeHtml, htmlAttribute, requestHtml, unique } from "./html";

const SITE_BASE = "https://projectsuki.com";
const SOURCE_ID = "projectsuki";

function idFromHref(href: string) {
  return href.match(/\/book\/(\d+)/i)?.[1] ?? href.replace(/\/$/, "").split("/").filter(Boolean).pop() ?? href;
}

function chapterIdFromHref(href: string) {
  const match = href.match(/\/read\/(\d+)\/(\d+)\/\d+/i);
  return match ? `${match[1]}:${match[2]}` : href;
}

function chapterParts(id: string) {
  const [mangaId, chapterId] = id.split(":");
  if (!mangaId || !chapterId) throw new Error("ProjectSuki chapter id is invalid.");
  return { mangaId, chapterId };
}

function chapterNumberFromText(value?: string) {
  return decodeHtml(value).match(/chapter\s+([0-9]+(?:\.[0-9]+)?)/i)?.[1];
}

function sourcePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function parseDate(value?: string) {
  const text = decodeHtml(value);
  if (!text) return undefined;
  const titleDate = text.match(/title=["']([^"']+)["']/i)?.[1];
  if (titleDate) {
    const [day, month, year] = titleDate.split("-").map(Number);
    if (day && month && year) return new Date(Date.UTC(year, month - 1, day)).toISOString();
  }
  const relative = text.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms =
      unit === "minute" ? 60_000 :
      unit === "hour" ? 3_600_000 :
      unit === "day" ? 86_400_000 :
      unit === "week" ? 604_800_000 :
      unit === "month" ? 2_592_000_000 :
      31_536_000_000;
    return new Date(Date.now() - amount * ms).toISOString();
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parseStatus(value?: string) {
  const status = decodeHtml(value).toLowerCase();
  if (!status) return undefined;
  if (status === "ongoing") return "ongoing";
  return status;
}

function parseBrowseCards(html: string, limit: number, offset: number): MangaSummary[] {
  const cards = [...html.matchAll(/<div[^>]+class=["'][^"']*\bbrowse\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["'][^"']*\bbrowse\b|<div[^>]+class=["'][^"']*pagination\b|<\/main>)/gi)];
  return cards
    .map((match): MangaSummary | undefined => {
      const block = match[1];
      const href = block.match(/<a[^>]+href=["']([^"']*\/book\/\d+[^"']*)["'][^>]*>/i)?.[1];
      const title = decodeHtml(block.match(/<h[45][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? htmlAttribute(block.match(/<img[^>]+>/i)?.[0] ?? "", "alt"));
      if (!href || !title) return undefined;
      return {
        source: SOURCE_ID,
        id: idFromHref(href),
        title,
        description: decodeHtml(block.match(/Status:[\s\S]*?<\/div>\s*<div>\s*([\s\S]*?)(?:<a[^>]*>Show more<\/a>|<\/div>)/i)?.[1]),
        coverUrl: absoluteUrl(SITE_BASE, htmlAttribute(block.match(/<img[^>]+>/i)?.[0] ?? "", "src")),
        status: parseStatus(block.match(/Status:\s*([^<]+)/i)?.[1]),
        tags: []
      };
    })
    .filter((item): item is MangaSummary => Boolean(item))
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(offset, offset + limit);
}

function parseLatest(html: string, limit: number, offset: number): MangaSummary[] {
  const cards = [...html.matchAll(/<div[^>]+class=["'][^"']*\bitem\b[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]+class=["'][^"']*\bitem\b|<\/main>)/gi)];
  return cards
    .map((match): MangaSummary | undefined => {
      const block = match[1];
      const bookHref = block.match(/<a[^>]+href=["']([^"']*\/book\/\d+[^"']*)["'][^>]*>/i)?.[1];
      const read = block.match(/<a[^>]+href=["']([^"']*\/read\/\d+\/\d+\/1[^"']*)["'][^>]*title=["']([^"']+)["'][^>]*>\s*([\s\S]*?)<\/a>/i);
      const title = decodeHtml(block.match(/itemprop=["']title["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? htmlAttribute(block.match(/<img[^>]+>/i)?.[0] ?? "", "title"));
      if (!bookHref || !title) return undefined;
      return {
        source: SOURCE_ID,
        id: idFromHref(bookHref),
        title,
        coverUrl: absoluteUrl(SITE_BASE, htmlAttribute(block.match(/<img[^>]+>/i)?.[0] ?? "", "src")),
        latestChapter: chapterNumberFromText(read?.[2] ?? read?.[3]),
        tags: []
      };
    })
    .filter((item): item is MangaSummary => Boolean(item))
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(offset, offset + limit);
}

function field(html: string, label: string) {
  return decodeHtml(html.match(new RegExp(`<div[^>]*>\\s*${label}:\\s*<\\/div>\\s*<div[^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1]);
}

function linksInField(html: string, label: string) {
  const block = html.match(new RegExp(`<div[^>]*>\\s*${label}:\\s*<\\/div>\\s*<div[^>]*>([\\s\\S]*?)<\\/div>`, "i"))?.[1] ?? "";
  return unique([...block.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => decodeHtml(match[1])).filter(Boolean));
}

function parseDetail(html: string, id: string, chapters: ChapterSummary[]): MangaDetail {
  const title = decodeHtml(html.match(/<h2[^>]*itemprop=["']title["'][^>]*>([\s\S]*?)<\/h2>/i)?.[1]) || id;
  const coverTag = html.match(/<img[^>]+class=["'][^"']*img-thumbnail[^"']*["'][^>]*>/i)?.[0] ?? "";
  const origin = field(html, "Origin").toLowerCase();
  const tags = linksInField(html, "Genre\\(s\\)");
  const latest = chapters[0];
  return {
    source: SOURCE_ID,
    id,
    title,
    description: decodeHtml(html.match(/<div[^>]+id=["']descriptionCollapse["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]),
    coverUrl: absoluteUrl(SITE_BASE, htmlAttribute(coverTag, "src")),
    status: parseStatus(field(html, "Status")),
    demographic: origin.includes("korea") ? "manhwa" : origin.includes("china") ? "manhua" : origin.includes("japan") ? "manga" : undefined,
    year: Number(field(html, "Release Year")) || undefined,
    latestChapter: latest?.chapter,
    latestChapterReleasedAt: latest?.publishedAt,
    tags,
    altTitles: [],
    authors: linksInField(html, "Author"),
    artists: linksInField(html, "Artist"),
    language: "English",
    links: {
      website: `${SITE_BASE}/book/${id}`
    }
  };
}

function parseChapters(html: string, mangaId: string): ChapterSummary[] {
  return [...html.matchAll(/<tr[^>]*class=["'][^"']*\brow\b[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match): ChapterSummary | undefined => {
      const row = match[1];
      const link = row.match(/<a[^>]+href=["']([^"']*\/read\/\d+\/\d+\/1[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
      const group = row.match(/\/group\/\d+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1];
      const dateCell = row.match(/itemtype=["']https:\/\/schema\.org\/dateCreated["'][^>]*([^<]*)<\/span>/i)?.[0];
      const chapter = chapterNumberFromText(link?.[2]);
      if (!link || !chapter) return undefined;
      return {
        source: SOURCE_ID,
        id: chapterIdFromHref(link[1]),
        mangaId,
        title: `Chapter ${chapter}`,
        chapter,
        language: "en",
        publishedAt: parseDate(dateCell),
        groups: [decodeHtml(group) || "ProjectSuki"]
      };
    })
    .filter((chapter): chapter is ChapterSummary => Boolean(chapter))
    .filter((chapter, index, list) => list.findIndex((other) => other.id === chapter.id) === index);
}

async function pageCount(mangaId: string, chapterId: string) {
  const response = await fetch(`${SITE_BASE}/read/${mangaId}/${chapterId}/999`, {
    redirect: "manual",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Referer: `${SITE_BASE}/book/${mangaId}`,
      "User-Agent": "Mozilla/5.0 (compatible; ScottShelf/0.1; +https://scottshelf.local)"
    }
  });
  const location = response.headers.get("location");
  const count = location?.match(/\/read\/\d+\/\d+\/(\d+)/i)?.[1];
  return Number(count) || 1;
}

export const projectSukiSource: MangaSource = {
  info: {
    id: SOURCE_ID,
    name: "ProjectSuki",
    kind: "scraper",
    enabled: true,
    website: SITE_BASE,
    note: "Backup scraper for public ProjectSuki title, chapter, and reader pages."
  },

  async search(options: SearchOptions) {
    const limit = Math.min(options.limit ?? 24, 60);
    const offset = options.offset ?? 0;
    if (options.query?.trim()) {
      const html = await requestHtml(SITE_BASE, `/search?q=${encodeURIComponent(options.query.trim())}`, "ProjectSuki");
      return parseBrowseCards(html, limit, offset);
    }
    const html = await requestHtml(SITE_BASE, "/", "ProjectSuki");
    return parseLatest(html, limit, offset);
  },

  async getManga(id: string) {
    const html = await requestHtml(SITE_BASE, `/book/${id}`, "ProjectSuki");
    const chapters = parseChapters(html, id);
    return parseDetail(html, id, chapters);
  },

  async getChapters(mangaId: string) {
    const html = await requestHtml(SITE_BASE, `/book/${mangaId}`, "ProjectSuki");
    return parseChapters(html, mangaId);
  },

  async getChapterPages(id: string): Promise<ChapterPages> {
    const { mangaId, chapterId } = chapterParts(id);
    const count = await pageCount(mangaId, chapterId);
    const pages = await Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const html = await requestHtml(SITE_BASE, sourcePath(`/read/${mangaId}/${chapterId}/${index + 1}`), "ProjectSuki");
        return absoluteUrl(
          SITE_BASE,
          htmlAttribute(html.match(/<img[^>]+class=["'][^"']*center-block[^"']*["'][^>]*src=["'][^"']*\/images\/gallery\/[^"']+["'][^>]*>/i)?.[0] ?? "", "src")
        );
      })
    );
    const validPages = pages.filter((url): url is string => Boolean(url && !/assets|empty\.jpg/i.test(url)));
    if (!validPages.length) throw new Error("ProjectSuki chapter pages were not found.");
    return { source: SOURCE_ID, id, pages: validPages };
  }
};
