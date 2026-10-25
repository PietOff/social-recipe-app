import { describe, expect, it } from 'vitest';
import { coverFromEmbedPage, isTikTokCdn, resolveTikTokCover } from '../tiktokCover';

function embedPage(covers: string[]) {
  const state = { source: { data: { '/embed/v2/1': { videoData: {
    itemInfos: { covers },
    authorInfos: { covers: ['https://p16.tiktokcdn.com/avatar.jpg'] },
  } } } } };
  return `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify(state)}</script></html>`;
}

const ok = (body: unknown, text = false) =>
  ({ ok: true, json: async () => body, text: async () => (text ? (body as string) : '') }) as Response;

describe('TikTok cover', () => {
  it('takes the video cover, not the avatar', () => {
    expect(coverFromEmbedPage(embedPage(['https://p16-common-sign.tiktokcdn-us.com/c.jpg'])))
      .toBe('https://p16-common-sign.tiktokcdn-us.com/c.jpg');
    expect(coverFromEmbedPage(embedPage([]))).toBeNull();
    expect(coverFromEmbedPage('<html></html>')).toBeNull();
  });

  it('only accepts TikTok CDN https links', () => {
    expect(isTikTokCdn('https://p16.tiktokcdn.com/x.jpg')).toBe(true);
    expect(isTikTokCdn('https://p19-sign.tiktokcdn-us.com/x.jpg')).toBe(true);
    expect(isTikTokCdn('http://p16.tiktokcdn.com/x.jpg')).toBe(false);
    expect(isTikTokCdn('https://evil.com/tiktokcdn.com.jpg')).toBe(false);
    expect(isTikTokCdn('https://tiktokcdn.com.evil.com/x.jpg')).toBe(false);
    expect(isTikTokCdn(embedPage([]))).toBe(false);
  });

  it('falls back to the embed page when oEmbed has no thumbnail', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      return calls.length === 1 ? ok({ type: 'video' }) : ok(embedPage(['https://p16.tiktokcdn.com/c.jpg']), true);
    }) as unknown as typeof fetch;
    expect(await resolveTikTokCover('123456', fetcher)).toBe('https://p16.tiktokcdn.com/c.jpg');
    expect(calls[1]).toBe('https://www.tiktok.com/embed/v2/123456');
  });

  it('uses the oEmbed thumbnail when there is one', async () => {
    let n = 0;
    const fetcher = (async () => { n++; return ok({ thumbnail_url: 'https://p16.tiktokcdn.com/o.jpg' }); }) as unknown as typeof fetch;
    expect(await resolveTikTokCover('123456', fetcher)).toBe('https://p16.tiktokcdn.com/o.jpg');
    expect(n).toBe(1);
  });

  it('returns null when TikTok refuses', async () => {
    const fetcher = (async () => ({ ok: false, status: 429 }) as Response) as unknown as typeof fetch;
    expect(await resolveTikTokCover('123456', fetcher)).toBeNull();
  });
});
