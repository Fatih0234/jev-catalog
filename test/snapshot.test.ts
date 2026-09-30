import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/types.js';

const SRC = readFileSync(new URL('../src/page/snapshot.js', import.meta.url), 'utf8');
let browser: Browser;
let page: Page;
const snap = async (html: string): Promise<Snapshot> => {
  await page.setContent(html);
  return page.evaluate(`(${SRC})({})`) as Promise<Snapshot>;
};
const card = (i: number) => `<div class="card"><img src="data:," width="120" height="120"><h3>Sensor M12 type ${i}</h3>
  <ul class="specs"><li>Art. ${1000 + i}</li><li>IP67</li><li>24 V</li></ul><a href="/p/${i}">Details</a></div>`;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
});
afterAll(async () => browser.close());

describe('repeated group detection', () => {
  it('ranks the product grid first, reports the menu separately, and ignores spec lines inside cards', async () => {
    const s = await snap(`<nav><ul><li><a href="/a">Home</a></li><li><a href="/b">About</a></li><li><a href="/c">Jobs</a></li></ul></nav>
      <main><h2>Inductive sensors</h2><div class="grid" style="display:grid;grid-template-columns:repeat(3,300px)">${[1, 2, 3, 4, 5, 6].map(card).join('')}</div></main>`);
    expect(s.groups[0]).toMatchObject({ item_count: 6, region: 'main', heading: 'Inductive sensors', items_with_link_pct: 100, distinct_links: 6 });
    expect(s.groups[0]!.samples[0]).toContain('Sensor M12 type 1');
    expect(s.groups.some((g) => g.region === 'nav' && g.item_count === 3)).toBe(true);
    // Each card has 3 spec <li>s; they must not appear as groups of their own.
    expect(s.groups.filter((g) => g.samples.includes('IP67'))).toHaveLength(0);
  });

  it('ignores hidden items', async () => {
    const s = await snap(`<div class="list">${[1, 2, 3].map(card).join('')}${[4, 5, 6, 7].map((i) => `<div style="display:none">${card(i)}</div>`).join('')}</div>`);
    expect(s.groups[0]?.item_count).toBe(3);
  });
});

describe('controls and overlays', () => {
  it('finds a consent button inside an open shadow root and marks it as overlay', async () => {
    await page.setContent(`<main><a href="/products">Products</a></main><div id="host"></div>
      <script>
        const root = document.getElementById('host').attachShadow({ mode: 'open' });
        root.innerHTML = '<div role="dialog" style="position:fixed;inset:0;background:#fff"><p>We use cookies</p><button>Decline</button><button>Accept all</button></div>';
      </script>`);
    const s = (await page.evaluate(`(${SRC})({})`)) as Snapshot;
    const decline = s.controls.find((c) => c.label === 'Decline');
    expect(decline).toMatchObject({ in_overlay: true });
    expect(s.overlays[0]?.text).toContain('We use cookies');
    // The tag must be reachable by a Playwright locator so a Jev choice can be executed.
    await page.locator(`[data-jc-id="${decline!.id}"]`).click();
  });

  it('re-snapshotting never leaves stale ids on removed controls', async () => {
    await page.setContent('<button id="a">One</button><button id="b">Two</button>');
    await page.evaluate(`(${SRC})({})`);
    await page.evaluate(`document.getElementById('a').remove()`);
    const s = (await page.evaluate(`(${SRC})({})`)) as Snapshot;
    expect(s.controls.map((c) => c.label)).toEqual(['Two']);
    expect(await page.locator('[data-jc-id]').count()).toBe(1);
  });
});

describe('text normalisation', () => {
  it('strips soft hyphens and zero-width characters from German compound words', async () => {
    const s = await snap('<h1>Z\u00e4hler\u00adplatz\u00adsys\u00adteme</h1><p>Vertei\u200bler</p>');
    expect(s.headings[0]).toBe('Zählerplatzsysteme');
    expect(s.text).toContain('Verteiler');
  });
});

describe('item links', () => {
  it('uses the link that differs per card, not a badge link every card shares', async () => {
    const cards = [1, 2, 3, 4].map((i) => `<div class="c"><a class="badge" href="https://x.test/product-lines">PRO</a><h3>Radar ${i}</h3><a href="https://x.test/p/radar-${i}">Zum Produkt</a></div>`).join('');
    const s = await snap(`<div class="grid">${cards}</div>`);
    expect(s.groups[0]!.item_links.map((h) => h && new URL(h).pathname)).toEqual(['/p/radar-1', '/p/radar-2', '/p/radar-3', '/p/radar-4']);
    expect(s.groups[0]!.distinct_links).toBe(4);
  });
});

describe('frames', () => {
  it('merges a content iframe and routes a click on its control into the frame', async () => {
    const { snapshot, clickControl } = await import('../src/browser.js');
    await page.setContent(`<main><p>Shell</p></main>
      <iframe style="width:800px;height:400px" srcdoc="<h2>Product Guide</h2><p>Please select an area to continue with the guide</p><button onclick=&quot;document.body.dataset.done=1&quot;>Flow</button>"></iframe>`);
    await page.waitForTimeout(200);
    const s = await snapshot(page);
    expect(s.frames?.[0]?.text).toContain('Please select an area');
    const flow = s.controls.find((c) => c.label === 'Flow');
    expect(flow?.id).toMatch(/^f1-c\d+$/);
    expect(await clickControl(page, flow!.id, flow!.frame_url)).toBe(true);
    expect(await page.frames()[1]!.evaluate(() => document.body.dataset.done)).toBe('1');
  });
});

describe('layout sections', () => {
  it('finds a variant table inside page sections instead of reporting the sections as the list', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<tr><td>64635-C${i}</td><td>VB.839/63 B-M8-C${i}</td><td>63</td></tr>`).join('');
    const s = await snap(`<div class="wrap">
      <section class="s"><p>Header text and menu entries</p></section>
      <section class="s"><h2>Items</h2><table><tbody>${rows}</tbody></table></section>
      <section class="s"><p>Newsletter signup and footer links</p></section></div>`);
    expect(s.groups[0]).toMatchObject({ item_count: 12 });
    expect(s.groups[0]!.samples[0]).toContain('64635-C0');
    expect(s.groups.some((g) => g.item_count === 3 && g.samples[1]?.includes('64635'))).toBe(false);
  });

  it('keeps a table whose rows have more cells than the table has rows', async () => {
    const cells = (i: number) => Array.from({ length: 15 }, (_, c) => `<td>${c === 0 ? `19022${i}` : `v${c}`}</td>`).join('');
    const rows = Array.from({ length: 12 }, (_, i) => `<tr>${cells(i)}</tr>`).join('');
    const s = await snap(`<section><p>Intro text</p></section><section><table><tbody>${rows}</tbody></table></section><section><p>Footer</p></section>`);
    expect(s.groups[0]).toMatchObject({ item_count: 12 });
    expect(s.groups[0]!.samples[0]).toContain('190220');
  });
});

describe('nested lists', () => {
  it('keeps a richer variant table inside a small group of similar content blocks, without row cells as groups', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `<tr>${Array.from({ length: 15 }, (_, c) => `<td>${c ? 'v' + c : '19022' + i}</td>`).join('')}</tr>`).join('');
    const block = (inner: string) => `<div class="block"><h3>Block</h3>${inner}</div>`;
    const s = await snap(`<main>${block('<p>Description of the series and its use</p>')}${block(`<table><tbody>${rows}</tbody></table>`)}${block('<p>Downloads and documents</p>')}</main>`);
    const table = s.groups.find((g) => g.item_count === 12);
    expect(table?.samples[0]).toContain('190220');
    expect(s.groups.some((g) => g.item_count === 15)).toBe(false);
  });
});
