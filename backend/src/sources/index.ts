import type { MangaSource } from "./types";
import { comickSource } from "./comick";
import { comixSource } from "./comix";
import { flameComicsSource } from "./flamecomics";
import { manhwaClanSource } from "./manhwaclan";
import { mangadexSource } from "./mangadex";
import { neloMangaSource } from "./nelomanga";
import { projectSukiSource } from "./projectsuki";
import { createUnsupportedSource } from "./scraperTemplate";

const unsupportedSources: MangaSource[] = [
  createUnsupportedSource({
    id: "asurascans",
    name: "Asura Scans",
    website: "https://asurascans.com",
    note: "Registered as a requested source.",
    disabledReason: "Current chapter access depends on site API calls and locked/premium states, so it is not enabled."
  }),
  createUnsupportedSource({
    id: "mangafire",
    name: "MangaFire",
    website: "https://mangafire.to",
    note: "Potential future source.",
    disabledReason: "Needs an adapter review before enabling."
  })
];

const sources: Record<string, MangaSource> = {
  [mangadexSource.info.id]: mangadexSource,
  [flameComicsSource.info.id]: flameComicsSource,
  [comixSource.info.id]: comixSource,
  [neloMangaSource.info.id]: neloMangaSource,
  [projectSukiSource.info.id]: projectSukiSource,
  [comickSource.info.id]: comickSource,
  [manhwaClanSource.info.id]: manhwaClanSource,
  ...Object.fromEntries(unsupportedSources.map((source) => [source.info.id, source]))
};

export function listSources() {
  return Object.values(sources).map((source) => source.info);
}

export function getSource(id: string) {
  return sources[id];
}

export function enabledSources() {
  return Object.values(sources).filter((source) => source.info.enabled);
}

export function fallbackSourceIds(preferredId?: string) {
  const priority = ["comix", "projectsuki", "mangadex", "flamecomics", "nelomanga", "comick", "manhwaclan"];
  return priority.filter((id) => id !== preferredId && sources[id]?.info.enabled);
}

export function sourceFallbackChain(preferredId?: string) {
  const chain = [preferredId || defaultSource(), ...fallbackSourceIds(preferredId)].filter((id): id is string => Boolean(id));
  return [...new Set(chain)].map((id) => sources[id]).filter((source): source is MangaSource => Boolean(source?.info.enabled));
}

export function defaultSource() {
  return comixSource.info.id;
}
