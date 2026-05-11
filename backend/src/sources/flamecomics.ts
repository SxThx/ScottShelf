import type {
  ChapterPages,
  ChapterSummary,
  MangaDetail,
  MangaSource,
  MangaSummary,
  SearchOptions
} from "./types";

const SITE_BASE = "https://flamecomics.xyz";
const CDN_BASE = "https://cdn.flamecomics.xyz/uploads/images/series";

type FlameSeries = {
  series_id: number;
  title: string;
  altTitles?: string[];
  description?: string;
  type?: string;
  categories?: string[];
  tags?: string[];
  year?: number;
  status?: string;
  cover?: string;
  last_edit?: number;
};

type FlameChapter = {
  series_id: number;
  chapter_id: number;
  chapter: string;
  title?: string | null;
  token: string;
  release_date?: number;
  edit_time?: number;
};

type FlameChapterPage = {
  name: string;
};

type NextData = {
  props?: {
    pageProps?: {
      series?: FlameSeries | FlameSeries[];
      chapters?: FlameChapter[];
      chapter?: FlameChapter & {
        images?: Record<string, FlameChapterPage>;
        edit_time?: number;
      };
    };
  };
};

function stripHtml(value?: string) {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function chapterId(seriesId: number | string, token: string) {
  return `${seriesId}--${token}`;
}

function parseChapterId(id: string) {
  const [seriesId, token] = id.split("--");
  if (!seriesId || !token) throw new Error("Invalid Flame Comics chapter id.");
  return { seriesId, token };
}

function coverUrl(series: FlameSeries) {
  if (!series.cover) return undefined;
  const suffix = series.last_edit ? `?${series.last_edit}` : "";
  return `${CDN_BASE}/${series.series_id}/${series.cover}${suffix}`;
}

function toSummary(series: FlameSeries): MangaSummary {
  return {
    source: "flamecomics",
    id: String(series.series_id),
    title: series.title,
    description: stripHtml(series.description),
    coverUrl: coverUrl(series),
    status: series.status?.toLowerCase(),
    demographic: series.type,
    year: series.year,
    tags: series.categories ?? series.tags ?? [],
    contentRating: "safe"
  };
}

function toDetail(series: FlameSeries): MangaDetail {
  return {
    ...toSummary(series),
    altTitles: series.altTitles ?? [],
    links: {
      website: `${SITE_BASE}/series/${series.series_id}`
    }
  };
}

function toChapter(chapter: FlameChapter): ChapterSummary {
  const number = Number(chapter.chapter);
  const cleanChapter = Number.isFinite(number) ? String(number) : chapter.chapter;
  return {
    source: "flamecomics",
    id: chapterId(chapter.series_id, chapter.token),
    mangaId: String(chapter.series_id),
    title: chapter.title || `Chapter ${cleanChapter}`,
    chapter: cleanChapter,
    language: "en",
    publishedAt: chapter.release_date ? new Date(chapter.release_date * 1000).toISOString() : undefined,
    groups: ["Flame Comics"]
  };
}

async function requestHtml(path: string) {
  const response = await fetch(`${SITE_BASE}${path}`, {
    headers: {
      Accept: "text/html",
      "User-Agent": "ScottShelf/0.1 local reader"
    }
  });

  if (!response.ok) {
    throw new Error(`Flame Comics request failed (${response.status}).`);
  }

  return response.text();
}

function extractNextData(html: string): NextData {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("Flame Comics page data was not found.");
  return JSON.parse(match[1]) as NextData;
}

async function requestPageData(path: string) {
  return extractNextData(await requestHtml(path)).props?.pageProps ?? {};
}

export const flameComicsSource: MangaSource = {
  info: {
    id: "flamecomics",
    name: "Flame Comics",
    kind: "scraper",
    enabled: true,
    website: SITE_BASE,
    note: "Uses public server-rendered pages only; no private API routes."
  },

  async search(options: SearchOptions) {
    const pageProps = await requestPageData("/browse");
    const series = Array.isArray(pageProps.series) ? pageProps.series : [];
    const query = options.query?.trim().toLowerCase();
    const filtered = query
      ? series.filter((item) => {
          const haystack = [item.title, item.description, item.type, ...(item.categories ?? [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(query);
        })
      : series;

    return filtered.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 24)).map(toSummary);
  },

  async getManga(id: string) {
    const pageProps = await requestPageData(`/series/${id}`);
    if (!pageProps.series || Array.isArray(pageProps.series)) throw new Error("Flame Comics title was not found.");
    return toDetail(pageProps.series);
  },

  async getChapters(mangaId: string) {
    const pageProps = await requestPageData(`/series/${mangaId}`);
    return (pageProps.chapters ?? []).map(toChapter).reverse();
  },

  async getChapterPages(id: string): Promise<ChapterPages> {
    const { seriesId, token } = parseChapterId(id);
    const pageProps = await requestPageData(`/series/${seriesId}/${token}`);
    const chapter = pageProps.chapter;
    if (!chapter?.images) throw new Error("Flame Comics chapter pages were not found.");

    const pages = Object.values(chapter.images).map((image) => {
      const suffix = chapter.edit_time ? `?${chapter.edit_time}` : "";
      return `${CDN_BASE}/${seriesId}/${token}/${image.name}${suffix}`;
    });

    return {
      source: "flamecomics",
      id,
      pages
    };
  }
};
