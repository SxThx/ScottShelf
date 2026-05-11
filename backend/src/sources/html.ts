export function decodeHtml(value?: string) {
  return (value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripHtml(value?: string) {
  return decodeHtml(value);
}

export function absoluteUrl(base: string, href?: string) {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

export function htmlAttribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match?.[1];
}

export function unique<T>(items: T[]) {
  return [...new Set(items)];
}

export function throwIfChallenge(html: string, sourceName: string) {
  if (/Just a moment|cf-mitigated|challenges\.cloudflare\.com|window\._cf_chl_opt|Enable JavaScript and cookies/i.test(html)) {
    throw new Error(`${sourceName} is protected by a browser challenge from this server.`);
  }
}

export async function requestHtml(base: string, path: string, sourceName: string) {
  const response = await fetch(new URL(path, base), {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Referer: base,
      "User-Agent": "Mozilla/5.0 (compatible; ScottShelf/0.1; +https://scottshelf.local)"
    }
  });
  const html = await response.text();
  throwIfChallenge(html, sourceName);
  if (!response.ok) throw new Error(`${sourceName} request failed (${response.status}).`);
  return html;
}
