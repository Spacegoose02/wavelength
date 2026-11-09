import { describe, expect, it } from 'vitest';
import { gatewayHint } from '../lib/http';

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
