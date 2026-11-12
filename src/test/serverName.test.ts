import { describe, expect, it } from 'vitest';
import { LibraryServer, hubServesLibrary, hubSourceName, libraryServer } from '../lib/serverName';
import type { SourceConfig } from '../sources/types';

const nd = (over: Partial<SourceConfig> = {}): SourceConfig => ({ id: 'hub-1', kind: 'navidrome', name: 'Navidrome', url: 'https://hub/nd/1', enabled: true, hubId: 1, hubRelay: true, ...over });

describe('server name with Navidrome off on the Hub', () => {
  it('shows the Hub’s default “Navidrome” login as the Hub only while the Hub serves', () => {
    expect(hubSourceName('Navidrome', true)).toBe('Hub');
    expect(hubSourceName(' navidrome ', true)).toBe('Hub');
    expect(hubSourceName('Navidrome', undefined)).toBe('Navidrome');
    // an admin's own name is kept
    expect(hubSourceName('House music', true)).toBe('House music');
  });

  it('says the Hub or Navidrome in sentences', () => {
    expect(libraryServer([nd({ hubServed: true })])).toBe('the Hub');
    expect(LibraryServer([nd({ hubServed: true })])).toBe('The Hub');
    expect(libraryServer([nd()])).toBe('Navidrome');
    expect(LibraryServer([])).toBe('Navidrome');
    // a switched-off Hub login doesn't count
    expect(hubServesLibrary([nd({ hubServed: true, enabled: false })])).toBe(false);
  });
});
