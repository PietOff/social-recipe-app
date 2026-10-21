import { describe, expect, it } from 'vitest';
import { firstLink, sharedLinkFromSearch, withoutShareParams } from '../share';

describe('shared links', () => {
  it('reads a bare url parameter', () => {
    const link = 'https://www.instagram.com/reel/DAbc123/?igsh=xyz';
    expect(sharedLinkFromSearch(`?url=${encodeURIComponent(link)}`)).toBe(link);
  });

  it('pulls the link out of TikTok share text', () => {
    const text = 'Check out hotplate_harry\'s video! #TikTok https://vm.tiktok.com/ZNdAbCdEf/';
    expect(sharedLinkFromSearch(`?text=${encodeURIComponent(text)}`)).toBe('https://vm.tiktok.com/ZNdAbCdEf/');
  });

  it('prefers url over text and ignores non-links', () => {
    const q = `?title=Recipe&text=${encodeURIComponent('see https://a.example/x')}&url=${encodeURIComponent('https://b.example/y')}`;
    expect(sharedLinkFromSearch(q)).toBe('https://b.example/y');
    expect(sharedLinkFromSearch('?text=no%20link%20here')).toBeNull();
    expect(sharedLinkFromSearch('')).toBeNull();
  });

  it('strips punctuation glued to the end of a link', () => {
    expect(firstLink('Try this (https://smaakmenutie.nl/brabantse-worstenbroodjes/).')).toBe(
      'https://smaakmenutie.nl/brabantse-worstenbroodjes/',
    );
  });

  it('rejects non-web schemes', () => {
    expect(firstLink('javascript:alert(1)')).toBeNull();
  });

  it('removes only the share parameters from the address', () => {
    expect(withoutShareParams('/', '?url=x&text=y')).toBe('/');
    expect(withoutShareParams('/', '?url=x&lang=nl', '#top')).toBe('/?lang=nl#top');
  });
});
