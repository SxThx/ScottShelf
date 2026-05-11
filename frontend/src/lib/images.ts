export function proxiedImageUrl(url?: string) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    if (
      ["uploads.mangadex.org", "projectsuki.com", "www.projectsuki.com"].includes(parsed.hostname) ||
      /^([a-z0-9-]+\.)?wowpic\d*\.store$/i.test(parsed.hostname)
    ) {
      return `/api/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
    }
  } catch {
    return url;
  }
  return url;
}

export function preloadReaderImages(urls: string[]) {
  for (const url of urls) {
    const src = proxiedImageUrl(url);
    if (!src) continue;

    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = src;
    document.head.appendChild(link);
    window.setTimeout(() => link.remove(), 15000);

    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }
}
