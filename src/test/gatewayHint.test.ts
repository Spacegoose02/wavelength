import { describe, expect, it } from 'vitest';
import { browserFetchHint, gatewayHint } from '../lib/http';

describe('gatewayHint', () => {
  it('explains proxy errors', () => {
    const m = gatewayHint('502 Bad Gateway — https://podcasts.example.net/api/libraries');
    expect(m).toMatch(/^502 Bad Gateway — https:\/\/podcasts\.example\.net\/api\/libraries\. The web proxy/);
    expect(gatewayHint('504 Gateway Timeout — x')).toMatch(/web proxy/);
  });
  it('leaves other errors alone', () => {
    expect(gatewayHint('401 Unauthorized — x')).toBe('401 Unauthorized — x');
    expect(gatewayHint('5020 odd')).toBe('5020 odd');
  });
});

describe('browserFetchHint', () => {
  const ff = 'NetworkError when attempting to fetch resource.';
  it('names the Audiobookshelf CORS setting and this page', () => {
    const m = browserFetchHint(ff, 'audiobookshelf', 'https://hub.example.net');
    expect(m).toMatch(/Allowed CORS Origins/);
    expect(m).toMatch(/https:\/\/hub\.example\.net/);
  });
  it('covers Chrome and Safari wording', () => {
    expect(browserFetchHint('Failed to fetch', 'plex', 'https://h')).toMatch(/allow that origin/);
    expect(browserFetchHint('Load failed', 'plex', 'https://h')).toMatch(/allow that origin/);
  });
  it('leaves the apps and other errors alone', () => {
    expect(browserFetchHint(ff, 'audiobookshelf', undefined)).toBe(ff);
    expect(browserFetchHint('401 Unauthorized — x', 'audiobookshelf', 'https://h')).toBe('401 Unauthorized — x');
  });
});
