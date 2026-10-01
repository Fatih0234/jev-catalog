import { describe, expect, it } from 'vitest';
import { alignSlots, applyRecipe, buildRecipe, mergeByIdentity, parseTotal, pickCounts, recipeFit, type PageItems, type RawItem } from '../src/listing.js';

const card = (code: string, range: string, extra: Partial<RawItem> = {}): RawItem => ({
  leaves: [
    { path: 'H3:0', parent: '.', value: `Sensor ${code}` },
    { path: 'DIV:0/SPAN:0', parent: 'DIV:0', value: 'Measuring range' },
    { path: 'DIV:0/SPAN:1', parent: 'DIV:0', value: range },
    { path: 'BUTTON:0', parent: '.', value: 'Add to cart' },
    { path: 'SPAN:0', parent: '.', value: code },
  ],
  links: ['https://x.test/compare', `https://x.test/p/${code}`],
  ...extra,
});
const items = [card('A-1', '0..10 bar'), card('A-2', '0..16 bar'), card('A-3', '0..25 bar')];
const pageItems = (its: RawItem[]): PageItems => ({ url: 'https://x.test/list', item_signature: 'DIV.card', container_signature: 'DIV.grid', containers: 1, items: its, count_texts: ['3 Filter', '1–3 of 1,204 results'] });

describe('alignSlots', () => {
  it('turns a constant followed by a varying value in the same parent into a label, but not a constant button', () => {
    const al = alignSlots(items);
    expect(Object.values(al.pairs)).toEqual(['Measuring range']);
    expect(al.rows[1]!['label:Measuring range']).toBe('0..16 bar');
    const button = al.slots.find((s) => s.samples[0] === 'Add to cart');
    expect(button).toMatchObject({ coverage: 1, distinct: 1 / 3 });
  });
  it('keeps the constant as a plain value when the pair was rejected', () => {
    const al = alignSlots(items, {});
    expect(al.rows[0]!['DIV:0/SPAN:0']).toBe('Measuring range');
    expect(al.rows[0]!['label:Measuring range']).toBeUndefined();
  });
  it('does not invent labels from two items', () => {
    expect(Object.keys(alignSlots(items.slice(0, 2)).pairs)).toEqual([]);
  });
});

describe('buildRecipe', () => {
  const al = alignSlots(items);
  const asked = al.slots.map((s) => s.key);
  const role = (key: string) => (key === 'H3:0' ? 'name' : key.startsWith('label:') ? 'spec' : key === 'BUTTON:0' ? 'chrome' : 'order_code');
  const answers = Object.fromEntries([
    ...asked.map((k, i) => [`role_${i}`, { choice: role(k), confidence: 0.9 }]),
    ['count_0', { choice: 'other', confidence: 0.9 }],
    ['count_1', { choice: 'product_count', confidence: 0.9 }],
  ]);
  const recipe = buildRecipe(pageItems(items), al, asked, answers);

  it('drops chrome, names labelled fields by their label, and prefers an order code as identity', () => {
    expect(recipe.fields.map((f) => f.name)).toEqual(['name', 'Measuring range', 'order_code']);
    expect(recipe.dropped.map((d) => d.role)).toEqual(['chrome']);
    expect(recipe.identity).toBe('order_code');
    expect(recipe.total).toEqual({ text: '1–3 of 1,204 results', value: 1204, kind: 'product_count' });
  });
  it('uses the item link that differs across items, not the shared compare link', () => {
    expect(applyRecipe(recipe, items)[2]).toMatchObject({ order_code: 'A-3', 'Measuring range': '0..25 bar', _url: 'https://x.test/p/A-3' });
  });
  it('does not pick a repeated value as identity', () => {
    const dup = [card('A-1', '1'), card('A-1', '2'), card('A-3', '3')];
    const dal = alignSlots(dup);
    const r = buildRecipe(pageItems(dup), dal, dal.slots.map((s) => s.key), Object.fromEntries(dal.slots.map((s, i) => [`role_${i}`, { choice: role(s.key) }])));
    // Code, name and link all repeat for A-1; the unique measuring range must not become the identity.
    expect(r.identity).toBeUndefined();
  });
});

describe('recipe reuse', () => {
  it('is refused when the new page has a column the recipe never judged', async () => {
    const { RecipeMemo } = await import('../src/listing.js');
    const al = alignSlots(items);
    const asked = al.slots.map((s) => s.key);
    const recipe = buildRecipe(pageItems(items), al, asked, Object.fromEntries(asked.map((k, i) => [`role_${i}`, { choice: 'spec' }])));
    const memo = new RecipeMemo();
    memo.add(recipe);
    const same = [card('B-1', '1 bar'), card('B-2', '2 bar'), card('B-3', '3 bar')];
    expect(memo.find(pageItems(same))).toBe(recipe);
    const wider = same.map((c, i) => ({ ...c, leaves: [...c.leaves, { path: 'P:9', parent: '.', value: `${i} Nm`, label: 'Torque' }] }));
    expect(memo.find(pageItems(wider))).toBeUndefined();
  });
});

describe('recipeFit', () => {
  it('fits pages of the same template and rejects a different one', () => {
    const al = alignSlots(items);
    const asked = al.slots.map((s) => s.key);
    const recipe = buildRecipe(pageItems(items), al, asked, Object.fromEntries(asked.map((k, i) => [`role_${i}`, { choice: k === 'BUTTON:0' ? 'chrome' : 'spec' }])));
    expect(recipeFit(recipe, [card('B-1', '1 bar'), card('B-2', '2 bar'), card('B-3', '3 bar')])).toBe(1);
    const other: RawItem[] = [1, 2, 3].map((n) => ({ leaves: [{ path: 'P:0', parent: '.', value: `News ${n}` }], links: [] }));
    expect(recipeFit(recipe, other)).toBe(0);
  });
});

describe('parseTotal', () => {
  it.each([
    ['1–50 of 3,823 results', 3823],
    ['3.823 Treffer', 3823],
    ['49 / 2960', 2960],
    ['Ergebnisse: 97', 97],
    ['1 - 20 von 1 204 Produkten', 1204],
  ])('%s -> %d', (text, n) => expect(parseTotal(text)).toBe(n));
});

describe('mergeByIdentity', () => {
  it('merges a fixed-column clone into the full row instead of keeping two rows', () => {
    const rows: Record<string, string>[] = [{ code: '1', d: '32' }, { code: '2', d: '40' }, { code: '1' }, { code: '2', h: '9' }];
    expect(mergeByIdentity(rows, 'code')).toEqual([{ code: '1', d: '32' }, { code: '2', d: '40', h: '9' }]);
  });
});

describe('pickCounts', () => {
  const texts = ['All results 49', 'Products 31', 'Page 1 of 2', '3 Filter'];
  const a = (kinds: string[]) => Object.fromEntries(kinds.map((k, i) => [`count_${i}`, { choice: k, confidence: 0.9 }]));
  it('prefers a product count over a search-result count and reads the page count separately', () => {
    expect(pickCounts(texts, a(['result_count', 'product_count', 'page_count', 'other']), 20)).toEqual({
      total: { text: 'Products 31', value: 31, kind: 'product_count' },
      pages: { text: 'Page 1 of 2', value: 2 },
    });
  });
  it('rejects a total smaller than the rows already shown', () => {
    expect(pickCounts(texts, a(['other', 'product_count', 'other', 'other']), 40).total).toBeUndefined();
  });
});

describe('progress indicator', () => {
  it('reads "49 / 2960" as the total when 49 rows are shown and Jev was unsure', () => {
    expect(pickCounts(['49 / 2960'], { count_0: { choice: 'product_count', confidence: 0.19 } }, 49).total).toEqual({ text: '49 / 2960', value: 2960, kind: 'product_count' });
    expect(pickCounts(['2 / 2960'], {}, 49).total).toBeUndefined();
  });
});

describe('split judgement', () => {
  it('accepts "1728 found" when Jev splits it between product and result count', () => {
    const a = { count_0: { choice: 'result_count', confidence: 0.51, probabilities: { product_count: 0.4, result_count: 0.51, page_count: 0, other: 0.09 } } };
    expect(pickCounts(['1728 found'], a, 20).total).toEqual({ text: '1728 found', value: 1728, kind: 'result_count' });
  });
});
