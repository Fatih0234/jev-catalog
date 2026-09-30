import { describe, expect, it } from 'vitest';
import { childLinks, normalizeUrl } from '../src/crawl.js';
import { siteKey } from '../src/gate.js';

describe('crawl link hygiene', () => {
  const page = (links: (string | null)[]) => ({ url: 'https://x.test/de/pumps/', main_group: { item_links: links } as any });
  it('keeps distinct same-site item links, drops fragments, self-links and other sites or locales', () => {
    const got = childLinks(
      page([
        'https://x.test/de/pumps/pk#specs',
        'https://x.test/de/pumps/pk',
        'https://x.test/de/pumps/#top',
        'https://x.test/en/pumps/pq',
        'https://cdn.other.test/pq.pdf',
        null,
        'https://x.test/de/pumps/pq?variant=2',
      ]),
      siteKey('https://x.test/de/pumps/'),
    );
    expect(got).toEqual(['https://x.test/de/pumps/pk', 'https://x.test/de/pumps/pq?variant=2']);
  });
  it('keeps the query string, because search and filter state live there', () => {
    expect(normalizeUrl('https://x.test/search?q=221#/type/product')).toBe('https://x.test/search?q=221');
  });
});
