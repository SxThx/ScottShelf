import type { ChapterPages, ChapterSummary, MangaDetail, MangaSource, MangaSummary, SearchOptions } from "./types";
import { absoluteUrl, decodeHtml, htmlAttribute, requestHtml, unique } from "./html";

const SITE_BASE = "https://www.nelomanga.net";
const SOURCE_ID = "nelomanga";

function slugFromHref(href: string) {
  return href.replace(/^https?:\/\/www\.nelomanga\.net\/manga\//, "").replace(/^\/manga\//, "").replace(/\/$/, "");
}

function chapterIdFromHref(href: string) {
  return slugFromHref(href);
}

function chapterNumberFromText(text: string) {
  return text.match(/chapter\s+([0-9]+(?:\.[0-9]+)?)/i)?.[1];
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const normalized = value.replace(/\b(\d{2})-(\d{2})\b/, `${new Date().getFullYear()}-$1-$2`);
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function latestFromChapters(chapters: ChapterSummary[]) {
  return chapters
    .map((chapter) => Number(chapter.chapter))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0];
}

function summaryFromAnchor(tag: string, title: string, chapter?: string, releasedAt?: string): MangaSummary | undefined {
  const href = htmlAttribute(tag, "href");
  if (!href?.includes("/manga/")) return undefined;
  const image = tag.match(/<img[^>]+>/i)?.[0] ?? "";
  return {
    source: SOURCE_ID,
    id: slugFromHref(href),
    title: decodeHtml(title),
    coverUrl: absoluteUrl(SITE_BASE, htmlAttribute(image, "src") || htmlAttribute(image, "data-src")),
    latestChapter: chapter,
    latestChapterReleasedAt: parseDate(releasedAt),
    tags: []
  };
}

function parseLatest(html: string, limit: number, offset: number) {
  const section = html.split(/LATEST MANGA RELEASES/i)[1] ?? html;
  const rows = [...section.matchAll(/<a[^>]+href=["']([^"']*\/manga\/[^"']+)["'][^>]*>\s*(?:<img[^>]*>)?\s*<\/a>[\s\S]*?<h3[^>]*>\s*<a[^>]+href=["'][^"']+["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+href=["'][^"']+["'][^>]*>\s*Chapter\s+([0-9.]+)\s*<\/a>\s*([^<\n]*)/gi)];
  return rows
    .map((match) => ({
      source: SOURCE_ID,
      id: slugFromHref(match[1]),
      title: decodeHtml(match[2]),
      latestChapter: match[3],
      latestChapterReleasedAt: parseDate(decodeHtml(match[4])),
      tags: []
    }))
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(offset, offset + limit);
}

function parseSearchResults(html: string, query: string, limit: number, offset: number) {
  const anchors = [...html.matchAll(/(<a[^>]+href=["'][^"']*\/manga\/[^"']+["'][^>]*>)([\s\S]*?)<\/a>/gi)];
  const normalized = query.toLowerCase();
  return anchors
    .map((match) => summaryFromAnchor(match[1] + match[2], decodeHtml(match[2])))
    .filter((item): item is MangaSummary => Boolean(item?.title && item.title.toLowerCase().includes(normalized)))
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(offset, offset + limit);
}

function parseDetail(html: string, id: string, chapters: ChapterSummary[]): MangaDetail {
  const title = decodeHtml(html.match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i)?.[1]) || decodeHtml(id.replace(/-/g, " "));
  const coverTag = html.match(/<img[^>]+(?:cover|manga|avatar)[^>]+>/i)?.[0] ?? html.match(/<img[^>]+>/i)?.[0] ?? "";
  const genres = [...html.matchAll(/Genres\s*:[\s\S]*?(?:<\/li>|<\/p>)/i)][0]?.[0] ?? "";
  const tags = unique([...genres.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => decodeHtml(match[1])).filter(Boolean));
  const summary = decodeHtml(html.match(/summary:\s*<\/h2>\s*([\s\S]*?)(?:SHOW MORE|<h2|<footer)/i)?.[1]);
  const latestChapter = latestFromChapters(chapters);

  return {
    source: SOURCE_ID,
    id,
    title,
    description: summary,
    coverUrl: absoluteUrl(SITE_BASE, htmlAttribute(coverTag, "src") || htmlAttribute(coverTag, "data-src")),
    status: decodeHtml(html.match(/Status\s*:\s*([^<\n]+)/i)?.[1]).toLowerCase() || undefined,
    demographic: tags.find((tag) => /manhwa|manhua|manga/i.test(tag)),
    latestChapter: latestChapter ? String(latestChapter) : chapters[0]?.chapter,
    latestChapterReleasedAt: chapters[0]?.publishedAt,
    tags,
    altTitles: [],
    authors: [...html.matchAll(/Author\(s\)\s*:[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => decodeHtml(match[1])),
    language: "English",
    links: {
      website: `${SITE_BASE}/manga/${id}`
    }
  };
}

export const neloMangaSource: MangaSource = {
  info: {
    id: SOURCE_ID,
    name: "NeloManga",
    kind: "scraper",
    enabled: true,
    website: SITE_BASE,
    note: "Backup scraper for public title, chapter, and image pages. May report unhealthy if Cloudflare challenges the server."
  },

  async search(options: SearchOptions) {
    const limit = Math.min(options.limit ?? 24, 60);
    const offset = options.offset ?? 0;
    const html = await requestHtml(SITE_BASE, "/", "NeloManga");
    if (options.query?.trim()) return parseSearchResults(html, options.query.trim(), limit, offset);
    return parseLatest(html, limit, offset);
  },

  async getManga(id: string) {
    const html = await requestHtml(SITE_BASE, `/manga/${id}`, "NeloManga");
    const chapters = await this.getChapters(id, "en");
    return parseDetail(html, id, chapters);
  },

  async getChapters(mangaId: string) {
    const html = await requestHtml(SITE_BASE, `/manga/${mangaId}`, "NeloManga");
    return [...html.matchAll(/<a[^>]+href=["']([^"']*\/manga\/[^"']+\/chapter-[^"']+)["'][^>]*>\s*Chapter\s+([0-9.]+)\s*<\/a>\s*([^<\n]*)/gi)]
      .map((match) => ({
        source: SOURCE_ID,
        id: chapterIdFromHref(match[1]),
        mangaId,
        title: `Chapter ${match[2]}`,
        chapter: match[2],
        language: "en",
        publishedAt: parseDate(decodeHtml(match[3])),
        groups: ["NeloManga"]
      }))
      .filter((chapter, index, list) => list.findIndex((other) => other.id === chapter.id) === index);
  },

  async getChapterPages(chapterId: string): Promise<ChapterPages> {
    const html = await requestHtml(SITE_BASE, `/manga/${chapterId}`, "NeloManga");
    const pages = [...html.matchAll(/<img[^>]+(?:chapter|page|wp-manga-chapter-img)[^>]+>/gi)]
      .map((match) => absoluteUrl(SITE_BASE, htmlAttribute(match[0], "src") || htmlAttribute(match[0], "data-src")))
      .filter((url): url is string => Boolean(url && !/logo|avatar|banner|facebook|discord/i.test(url)));
    if (!pages.length) throw new Error("NeloManga chapter pages were not found.");
    return { source: SOURCE_ID, id: chapterId, pages };
  }
};
