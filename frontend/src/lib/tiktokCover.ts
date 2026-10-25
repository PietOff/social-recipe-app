/**
 * Finding the cover image of a TikTok video from its id.
 *
 * The backend on Render used to do this, but TikTok's oEmbed stopped
 * returning thumbnail_url and its embed page answers Render's addresses with
 * 429. Vercel's servers still get the embed page, so the thumbnail route runs
 * here. Pure helpers live in this file so they can be tested.
 */

export const TIKTOK_ID_RE = /^\d{5,32}$/;
export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const STATE_RE = /<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/;

/** Only images on TikTok's own CDN are redirected to. */
export function isTikTokCdn(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)tiktokcdn(-[a-z]+)?\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** The video's cover from an embed page (/embed/v2/<id>), not the author's avatar. */
export function coverFromEmbedPage(page: string): string | null {
  const m = STATE_RE.exec(page || '');
  if (!m) return null;
  let state: unknown;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return null;
  }
  const data = (state as { source?: { data?: Record<string, unknown> } })?.source?.data;
  if (!data || typeof data !== 'object') return null;
  for (const entry of Object.values(data)) {
    const infos = (entry as { videoData?: { itemInfos?: Record<string, unknown> } })?.videoData?.itemInfos;
    if (!infos) continue;
    for (const key of ['covers', 'coversOrigin', 'coversDynamic']) {
      const list = infos[key];
      if (Array.isArray(list)) {
        const url = list.find(isTikTokCdn);
        if (url) return url;
      }
    }
  }
  return null;
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function resolveTikTokCover(
  videoId: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const res = await fetcher(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(`https://www.tiktok.com/@_/video/${videoId}`)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) },
    );
    if (res.ok) {
      const url = ((await res.json()) as { thumbnail_url?: unknown }).thumbnail_url;
      if (isTikTokCdn(url)) return url;
    }
  } catch {
    // fall through to the embed page
  }
  try {
    const res = await fetcher(`https://www.tiktok.com/embed/v2/${videoId}`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return coverFromEmbedPage(await res.text());
  } catch {
    // no cover
  }
  return null;
}
