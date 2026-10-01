import { readFileSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PageItems } from '../src/listing.js';

const SNAP = readFileSync(new URL('../src/page/snapshot.js', import.meta.url), 'utf8');
const ITEMS = readFileSync(new URL('../src/page/items.js', import.meta.url), 'utf8');
let browser: Browser;
let page: Page;
const read = async (html: string, target?: object): Promise<PageItems> => {
  await page.setContent(html);
  await page.evaluate(`(${SNAP})({})`);
  return page.evaluate(`(${ITEMS})(${JSON.stringify(target ?? { group: 'g1' })})`) as Promise<PageItems>;
};

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
});
afterAll(async () => browser.close());

describe('table rows', () => {
  // DataTables layout: header in its own table with a filter row, body table, and a fixed-column clone.
  const row = (i: number) => `<tr><td>1902${i}<button>Compare</button></td><td>VTT.${i}</td><td>${30 + i}</td></tr>`;
  const html = `<div class="dt"><div class="head"><table><thead>
      <tr><th>Code</th><th>Description</th><th>D</th></tr>
      <tr><th><select><option>19020</option><option>19021</option></select></th><th></th><th><select><option>30</option></select></th></tr>
    </thead></table></div>
    <div class="body"><table><tbody>${[0, 1, 2, 3].map(row).join('')}</tbody></table></div>
    <div class="clone"><table><tbody>${[0, 1, 2, 3].map((i) => `<tr><td>1902${i}</td><td></td><td></td></tr>`).join('')}</tbody></table></div></div>`;

  it('labels cells from the header row, not the filter row, and drops button text', async () => {
    const r = await read(html);
    expect(r.items[1]!.leaves).toEqual([
      { path: 'td:0', parent: '.', value: '19021', label: 'Code' },
      { path: 'td:1', parent: '.', value: 'VTT.1', label: 'Description' },
      { path: 'td:2', parent: '.', value: '31', label: 'D' },
    ]);
  });
  it('reads every table of the same template, including the clone', async () => {
    const first = await read(html);
    const all = await page.evaluate(`(${ITEMS})(${JSON.stringify({ itemSignature: first.item_signature, containerSignature: first.container_signature })})`) as PageItems;
    expect(all.items).toHaveLength(8);
    expect(all.containers).toBe(2);
  });
});

describe('div tables and cards', () => {
  it('takes column labels from a header row placed above div rows', async () => {
    const cell = 'style="display:table-cell;width:200px"';
    const rows = [1, 2, 3].map((i) => `<div class="r" style="display:table-row"><div ${cell}>1005-00${i}</div><div ${cell}>${i} mm</div><div ${cell}>${i * 1000} RPM</div></div>`).join('');
    const r = await read(`<div class="hdr" style="display:table-row"><div ${cell}>Part number</div><div ${cell}>Port</div><div ${cell}>Max speed</div></div>
      <div class="rows" style="display:table">${rows}</div>`);
    expect(r.items[0]!.leaves.map((l) => l.label)).toEqual(['Part number', 'Port', 'Max speed']);
  });
  it('does not label stacked card lines with a heading placed above the grid', async () => {
    const card = (i: number) => `<div class="card" style="width:300px"><h3>Sensor ${i}</h3><p>IP67</p><p>Art. ${i}</p></div>`;
    const r = await read(`<h2>Inductive sensors</h2><h4>Sorted by</h4><h4>Relevance</h4><div class="grid" style="display:flex;gap:10px">${[1, 2, 3, 4].map(card).join('')}</div>`);
    expect(r.items[0]!.leaves.every((l) => !l.label)).toBe(true);
  });
});

describe('count texts', () => {
  it('collects result counts and page counts, but not facet option counts or list values', async () => {
    const card = (i: number) => `<div class="card"><h3>Sensor ${i}</h3><p>Range 10 of 20 mm</p></div>`;
    const r = await read(`<aside><ul><li><input type="checkbox"><span>Discontinued products 2766</span></li></ul></aside>
      <main><p><strong>1728</strong> found</p><div class="bar"><p>49 / 2960</p></div><span>Page 1 of 34</span>
      <div class="grid">${[1, 2, 3].map(card).join('')}</div></main>`);
    expect(r.count_texts).toEqual(['1728 found', '49 / 2960', 'Page 1 of 34']);
  });
});
