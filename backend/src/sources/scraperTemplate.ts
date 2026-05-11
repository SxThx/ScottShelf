import type {
  ChapterPages,
  ChapterSummary,
  MangaDetail,
  MangaSource,
  MangaSummary,
  SearchOptions,
  SourceInfo
} from "./types";

export type ScraperHandlers = {
  search(options: SearchOptions): Promise<MangaSummary[]>;
  getManga(id: string): Promise<MangaDetail>;
  getChapters(mangaId: string, language: string): Promise<ChapterSummary[]>;
  getChapterPages(chapterId: string): Promise<ChapterPages>;
};

export function createScraperSource(info: Omit<SourceInfo, "kind">, handlers: ScraperHandlers): MangaSource {
  return {
    info: {
      ...info,
      kind: "scraper"
    },
    ...handlers
  };
}

export function createUnsupportedSource(info: Omit<SourceInfo, "kind" | "enabled"> & { disabledReason: string }): MangaSource {
  const throwUnsupported = async () => {
    throw new Error(`${info.name} is registered but not enabled: ${info.disabledReason}`);
  };

  return {
    info: {
      ...info,
      enabled: false,
      kind: "scraper"
    },
    search: throwUnsupported,
    getManga: throwUnsupported,
    getChapters: throwUnsupported,
    getChapterPages: throwUnsupported
  };
}

export const scraperSourceNotes = [
  "Keep one adapter per website so selectors, rate limits, and source-specific rules stay isolated.",
  "Only add adapters for sites you have permission to access and whose terms allow automated access.",
  "Prefer official APIs or licensed catalogs when a source provides them."
];
