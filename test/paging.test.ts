import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Judge } from '../src/jev.js';
import type { ListingRecipe, Row } from '../src/listing.js';
import { inferTemplate, pageUrl, paginate, planMechanisms, shouldRepass, templateFromNext, type PagingDump } from '../src/paging.js';

// ---------- Pure parts ----------

describe('URL templates', () => {
  it('fits zero-based page numbers from numbered links', () => {
    const t = inferTemplate([
      { n: 1, href: 'https://s.test/list?page=0' },
      { n: 2, href: 'https://s.test/list?page=1' },
      { n: 3, href: 'https://s.test/list?page=2' },
    ])!;
    expect(t).toMatchObject({ a: 1, b: -1 });
    expect(pageUrl(t, 46)).toBe('https://s.test/list?page=45');
  });
  it('fits offsets and leaves other numbers in the URL alone', () => {
    const t = inferTemplate([
      { n: 2, href: 'https://s.test/c/200_010/list?start=50&size=50' },
      { n: 3, href: 'https://s.test/c/200_010/list?start=100&size=50' },
    ])!;
    expect(pageUrl(t, 5)).toBe('https://s.test/c/200_010/list?start=200&size=50');
  });
  it('refuses links that differ in more than one number', () => {
    expect(inferTemplate([{ n: 2, href: 'https://s.test/a/1?p=2' }, { n: 3, href: 'https://s.test/a/2?p=3' }])).toBeUndefined();
  });
  it('reads a single next link as page number, zero-based page, or offset', () => {
    expect(pageUrl(templateFromNext('https://s.test/l?q=x&p=2', 'https://s.test/l?q=x', 20)!, 4)).toBe('https://s.test/l?q=x&p=4');
    expect(pageUrl(templateFromNext('https://s.test/l?page=1', 'https://s.test/l', 20)!, 4)).toBe('https://s.test/l?page=3');
    expect(pageUrl(templateFromNext('https://s.test/l?offset=20', 'https://s.test/l', 20)!, 4)).toBe('https://s.test/l?offset=60');
  });
});

describe('planMechanisms', () => {
  const dump = (candidates: Partial<PagingDump['candidates'][number]>[]): PagingDump => ({
    url: 'https://s.test/l', item_count: 20, selects: [], rel_next: null, scroll_height: 2000,
    candidates: candidates.map((c, i) => ({ id: `p${i + 1}`, label: '', position: 'below', in_pager: true, disabled: false, current: false, ...c })),
  });
  const roles = (r: string[]) => Object.fromEntries(r.map((role, i) => [`p${i + 1}`, { role: role as any, confidence: 0.9 }]));

  it('puts a replayable URL first, then clicks, and scrolling last', () => {
    const d = dump([{ label: '2', href: 'https://s.test/l?p=2' }, { label: '3', href: 'https://s.test/l?p=3' }, { label: '', hint: 'Next page' }]);
    expect(planMechanisms(d, roles(['page_number', 'page_number', 'next_page'])).map((m) => m.kind)).toEqual(['url', 'click_next', 'click_number', 'scroll']);
  });
  it('ignores a disabled next control and controls Jev was unsure about', () => {
    const d = dump([{ hint: 'Previous' , disabled: true }, { hint: 'Next', disabled: true }, { label: 'Mehr laden' }]);
    const r = { ...roles(['previous_first_last', 'next_page', 'load_more']), p3: { role: 'load_more' as const, confidence: 0.3 } };
    expect(planMechanisms(d, r).map((m) => m.kind)).toEqual(['scroll']);
  });
});

describe('shouldRepass', () => {
  const r = (o: object) => ({ stop: 'empty_page' as const, repeated_rows: 30, advertised_total: 1000, ...o });
  it('repeats while a shifting order leaves products unseen and the last pass still helped', () => {
    expect(shouldRepass(r({}), 850, 850, 1, 3)).toBe(true);
    expect(shouldRepass(r({}), 950, 5, 2, 3)).toBe(false); // last pass added under 1%
    expect(shouldRepass(r({}), 850, 850, 3, 3)).toBe(false); // out of passes
  });
  it('does not repeat when nothing repeated, the total is unknown, reached, or the site failed', () => {
    expect(shouldRepass(r({ repeated_rows: 0 }), 850, 850, 1, 3)).toBe(false);
    expect(shouldRepass(r({ repeated_rows: 5 }), 850, 850, 1, 3)).toBe(false); // under 1% of the total is noise
    expect(shouldRepass(r({ advertised_total: undefined }), 850, 850, 1, 3)).toBe(false);
    expect(shouldRepass(r({}), 1000, 1000, 1, 3)).toBe(false);
    expect(shouldRepass(r({ stop: 'server_error' }), 850, 850, 1, 3)).toBe(false);
  });
});

// ---------- paginate() against a fake shop ----------

const PER_PAGE = 5;
const products = (n: number) => Array.from({ length: n }, (_, i) => `ART-${String(i + 1).padStart(3, '0')}`);
const card = (code: string) => `<div class="card"><h3>Sensor ${code}</h3><span class="code">${code}</span></div>`;
const shell = (body: string) => `<!doctype html><html><body><main><h1>Sensors</h1>${body}</main></body></html>`;

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});
afterAll(async () => browser.close());

const recipe: ListingRecipe = {
  version: 1, source_url: 'https://shop.test/', item_signature: 'DIV.card', container_signature: 'DIV.grid', pairs: {},
  fields: [{ key: 'SPAN.code:0', name: 'code', role: 'order_code', confidence: 0.9, coverage: 1 }], dropped: [], identity: 'code',
};
const withTotal = (n: number): ListingRecipe => ({ ...recipe, total: { text: `${n} products`, value: n, kind: 'product_count' } });

/** A judge that names controls by their text, the way Jev would. */
const fakeJudge = (): Judge => ({
  trace: [],
  async ask(_step, _state, questions) {
    const out: Record<string, any> = {};
    for (const [k, q] of Object.entries(questions as Record<string, any>)) {
      const c = q.instructions?.control ?? {};
      const text = `${c.text ?? ''} ${c.attributes ?? ''}`;
      const role = /^\d+$/.test(c.text) ? 'page_number' : /next|›/i.test(text) ? 'next_page' : /more/i.test(text) ? 'load_more' : /prev/i.test(text) ? 'previous_first_last' : 'other';
      out[k] = { choice: role, confidence: 0.95, probabilities: { [role]: 0.95 } };
    }
    return out as any;
  },
});

async function firstRows(): Promise<Row[]> {
  return page.$$eval('.card .code', (els) => els.map((e) => ({ code: e.textContent!.trim() })));
}

describe('paginate', () => {
  it('pages through zero-based ?page= links to the end and stops on the empty page', async () => {
    const all = products(23);
    await page.route('https://shop.test/url**', (route) => {
      const p = Number(new URL(route.request().url()).searchParams.get('page') ?? 0);
      const items = all.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
      const nav = [0, 1, 2].map((i) => `<a href="/url?page=${i}">${i + 1}</a>`).join(' ');
      return route.fulfill({ contentType: 'text/html', body: shell(`<div class="grid">${items.map(card).join('')}</div><nav class="pagination">${nav}</nav>`) });
    });
    await page.goto('https://shop.test/url');
    const r = await paginate(page, fakeJudge(), recipe, await firstRows(), { title: 'Sensors' }, { waitMs: 1500 });
    expect(r.mechanism?.kind).toBe('url');
    expect(r.rows.map((x) => x.code)).toEqual(all);
    expect(r.stop).toBe('empty_page');
  });

  it('clicks an icon-only next button until it is disabled, and stops at the advertised total', async () => {
    const all = products(12);
    const html = shell(`<div class="grid"></div><nav class="pagination"><button class="prev" aria-label="Previous page">‹</button><button class="next" aria-label="Next page"><svg width="10" height="10"></svg></button></nav>
      <script>
        const all = ${JSON.stringify(all)}; let p = 0;
        const render = () => {
          setTimeout(() => {
            document.querySelector('.grid').innerHTML = all.slice(p * ${PER_PAGE}, (p + 1) * ${PER_PAGE}).map((c) => '<div class="card"><h3>Sensor ' + c + '</h3><span class="code">' + c + '</span></div>').join('');
            document.querySelector('.next').disabled = (p + 1) * ${PER_PAGE} >= all.length;
          }, 300);
        };
        document.querySelector('.next').onclick = () => { p++; render(); };
        render();
      </script>`);
    await page.route('https://shop.test/click', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://shop.test/click');
    await page.waitForSelector('.card');
    const r = await paginate(page, fakeJudge(), withTotal(12), await firstRows(), { title: 'Sensors' }, { waitMs: 2000 });
    expect(r.mechanism?.kind).toBe('click_next');
    expect(r.rows).toHaveLength(12);
    expect(r.stop).toBe('reached_total');
    expect(r.completeness_pct).toBe(100);
  });

  it('keeps pressing "load more" and reads only the added items', async () => {
    const all = products(14);
    const html = shell(`<div class="grid"></div><button class="more">Load more</button>
      <script>
        const all = ${JSON.stringify(all)}; let shown = 0;
        const more = () => { const next = all.slice(shown, shown + ${PER_PAGE}); shown += next.length;
          document.querySelector('.grid').insertAdjacentHTML('beforeend', next.map((c) => '<div class="card"><h3>Sensor ' + c + '</h3><span class="code">' + c + '</span></div>').join(''));
          if (shown >= all.length) document.querySelector('.more').remove(); };
        document.querySelector('.more').onclick = () => setTimeout(more, 200);
        more();
      </script>`);
    await page.route('https://shop.test/more', (route) => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://shop.test/more');
    const r = await paginate(page, fakeJudge(), recipe, await firstRows(), { title: 'Sensors' }, { waitMs: 1500 });
    expect(r.mechanism?.kind).toBe('load_more');
    expect(r.rows.map((x) => x.code)).toEqual(all);
    expect(r.stop).toBe('end_of_list');
  });

  it('reports a page the server fails to serve and skips it when paging by URL', async () => {
    const all = products(25);
    await page.route('https://shop.test/err**', (route) => {
      const p = Number(new URL(route.request().url()).searchParams.get('p') ?? 1);
      if (p === 3) return route.fulfill({ status: 500, contentType: 'text/html', body: shell('<div class="grid"></div><p>Error</p>') });
      const items = all.slice((p - 1) * PER_PAGE, p * PER_PAGE);
      const nav = [2, 3].map((i) => `<a href="/err?p=${i}">${i}</a>`).join(' ');
      return route.fulfill({ contentType: 'text/html', body: shell(`<div class="grid">${items.map(card).join('')}</div><nav class="pagination">${nav}</nav>`) });
    });
    await page.goto('https://shop.test/err');
    const r = await paginate(page, fakeJudge(), recipe, await firstRows(), { title: 'Sensors' }, { waitMs: 1000 });
    expect(r.failed_pages).toEqual([3]);
    expect(r.rows).toHaveLength(20); // everything except the 5 products on the broken page
  });

  it('makes extra passes when the order shifts between loads and the total is not reached', async () => {
    const all = products(30);
    let load = 0;
    await page.route('https://shop.test/shuffle**', (route) => {
      const p = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
      // Each load serves a different rotation of the catalogue, so pages overlap and products go missing.
      const shift = (load++ * 7) % all.length;
      const order = [...all.slice(shift), ...all.slice(0, shift)];
      const items = order.slice((p - 1) * PER_PAGE, p * PER_PAGE);
      const nav = [2, 3].map((i) => `<a href="/shuffle?page=${i}">${i}</a>`).join(' ');
      return route.fulfill({ contentType: 'text/html', body: shell(`<div class="grid">${items.map(card).join('')}</div><nav class="pagination">${nav}</nav>`) });
    });
    await page.goto('https://shop.test/shuffle');
    const r = await paginate(page, fakeJudge(), withTotal(30), await firstRows(), { title: 'Sensors' }, { waitMs: 800, maxPasses: 4 });
    expect(r.passes.length).toBeGreaterThan(1);
    expect(r.repeated_rows).toBeGreaterThan(0);
    expect(r.rows.length).toBeGreaterThan(r.passes[0]!.new_rows);
    expect(new Set(r.rows.map((x) => x.code)).size).toBe(r.rows.length);
  });

  it('does not give up on pages of repeats before the advertised total says the list ends', async () => {
    const all = products(40);
    await page.route('https://shop.test/ties**', (route) => {
      const p = Number(new URL(route.request().url()).searchParams.get('page') ?? 1);
      // Pages 3 to 5 repeat pages 1, 2, 1 (ties resolved differently); the rest follows on pages 6 to 11.
      const page = (k: number) => all.slice((k - 1) * PER_PAGE, k * PER_PAGE);
      const items = p > 11 ? [] : p === 3 || p === 5 ? page(1) : p === 4 ? page(2) : p <= 2 ? page(p) : page(p - 3);
      const nav = [2, 3].map((i) => `<a href="/ties?page=${i}">${i}</a>`).join(' ');
      return route.fulfill({ contentType: 'text/html', body: shell(`<div class="grid">${items.map(card).join('')}</div><nav class="pagination">${nav}</nav>`) });
    });
    await page.goto('https://shop.test/ties');
    const r = await paginate(page, fakeJudge(), withTotal(40), await firstRows(), { title: 'Sensors' }, { waitMs: 500, maxPasses: 1 });
    expect(r.rows).toHaveLength(40);
    expect(r.stop).toBe('reached_total');
  });
});
