import type { ChapterPages, ChapterSummary, MangaDetail, MangaSource, MangaSummary, SearchOptions } from "./types";
import { absoluteUrl, decodeHtml, htmlAttribute, requestHtml, unique } from "./html";

const SITE_BASE = "https://manhwaclan.com";
const SOURCE_ID = "manhwaclan";

function slugFromHref(href: string) {
  const match = href.match(/\/manga\/([^/"'#?]+)/i);
  return match?.[1] ?? href.replace(/\/$/, "").split("/").filter(Boolean).pop() ?? href;
}

function chapterIdFromHref(href: string) {
  const manga = slugFromHref(href);
  const chapter = href.match(/\/(chapter-[^/"'#?]+)/i)?.[1] ?? "";
  return chapter ? `${manga}/${chapter}` : manga;
}

function numberFromChapter(value?: string) {
  return value?.match(/chapter\s+([0-9]+(?:\.[0-9]+)?)/i)?.[1];
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(decodeHtml(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function titleFromHtml(html: string, fallback: string) {
  return decodeHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]) || decodeHtml(fallback.replace(/-/g, " "));
}

function coverFromHtml(html: string) {
  const tag =
    html.match(/<div[^>]+summary_image[\s\S]*?<img[^>]+>/i)?.[0].match(/<img[^>]+>/i)?.[0] ??
    html.match(/<img[^>]+wp-post-image[^>]+>/i)?.[0] ??
    "";
  return absoluteUrl(SITE_BASE, htmlAttribute(tag, "data-src") || htmlAttribute(tag, "src"));
}

function parseTags(html: string) {
  const genreBlock = html.match(/Genre\(s\)[\s\S]*?(?:<div class=["']post-content|<h[23]|Summary)/i)?.[0] ?? "";
  return unique([...genreBlock.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => decodeHtml(match[1])).filter(Boolean));
}

function toSummaryFromTitleHtml(html: string, id: string): MangaSummary {
  const chapters = parseChapters(html, id);
  return {
    source: SOURCE_ID,
    id,
    title: titleFromHtml(html, id),
    description: decodeHtml(html.match(/<div[^>]+summary__content[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1]),
    coverUrl: coverFromHtml(html),
    status: decodeHtml(html.match(/Status\s*<\/h5>\s*<div[^>]*>([\s\S]*?)<\/div>/i)?.[1]).toLowerCase() || undefined,
    demographic: parseTags(html).find((tag) => /manhwa|manhua|manga/i.test(tag)),
    year: Number(decodeHtml(html.match(/Release\s*<\/h5>[\s\S]*?>(\d{4})</i)?.[1])) || undefined,
    latestChapter: chapters[0]?.chapter,
    latestChapterReleasedAt: chapters[0]?.publishedAt,
    tags: parseTags(html)
  };
}

function parseSearchHtml(html: string, query: string, limit: number, offset: number) {
  const normalized = query.toLowerCase();
  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']*\/manga\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return anchors
    .map((match) => ({
      source: SOURCE_ID,
      id: slugFromHref(match[1]),
      title: decodeHtml(match[2]),
      tags: []
    }))
    .filter((item) => item.title && item.title.toLowerCase().includes(normalized))
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(offset, offset + limit);
}

function parseLatestHtml(html: string, limit: number, offset: number) {
  const rows = [...html.matchAll(/<a[^>]+href=["']([^"']*\/manga\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]{0,800}?Chapter\s+([0-9.]+)/gi)];
  return rows
    .map((match) => ({
      source: SOURCE_ID,
      id: slugFromHref(match[1]),
      title: decodeHtml(match[2]),
      latestChapter: match[3],
      tags: []
    }))
    .filter((item) => item.title)
    .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
    .slice(offset, offset + limit);
}

function parseChapters(html: string, mangaId: string): ChapterSummary[] {
  return [...html.matchAll(/<a[^>]+href=["']([^"']*\/manga\/[^"']+\/chapter-[^"']+)["'][^>]*>\s*([^<]*Chapter\s+[0-9.][^<]*)<\/a>[\s\S]{0,240}?((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December)[^<]+)/gi)]
    .map((match) => {
      const chapter = numberFromChapter(match[2]);
      return {
        source: SOURCE_ID,
        id: chapterIdFromHref(match[1]),
        mangaId,
        title: decodeHtml(match[2]),
        chapter,
        language: "en",
        publishedAt: parseDate(match[3]),
        groups: ["ManhwaClan"]
      };
    })
    .filter((chapter) => chapter.chapter)
    .filter((chapter, index, list) => list.findIndex((other) => other.id === chapter.id) === index);
}

export const manhwaClanSource: MangaSource = {
  info: {
    id: SOURCE_ID,
    name: "ManhwaClan",
    kind: "scraper",
    enabled: true,
    website: SITE_BASE,
    note: "Backup scraper for public WordPress manga pages. May report unhealthy if Cloudflare challenges the server."
  },

  async search(options: SearchOptions) {
    const limit = Math.min(options.limit ?? 24, 60);
    const offset = options.offset ?? 0;
    if (options.query?.trim()) {
      const html = await requestHtml(SITE_BASE, `/?s=${encodeURIComponent(options.query.trim())}&post_type=wp-manga`, "ManhwaClan");
      return parseSearchHtml(html, options.query.trim(), limit, offset);
    }
    const html = await requestHtml(SITE_BASE, "/", "ManhwaClan");
    return parseLatestHtml(html, limit, offset);
  },

  async getManga(id: string): Promise<MangaDetail> {
    const html = await requestHtml(SITE_BASE, `/manga/${id}/`, "ManhwaClan");
    return {
      ...toSummaryFromTitleHtml(html, id),
      altTitles: [decodeHtml(html.match(/Alternative\s*<\/h5>\s*<div[^>]*>([\s\S]*?)<\/div>/i)?.[1])].filter(Boolean),
      authors: [...html.matchAll(/Author\(s\)[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => decodeHtml(match[1])),
      language: "English",
      links: {
        website: `${SITE_BASE}/manga/${id}/`
      }
    };
  },

  async getChapters(mangaId: string) {
    const html = await requestHtml(SITE_BASE, `/manga/${mangaId}/`, "ManhwaClan");
    return parseChapters(html, mangaId);
  },

  async getChapterPages(id: string): Promise<ChapterPages> {
    const html = await requestHtml(SITE_BASE, `/manga/${id}/`, "ManhwaClan");
    const pages = [...html.matchAll(/<img[^>]+(?:wp-manga-chapter-img|chapter|page)[^>]+>/gi)]
      .map((match) => absoluteUrl(SITE_BASE, htmlAttribute(match[0], "data-src") || htmlAttribute(match[0], "src")))
      .filter((url): url is string => Boolean(url && !/logo|avatar|banner/i.test(url)));
    if (!pages.length) throw new Error("ManhwaClan chapter pages were not found.");
    return { source: SOURCE_ID, id, pages };
  }
};
