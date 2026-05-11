import type { FavoriteManga } from "./types";

export function isFavorite(favorites: FavoriteManga[], source: string, id: string) {
  return favorites.some((item) => item.source === source && item.id === id);
}
