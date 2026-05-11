import type {
  ChapterPages,
  ChapterSummary,
  MangaDetail,
  MangaSource,
  MangaSummary,
  SearchOptions
} from "./types";

const API_BASE = "https://api.mangadex.org";
const COVER_BASE = "https://uploads.mangadex.org/covers";

type MangaDexRelationship = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
};

type MangaDexEntity<TAttributes> = {
  id: string;
  type: string;
  attributes: TAttributes;
  relationships?: MangaDexRelationship[];
};

type MangaAttributes = {
  title: Record<string, string>;
  altTitles?: Record<string, string>[];
  description?: Record<string, string>;
  status?: string;
  contentRating?: string;
  publicationDemographic?: string;
  year?: number;
  tags?: Array<{
    attributes?: {
      name?: Record<string, string>;
    };
  }>;
  links?: Record<string, string>;
};

type ChapterAttributes = {
  title?: string;
  chapter?: string;
  volume?: string;
  translatedLanguage?: string;
  externalUrl?: string | null;
  publishAt?: string;
  readableAt?: string;
  pages?: number;
};

type AtHomeResponse = {
  baseUrl: string;
  chapter: {
    hash: string;
    data: string[];
  };
};

function preferredText(values?: Record<string, string>, fallback = "Untitled") {
  if (!values) return fallback;
  return values.en ?? values["en-us"] ?? Object.values(values)[0] ?? fallback;
}

function shortDescription(values?: Record<string, string>) {
  const raw = preferredText(values, "");
  return raw.replace(/\s*---[\s\S]*$/g, "").trim();
}

function coverUrl(manga: MangaDexEntity<MangaAttributes>) {
  const cover = manga.relationships?.find((item) => item.type === "cover_art");
  const fileName = cover?.attributes?.fileName;
  return typeof fileName === "string" ? `${COVER_BASE}/${manga.id}/${fileName}.256.jpg` : undefined;
}

function toTags(manga: MangaDexEntity<MangaAttributes>) {
  return (
    manga.attributes.tags
      ?.map((tag) => preferredText(tag.attributes?.name, ""))
      .filter(Boolean)
      .slice(0, 8) ?? []
  );
}

function toSummary(manga: MangaDexEntity<MangaAttributes>): MangaSummary {
  return {
    source: "mangadex",
    id: manga.id,
    title: preferredText(manga.attributes.title),
    description: shortDescription(manga.attributes.description),
    coverUrl: coverUrl(manga),
    status: manga.attributes.status,
    contentRating: manga.attributes.contentRating,
    demographic: manga.attributes.publicationDemographic,
    year: manga.attributes.year,
    tags: toTags(manga)
  };
}

function toDetail(manga: MangaDexEntity<MangaAttributes>): MangaDetail {
  const summary = toSummary(manga);
  return {
    ...summary,
    altTitles:
      manga.attributes.altTitles
        ?.map((title) => preferredText(title, ""))
        .filter(Boolean)
        .slice(0, 12) ?? [],
    links: manga.attributes.links ?? {}
  };
}

function toChapter(chapter: MangaDexEntity<ChapterAttributes>): ChapterSummary {
  const groups =
    chapter.relationships
      ?.filter((item) => item.type === "scanlation_group")
      .map((item) => {
        const name = item.attributes?.name;
        return typeof name === "string" ? name : undefined;
      })
      .filter((item): item is string => Boolean(item)) ?? [];

  const mangaId = chapter.relationships?.find((item) => item.type === "manga")?.id ?? "";
  const number = chapter.attributes.chapter;
  const fallbackTitle = number ? `Chapter ${number}` : "Chapter";

  return {
    source: "mangadex",
    id: chapter.id,
    mangaId,
    title: chapter.attributes.title || fallbackTitle,
    chapter: number,
    volume: chapter.attributes.volume,
    language: chapter.attributes.translatedLanguage ?? "en",
    publishedAt: chapter.attributes.publishAt,
    readableAt: chapter.attributes.readableAt,
    groups,
    pages: chapter.attributes.pages,
    externalUrl: chapter.attributes.externalUrl ?? undefined
  };
}

async function request<T>(path: string, params?: URLSearchParams): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    params.forEach((value, key) => url.searchParams.append(key, value));
  }

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ScottShelf/0.1 local reader"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`MangaDex request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return response.json() as Promise<T>;
}

function commonMangaParams(language: string) {
  const params = new URLSearchParams();
  params.append("includes[]", "cover_art");
  params.append("availableTranslatedLanguage[]", language);
  params.append("hasAvailableChapters", "true");
  params.append("contentRating[]", "safe");
  params.append("contentRating[]", "suggestive");
  return params;
}

export const mangadexSource: MangaSource = {
  info: {
    id: "mangadex",
    name: "MangaDex",
    kind: "api",
    enabled: true,
    website: "https://mangadex.org",
    note: "Uses the MangaDex public API instead of scraping."
  },

  async search(options: SearchOptions) {
    const language = options.language ?? "en";
    const params = commonMangaParams(language);
    params.set("limit", String(Math.min(options.limit ?? 24, 64)));
    params.set("offset", String(options.offset ?? 0));

    if (options.query?.trim()) {
      params.set("title", options.query.trim());
      params.set("order[relevance]", "desc");
    } else {
      params.set("order[followedCount]", "desc");
    }

    const result = await request<{ data: MangaDexEntity<MangaAttributes>[] }>("/manga", params);
    return result.data.map(toSummary);
  },

  async getManga(id: string) {
    const params = new URLSearchParams();
    params.append("includes[]", "cover_art");
    const result = await request<{ data: MangaDexEntity<MangaAttributes> }>(`/manga/${id}`, params);
    return toDetail(result.data);
  },

  async getChapters(mangaId: string, language: string) {
    const params = new URLSearchParams();
    params.set("limit", "500");
    params.set("offset", "0");
    params.append("translatedLanguage[]", language);
    params.append("includes[]", "scanlation_group");
    params.append("order[chapter]", "asc");
    params.append("order[publishAt]", "asc");
    params.append("contentRating[]", "safe");
    params.append("contentRating[]", "suggestive");

    const result = await request<{ data: MangaDexEntity<ChapterAttributes>[] }>(`/manga/${mangaId}/feed`, params);
    return result.data.map(toChapter).filter((chapter) => !chapter.externalUrl && (chapter.pages ?? 0) > 0);
  },

  async getChapterPages(chapterId: string): Promise<ChapterPages> {
    const result = await request<AtHomeResponse>(`/at-home/server/${chapterId}`);
    const pages = result.chapter.data.map(
      (fileName) => `${result.baseUrl}/data/${result.chapter.hash}/${fileName}`
    );
    if (pages.length === 0) {
      throw new Error("This chapter does not have hosted image pages available for the in-app reader.");
    }
    return {
      source: "mangadex",
      id: chapterId,
      pages
    };
  }
};
