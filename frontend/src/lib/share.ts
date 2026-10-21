/**
 * Links shared into the app.
 *
 * The share sheet (an iPhone Shortcut, or Android's share target from
 * manifest.json) opens the app as `/?url=...`, `/?text=...` or both. Apps fill
 * these differently: TikTok shares "Check out this video https://vm.tiktok.com/..."
 * as text, Instagram usually sends a bare URL. This picks the first web link.
 */

const LINK_RE = /https?:\/\/[^\s<>"']+/i;

/** Trailing punctuation that share texts glue onto a link. */
const TRAILING_RE = /[).,!?;:'"]+$/;

export function firstLink(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(LINK_RE);
  if (!match) return null;
  const link = match[0].replace(TRAILING_RE, '');
  try {
    const parsed = new URL(link);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? link : null;
  } catch {
    return null;
  }
}

/** The shared link in a query string, if any. `url` wins over `text` and `title`. */
export function sharedLinkFromSearch(search: string): string | null {
  const params = new URLSearchParams(search);
  for (const key of ['url', 'text', 'title']) {
    const link = firstLink(params.get(key));
    if (link) return link;
  }
  return null;
}

/** The current path without the share parameters, for history.replaceState. */
export function withoutShareParams(pathname: string, search: string, hash = ''): string {
  const params = new URLSearchParams(search);
  ['url', 'text', 'title'].forEach(k => params.delete(k));
  const rest = params.toString();
  return `${pathname}${rest ? `?${rest}` : ''}${hash}`;
}
