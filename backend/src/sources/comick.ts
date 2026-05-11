import type { ChapterPages, ChapterSummary, MangaDetail, MangaSource, MangaSummary, SearchOptions } from "./types";

const SOURCE_ID = "comick";
const SITE_BASE = "https://comick.live";
const API_BASES = ["https://api.comick.dev", "https://comick.live/api", "https://comick.dev/api", "https://api.comick.io"];
const IMAGE_BASE = "https://meo.comick.pictures";

type ComicKComic = {
  hid?: string;
  slug?: string;
  title?: string;
  md_titles?: Array<{ title?: string }>;
  desc?: string;
  country?: string;
  status?: number | string;
  year?: number;
  bayesian_rating?: string;
  cover_url?: string;
  md_covers?: Array<{ b2key?: string; w?: number; h?: number }>;
  genres?: string[];
  content_rating?: string;
  last_chapter?: string;
  uploaded_at?: string;
};

type ComicKChapter = {
  hid?: string;
  chap?: string;
  title?: string;
  lang?: string;
  created_at?: string;
  group_name?: string[];
  group_names?: string[];
  md_chapters_groups?: Array<{ md_groups?: { title?: string } }>;
};

type ComicKPage = {
  b2key?: string;
  url?: string;
};

function coverUrl(comic: ComicKComic) {
  if (comic.cover_url?.startsWith("http")) return comic.cover_url;
  const key = comic.md_covers?.[0]?.b2key ?? comic.cover_url;
  return key ? `${IMAGE_BASE}/${key}` : undefined;
}

function title(comic: ComicKComic) {
  return comic.title || comic.md_titles?.find((item) => item.title)?.title || "Untitled";
}

function status(value?: number | string) {
  if (value === 1 || value === "1") return "ongoing";
  if (value === 2 || value === "2") return "completed";
  return typeof value === "string" ? value.toLowerCase() : undefined;
}

function tags(comic: ComicKComic) {
  return comic.genres?.slice(0, 12) ?? [];
}

function sourceId(comic: ComicKComic) {
  if (!comic.hid) throw new Error("ComicK title id was not found.");
  return comic.slug ? `${comic.hid}-${comic.slug}` : comic.hid;
}

function hidFromId(id: string) {
  return id.split("-")[0] || id;
}

function toSummary(comic: ComicKComic): MangaSummary {
  return {
    source: SOURCE_ID,
    id: sourceId(comic),
    title: title(comic),
    description: comic.desc,
    coverUrl: coverUrl(comic),
    status: status(comic.status),
    contentRating: comic.content_rating,
    demographic: comic.country === "kr" ? "manhwa" : comic.country === "cn" ? "manhua" : comic.country === "jp" ? "manga" : comic.country,
    year: comic.year,
    latestChapter: comic.last_chapter,
    latestChapterReleasedAt: comic.uploaded_at,
    tags: tags(comic)
  };
}

function toDetail(comic: ComicKComic): MangaDetail {
  return {
    ...toSummary(comic),
    altTitles: comic.md_titles?.map((item) => item.title).filter((item): item is string => Boolean(item)) ?? [],
    links: {
      website: `${SITE_BASE}/comic/${sourceId(comic)}`
    },
    language: "English"
  };
}

function chapterGroups(chapter: ComicKChapter) {
  const nested = chapter.md_chapters_groups
    ?.map((item) => item.md_groups?.title)
    .filter((item): item is string => Boolean(item)) ?? [];
  return chapter.group_names ?? chapter.group_name ?? nested;
}

function toChapter(chapter: ComicKChapter, mangaId: string): ChapterSummary {
  if (!chapter.hid) throw new Error("ComicK chapter id was not found.");
  const number = chapter.chap;
  return {
    source: SOURCE_ID,
    id: chapter.hid,
    mangaId,
    title: chapter.title || (number ? `Chapter ${number}` : "Chapter"),
    chapter: number,
    language: chapter.lang ?? "en",
    publishedAt: chapter.created_at,
    groups: chapterGroups(chapter)
  };
}

async function request<T>(path: string, params?: URLSearchParams): Promise<T> {
  const errors: string[] = [];
  for (const base of API_BASES) {
    const url = new URL(`${base}${path}`);
    params?.forEach((value, key) => url.searchParams.append(key, value));
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          Accept: "application/json",
          Referer: `${SITE_BASE}/home`,
          "User-Agent": "Mozilla/5.0 (compatible; ScottShelf/0.1; +https://scottshelf.local)"
        }
      });
      const text = await response.text();
      if (response.headers.get("cf-mitigated") === "challenge" || /Just a moment|cf-mitigated|challenges\.cloudflare\.com/i.test(text)) {
        throw new Error("browser challenge");
      }
      if (!response.ok) {
        const isHtml = /^\s*</.test(text) || (response.headers.get("content-type") ?? "").includes("text/html");
        throw new Error(isHtml ? `HTTP ${response.status} HTML response` : `HTTP ${response.status}`);
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json") && /^\s*</.test(text)) throw new Error(`HTML response from ${response.url}`);
      return JSON.parse(text) as T;
    } catch (error) {
      errors.push(`${new URL(base).host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`ComicK endpoints are unavailable: ${errors.join(" | ")}`);
}

export const comickSource: MangaSource = {
  info: {
    id: SOURCE_ID,
    name: "ComicK",
    kind: "api",
    enabled: true,
    website: SITE_BASE,
    note: "Fallback-only ComicK adapter. Tries api.comick.dev, comick.live, comick.dev, and comick.io. These endpoints may be blocked by Cloudflare from server-side requests."
  },

  async search(options: SearchOptions) {
    const limit = Math.min(options.limit ?? 24, 60);
    const offset = options.offset ?? 0;
    if (options.query?.trim()) {
      const params = new URLSearchParams({
        q: options.query.trim(),
        type: "comic",
        limit: String(limit),
        page: String(Math.floor(offset / limit) + 1)
      });
      const rows = await request<ComicKComic[]>("/search", params);
      return rows.map(toSummary);
    }

    const params = new URLSearchParams({
      type: "trending",
      comic_types: "manhwa",
      accept_erotic_content: "false",
      page: String(Math.floor(offset / limit) + 1)
    });
    const rows = await request<ComicKComic[] | { comics?: ComicKComic[] }>("/top", params);
    return (Array.isArray(rows) ? rows : rows.comics ?? []).slice(0, limit).map(toSummary);
  },

  async getManga(id: string) {
    const result = await request<{ comic?: ComicKComic } | ComicKComic>(`/comic/${hidFromId(id)}`, new URLSearchParams({ tachiyomi: "true" }));
    const comic = (result as { comic?: ComicKComic }).comic ?? (result as ComicKComic);
    if (!comic) throw new Error("ComicK title was not found.");
    return toDetail(comic);
  },

  async getChapters(mangaId: string, language: string) {
    const result = await request<{ chapters?: ComicKChapter[] } | ComicKChapter[]>(
      `/comic/${hidFromId(mangaId)}/chapters`,
      new URLSearchParams({ lang: language, tachiyomi: "true" })
    );
    const chapters = Array.isArray(result) ? result : result.chapters ?? [];
    return chapters.map((chapter) => toChapter(chapter, mangaId)).filter((chapter) => chapter.chapter);
  },

  async getChapterPages(id: string): Promise<ChapterPages> {
    const result = await request<{ chapter?: { images?: ComicKPage[] }; images?: ComicKPage[] }>(
      `/chapter/${id}`,
      new URLSearchParams({ tachiyomi: "true" })
    );
    const images = result.images ?? result.chapter?.images ?? [];
    const pages = images
      .map((image) => image.url || (image.b2key ? `${IMAGE_BASE}/${image.b2key}` : undefined))
      .filter((url): url is string => Boolean(url));
    if (!pages.length) throw new Error("ComicK chapter pages were not found.");
    return { source: SOURCE_ID, id, pages };
  }
};
