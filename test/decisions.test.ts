import { describe, expect, it } from 'vitest';
import { decideNext, interpretClassification } from '../src/classify.js';
import { decideGate, gateRequest } from '../src/gate.js';
import type { Snapshot } from '../src/types.js';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  url: 'https://x.test/p', title: 't', lang: 'en', headings: [], text: '', overlays: [], groups: [], fingerprint: 'f',
  controls: [
    { id: 'c1', label: 'Decline', role: 'button', region: 'none', in_overlay: true },
    { id: 'c2', label: 'Accept all', role: 'button', region: 'none', in_overlay: true },
    { id: 'c3', label: 'Products', role: 'link', region: 'main', href: '/products' },
  ],
  ...over,
});
const choiceAns = (choice: string, confidence = 0.9) => ({ choice, confidence, probabilities: { [choice]: confidence } });

describe('gate decisions', () => {
  const role = (r: string, p = 0.9) => ({ choice: r, confidence: p, probabilities: { [r]: p } });
  it('does not click when Jev sees no gate, even if a control is clearly a reject button', () => {
    expect(decideGate(snap(), { gate_present: { noul: 0.2 }, role_c1: role('reject_optional') })).toMatchObject({ action: 'stop', reason: 'no-gate' });
  });
  it('prefers rejecting optional cookies over accepting, whatever order the controls appear in', () => {
    const d = decideGate(snap(), { gate_present: { noul: 0.9 }, role_c2: role('accept_all', 0.99), role_c1: role('reject_optional', 0.7) });
    expect(d).toMatchObject({ action: 'click', id: 'c1', role: 'reject_optional' });
  });
  it('falls back to accepting when no reject control exists', () => {
    expect(decideGate(snap(), { gate_present: { noul: 0.9 }, role_c1: role('open_settings'), role_c2: role('accept_all') })).toMatchObject({ action: 'click', id: 'c2' });
  });
  it('never presses settings, region switches or other controls', () => {
    const d = decideGate(snap(), { gate_present: { noul: 0.9 }, role_c1: role('open_settings'), role_c2: role('switch_region'), role_c3: role('other') });
    expect(d).toMatchObject({ action: 'stop', reason: 'no-target' });
  });
  it('ignores roles below the probability floor', () => {
    expect(decideGate(snap(), { gate_present: { noul: 0.9 }, role_c1: role('reject_optional', 0.4) })).toMatchObject({ action: 'stop', reason: 'no-target' });
  });
  it('never clicks an id that was not observed', () => {
    expect(decideGate(snap(), { gate_present: { noul: 0.9 }, role_c99: role('reject_optional') })).toMatchObject({ action: 'stop' });
  });
  it('asks about overlay controls only when an overlay exists', () => {
    const { offered, questions } = gateRequest(snap());
    expect(offered).toEqual(['c1', 'c2']);
    expect(Object.keys(questions)).toEqual(['gate_present', 'role_c1', 'role_c2']);
  });
});


describe('site identity for the gate URL invariant', () => {
  it('treats a locale switch as a different site', async () => {
    const { siteKey } = await import('../src/gate.js');
    expect(siteKey('https://hager.com/de/katalog/')).not.toBe(siteKey('https://hager.com/en-tr'));
    expect(siteKey('https://www.balluff.com/en-de/products')).toBe(siteKey('https://www.balluff.com/en-de/products?x=1'));
    expect(siteKey('https://www.ifm.com/de/en/category')).toBe('www.ifm.com/de');
    expect(siteKey('https://shop.example.com/products/a')).toBe('shop.example.com');
  });
});


describe('probe verdicts', async () => {
  const { itemsFromProbes, probeLinks } = await import('../src/probe.js');
  it('one series page is enough to call the list a family list', () => {
    expect(itemsFromProbes([{ url: 'a', kind: 'single_product', confidence: 0.9 }, { url: 'b', kind: 'series_with_variants', confidence: 0.8 }])).toBe('product_family');
  });
  it('needs every confident probe to be a single product to call the list leaf products', () => {
    expect(itemsFromProbes([{ url: 'a', kind: 'single_product', confidence: 0.9 }, { url: 'b', kind: 'single_product', confidence: 0.7 }])).toBe('individual_product');
    expect(itemsFromProbes([{ url: 'a', kind: 'single_product', confidence: 0.9 }, { url: 'b', kind: 'other', confidence: 0.9 }])).toBeUndefined();
  });
  it('ignores low-confidence and failed probes', () => {
    expect(itemsFromProbes([{ url: 'a', kind: 'series_with_variants', confidence: 0.3 }, { url: 'b', error: 'timeout' }])).toBeUndefined();
  });
  it('probes distinct same-site item pages, not the listing itself or other sites', () => {
    const group = { item_links: ['https://x.test/list#top', 'https://x.test/p/1', 'https://x.test/p/1#specs', 'https://other.test/p/2', null, 'https://x.test/p/3', 'https://x.test/p/4'] } as any;
    expect(probeLinks(group, 'https://x.test/list')).toEqual(['https://x.test/p/1', 'https://x.test/p/3']);
  });
});


describe('configurable products', async () => {
  const { itemsFromProbes } = await import('../src/probe.js');
  it('treats a product with an options configurator as a family even if Jev calls the page a single product', () => {
    expect(itemsFromProbes([{ url: 'a', kind: 'single_product', confidence: 0.97, configurator: 0.8, one_exact_code: 0.2 }, { url: 'b', kind: 'single_product', confidence: 0.9, configurator: 0.1 }])).toBe('product_family');
  });
  it('keeps a page that names one exact article as a product, even with a sibling-variant switcher', () => {
    expect(itemsFromProbes([{ url: 'a', kind: 'single_product', confidence: 0.97, configurator: 0.9, one_exact_code: 0.95 }, { url: 'b', kind: 'single_product', confidence: 0.9, configurator: 0.9, one_exact_code: 0.9 }])).toBe('individual_product');
  });
});

describe('crawl action from judgments', () => {
  const judged = (o: { page?: string; main?: string; items?: Record<string, string>; related?: Record<string, number>; needs?: number; self?: string; selfConf?: number; code?: number; config?: number }) =>
    interpretClassification(Object.keys(o.items ?? {}), {
      ...Object.fromEntries(Object.entries(o.related ?? {}).map(([g, p]) => [`related_${g}`, { noul: p }])),
      page_kind: choiceAns(o.page ?? 'product_listing'),
      main_group: choiceAns(o.main ?? 'none'),
      needs_input: { noul: o.needs ?? 0 },
      self_kind: choiceAns(o.self ?? 'listing', o.selfConf ?? 0.9),
      self_one_exact_code: { noul: o.code ?? 0 },
      self_configurator: { noul: o.config ?? 0 },
      view_all: choiceAns('none'),
      ...Object.fromEntries(Object.entries(o.items ?? {}).map(([g, k]) => [`item_kind_${g}`, choiceAns(k)])),
    });
  it('extracts a list of individual products and expands families or categories', () => {
    expect(decideNext(judged({ main: 'g1', items: { g1: 'individual_product' } }), 'individual_product')).toBe('extract');
    expect(decideNext(judged({ main: 'g1', items: { g1: 'product_family' } }), 'product_family')).toBe('expand_items');
    expect(decideNext(judged({ page: 'category_hub', main: 'g1', items: { g1: 'product_category' } }), 'product_category')).toBe('expand_items');
  });
  it('probe results override what the cards looked like', () => {
    expect(decideNext(judged({ main: 'g1', items: { g1: 'individual_product' } }), 'product_family')).toBe('expand_items');
  });
  it('a single product page with a related-products carousel is a product page, not a listing', () => {
    expect(decideNext(judged({ page: 'product_detail', main: 'g1', items: { g1: 'individual_product' }, related: { g1: 0.9 }, self: 'single_product', code: 0.9 }), undefined)).toBe('product_page');
  });
  it('a family page with a listed variant table is extracted even when it also has a configurator', () => {
    expect(decideNext(judged({ page: 'product_detail', main: 'g1', items: { g1: 'individual_product' }, self: 'series_with_variants', config: 0.95, code: 0.1 }), 'individual_product')).toBe('extract');
  });
  it('treats a page as detail-like when Jev is sure it is about one series, even if page kind is unsure', () => {
    expect(decideNext(judged({ page: 'family_listing', main: 'g1', items: { g1: 'navigation' }, self: 'series_with_variants', selfConf: 0.99 }), 'navigation')).toBe('series_page');
  });
  it('a family page with a variant table is extracted', () => {
    expect(decideNext(judged({ page: 'product_detail', main: 'g1', items: { g1: 'individual_product' }, self: 'series_with_variants', code: 0.1 }), 'individual_product')).toBe('extract');
  });
  it('a product page with an options configurator and no exact code is a configurable family', () => {
    expect(decideNext(judged({ page: 'product_detail', self: 'single_product', config: 0.9, code: 0.1 }), undefined)).toBe('configurable_family');
  });
  it('a series page whose variants are not listed is a series page, and never expands its carousel', () => {
    expect(decideNext(judged({ page: 'product_detail', main: 'g3', items: { g3: 'product_family' }, self: 'series_with_variants' }), 'product_family')).toBe('series_page');
  });
  it('ignores a related-products group chosen as main list on a product or series page', async () => {
    const { listedMainItems } = await import('../src/classify.js');
    expect(listedMainItems(judged({ page: 'product_detail', main: 'g1', items: { g1: 'individual_product' }, related: { g1: 0.9 } }))).toBeUndefined();
    expect(listedMainItems(judged({ page: 'product_detail', main: 'g1', items: { g1: 'individual_product' }, related: { g1: 0.1 } }))).toBe('individual_product');
  });
  it('keeps a "Recommended products" list as the main list on a listing page', async () => {
    const { listedMainItems } = await import('../src/classify.js');
    expect(listedMainItems(judged({ page: 'family_listing', main: 'g1', items: { g1: 'product_category' }, related: { g1: 0.81 } }))).toBe('product_category');
  });
  it('a configurator on a page that names one exact article stays a product page', () => {
    expect(decideNext(judged({ page: 'product_detail', self: 'single_product', config: 0.9, code: 0.9 }), undefined)).toBe('product_page');
  });
  it('reports needs_input only when no product list is present', () => {
    expect(decideNext(judged({ page: 'category_hub', needs: 0.8 }), undefined)).toBe('needs_input');
    expect(decideNext(judged({ main: 'g1', items: { g1: 'individual_product' }, needs: 0.8 }), 'individual_product')).toBe('extract');
  });
  it('never extracts on page kind alone', () => {
    expect(decideNext(judged({ page: 'product_listing', main: 'g1', items: { g1: 'content' } }), 'content')).toBe('stop');
    expect(decideNext(judged({ page: 'product_listing' }), undefined)).toBe('stop');
  });
});

describe('probe memo', async () => {
  const { ProbeMemo } = await import('../src/assess.js');
  it('skips probing only after two siblings agreed', () => {
    const m = new ProbeMemo();
    m.record('p|individual_product', 'product_family');
    expect(m.known('p|individual_product')).toBeUndefined();
    m.record('p|individual_product', 'product_family');
    expect(m.known('p|individual_product')).toBe('product_family');
    expect(m.known('other|individual_product')).toBeUndefined();
  });
  it('does not trust siblings that disagreed', () => {
    const m = new ProbeMemo();
    m.record('p|x', 'product_family');
    m.record('p|x', 'individual_product');
    m.record('p|x', 'product_family');
    expect(m.known('p|x')).toBeUndefined();
  });
});
