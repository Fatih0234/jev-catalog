import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileDetailRecipe, observeDetail, pageHealth, readDetail, stabilizeSection, type DetailRecipe, type DetailRecipeV1 } from '../src/detail.js';
import {
  detailFieldKey,
  normalizeDetailCode,
  parseDetailListing,
  sameDetailDocument,
  sampleDetailTargets,
  targetsFromListing,
} from '../src/detail-policy.js';
import { acceptedDetailRole } from '../src/detail-questions.js';
import type { ListingRecipe, Row } from '../src/listing.js';
import { detailRouteHandler, detailTargets, scriptedDetailJudge } from './helpers/detail-site.js';

// ---------- Lead-authored policy and question helpers ----------

describe('normalizeDetailCode', () => {
  it('strips label prefixes but keeps codes like SKU-001 or CODE123 intact', () => {
    expect(normalizeDetailCode('Item no. 221-413')).toBe('221-413');
    expect(normalizeDetailCode('Article Number: 64676-C9')).toBe('64676-C9');
    expect(normalizeDetailCode('SKU-001')).toBe('SKU-001');
    expect(normalizeDetailCode('CODE123')).toBe('CODE123');
    expect(normalizeDetailCode('order code  IFS240 ')).toBe('IFS240');
    expect(normalizeDetailCode('007')).toBe('007');
  });
});

describe('verifyDetailIdentity', () => {
  it('matches only the complete observed code, never a substring', async () => {
    const { verifyDetailIdentity } = await import('../src/detail-policy.js');
    expect(verifyDetailIdentity('A-1', ['A-1'])).toBe('matched');
    expect(verifyDetailIdentity('A-1', ['A-10'])).toBe('mismatch');
    expect(verifyDetailIdentity('007', ['07'])).toBe('mismatch');
    expect(verifyDetailIdentity('A-1', ['A-1', 'B-2'])).toBe('unverified');
    expect(verifyDetailIdentity('A-1', [])).toBe('unverified');
    expect(verifyDetailIdentity(undefined, ['A-1'])).toBe('unverified');
  });
});

describe('sameDetailDocument', () => {
  it('allows hash-only change but rejects path and search changes', () => {
    expect(sameDetailDocument('https://s.test/p/1', 'https://s.test/p/1#specs')).toBe(true);
    expect(sameDetailDocument('https://s.test/p/1', 'https://s.test/p/1?productId=2')).toBe(false);
    expect(sameDetailDocument('https://s.test/p/1', 'https://s.test/p/2')).toBe(false);
  });
});

describe('detailFieldKey', () => {
  it('keeps case and section qualification: D and d differ, as do two Voltage labels', () => {
    expect(detailFieldKey(['Dimensions'], 'D')).not.toBe(detailFieldKey(['Dimensions'], 'd'));
    expect(detailFieldKey(['Specifications'], 'Voltage')).not.toBe(
      detailFieldKey(['Specifications', 'Electrical data'], 'Voltage'),
    );
  });
});

describe('sampleDetailTargets', () => {
  it('dedupes by URL without the fragment, keeps the query, picks first/mid/last', () => {
    const t = (u: string) => ({ url: u });
    const five = [1, 2, 3, 4, 5].map((i) => t(`https://s.test/p/${i}?v=1`));
    expect(sampleDetailTargets(five).map((x) => x.url)).toEqual([
      'https://s.test/p/1?v=1',
      'https://s.test/p/3?v=1',
      'https://s.test/p/5?v=1',
    ]);
    const dupes = [t('https://s.test/p/1'), t('https://s.test/p/1#top'), t('https://s.test/p/2')];
    expect(sampleDetailTargets(dupes)).toHaveLength(2);
  });
  it('rejects credentials, non-http protocols and shared URLs with conflicting codes', () => {
    const t = (u: string, c?: string) => ({ url: u, expected_code: c });
    const got = sampleDetailTargets([t('javascript:void(0)'), t('https://u:pw@s.test/p'), t('https://s.test/ok')]);
    expect(got.map((x) => x.url)).toEqual(['https://s.test/ok']);
    // Two rows pointing at one URL with different expected codes must not merge or pick one.
    const shared = sampleDetailTargets([t('https://s.test/p', 'A-1'), t('https://s.test/p', 'A-2')]);
    expect(shared).toEqual([]);
  });
});

describe('targetsFromListing', () => {
  const recipe: ListingRecipe = {
    version: 1,
    source_url: 'https://s.test/list',
    item_signature: 'DIV.card',
    container_signature: 'DIV.grid',
    pairs: {},
    fields: [{ key: 'k', name: 'Code', role: 'order_code', confidence: 1, coverage: 1 }],
    dropped: [],
    identity: 'Code',
  };
  const row = (r: Partial<Row>): Row => ({ Code: 'Item no. A-1', ...r });
  it('reports missing urls, wrong sites, shared urls and missing codes', () => {
    const rows: Row[] = [
      row({ _url: 'https://s.test/p/a-1' }),
      row({}),
      row({ _url: 'https://other.test/p/a-1' }),
      row({ _url: 'https://s.test/p/nocode', Code: '' }),
      row({ _url: 'javascript:void(0)' }),
      row({ _url: 'https://s.test/p/shared' }),
      row({ _url: 'https://s.test/p/shared', Code: 'Item no. B-2' }),
    ];
    const { targets, issues } = targetsFromListing(recipe, rows);
    expect(issues.map((i) => i.reason).sort()).toEqual([
      'invalid_url', 'missing_code', 'missing_url', 'shared_url', 'shared_url', 'wrong_site',
    ].sort());
    const nocode = targets.find((t) => t.url === 'https://s.test/p/nocode');
    expect(nocode && 'expected_code' in nocode ? nocode.expected_code : undefined).toBeUndefined();
    expect(targets[0]).toMatchObject({ url: 'https://s.test/p/a-1', expected_code: 'A-1' });
    // The shared URL is reported for both rows.
    expect(issues.filter((i) => i.reason === 'shared_url').map((i) => i.row).sort()).toEqual([5, 6]);
  });
});

describe('parseDetailListing', () => {
  const good = { recipe: { version: 1, source_url: 'https://s.test/l', fields: [{ name: 'Code', role: 'order_code' }] }, rows: [{ Code: 'A-1', _url: 'https://s.test/p' }] };
  it('accepts a saved listing and rejects malformed shapes before any browser or key is touched', () => {
    expect(parseDetailListing(good).rows).toHaveLength(1);
    expect(() => parseDetailListing(null)).toThrow('listing');
    expect(() => parseDetailListing({ recipe: { version: 1 }, rows: null })).toThrow();
    expect(() => parseDetailListing({ recipe: { version: 1, source_url: 'javascript:x' }, rows: [] })).toThrow();
    expect(() => parseDetailListing({ recipe: { version: 1, source_url: 'https://s.test', fields: { Code: {} } }, rows: [] })).toThrow();
    expect(() => parseDetailListing({ recipe: good.recipe, rows: [{ Code: 5 }] })).toThrow();
  });
});

describe('acceptedDetailRole', () => {
  it('rejects malformed answers, unknown choices and probabilities below the threshold', () => {
    expect(acceptedDetailRole(undefined, ['specifications'])).toBeUndefined();
    expect(acceptedDetailRole('specifications', ['specifications'])).toBeUndefined();
    expect(acceptedDetailRole({ choice: 'specifications', probabilities: { specifications: 0.4 } }, ['specifications'])).toBeUndefined();
    expect(acceptedDetailRole({ choice: 'nonsense', probabilities: { nonsense: 0.9 } }, ['specifications'])).toBeUndefined();
    expect(acceptedDetailRole({ choice: 'specifications', probabilities: { specifications: 0.9 } }, ['specifications'])).toBe('specifications');
    expect(acceptedDetailRole({ choice: 'specifications', probabilities: { specifications: Number.NaN } }, ['specifications'])).toBeUndefined();
  });
});

describe('stabilizeSection', () => {
  it('replaces only a literal whole-token expected-code match in a heading', () => {
    expect(stabilizeSection(['Maße FIX-A101'], 'Item no. FIX-A101')).toEqual(['Maße {code}']);
    expect(stabilizeSection(['Maße FIX-A1010'], 'FIX-A101')).toEqual(['Maße FIX-A1010']);
    expect(stabilizeSection(['Dimensions'], 'FIX-A101')).toEqual(['Dimensions']);
  });
});

describe('pageHealth', () => {
  it('blocks on HTTP errors and lead error regexes, not on a login price row', () => {
    expect(pageHealth(500, { scope: 'main', text: 'anything', title: 'Product' })).toBe('blocked');
    expect(pageHealth(200, { scope: 'product', text: 'Generic Error: try again', title: 'Error' })).toBe('blocked');
    expect(pageHealth(200, { scope: 'main', text: 'Generic Error', title: 'Generic Error' })).toBe('blocked');
    expect(pageHealth(200, { scope: 'none', text: '' })).toBe('no_content');
    const legit = 'Product detail '.repeat(60) + 'Your price: please log in';
    expect(pageHealth(200, { scope: 'main', text: legit, title: 'Rotary union FIX-N131' })).toBe('ok');
  });
});

// ---------- compileDetailRecipe / readDetail against the fixture site ----------

describe('detail recipe', () => {
  let browser: Browser;
  let context: BrowserContext;
  let listingPage: Page;
  let requested: string[];
  let recipe: DetailRecipeV1;

  const compileTargets = (paths: string[], opts: Parameters<typeof compileDetailRecipe>[3] = {}) =>
    compileDetailRecipe(context, scriptedDetailJudge(), detailTargets('https://detail.test', paths), { recipeVersion: 1, pauseMs: 0, revealTimeoutMs: 120, ...opts } as Parameters<typeof compileDetailRecipe>[3] & { recipeVersion: 1 });

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    requested = [];
    await context.route('**', detailRouteHandler(requested));
    listingPage = await context.newPage();
    await listingPage.goto('https://detail.test/list');
  });
  afterAll(async () => browser.close());

  it('compiles from A/B/C: matched identities, union fields, reveals, downloads', async () => {
    const judge = scriptedDetailJudge();
    const result = await compileDetailRecipe(context, judge, detailTargets('https://detail.test'), {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 120,
    });
    recipe = result.recipe;

    expect(result.samples.map((s) => [s.status, s.identity])).toEqual([
      ['ok', 'matched'],
      ['ok', 'matched'],
      ['ok', 'matched'],
    ]);
    const a = result.samples[0]!;
    expect(a.values[detailFieldKey(['Dimensions'], 'A')]).toBe('1/8"-27 NPT RH');
    expect(a.values[detailFieldKey(['Dimensions'], 'D')]).toBe('28.372 mm');
    expect(a.values[detailFieldKey(['Dimensions'], 'd')]).toBe('12 mm');
    expect(a.values[detailFieldKey(['Specifications'], 'Voltage')]).toBe('24 V');
    expect(a.values[detailFieldKey(['Specifications', 'Electrical data'], 'Voltage')]).toBe('24 V DC');
    expect(a.values[detailFieldKey(['Specifications', 'Electrical data'], 'Current')]).toBe('2 A');
    // The nested "Variant selection" accordion was judged "other" and never clicked.
    expect(a.reveals.map((r) => r.label)).not.toContain('Variant selection');
    expect(Object.values(a.values).join(' ')).not.toContain('M12x1');
    expect(a.downloads.map((d) => d.url)).toContain('https://detail.test/files/FIX-A101-datasheet.pdf');
    expect(requested.filter((u) => u.includes('/files/'))).toEqual([]);
    expect(a.reveals.map((r) => r.label)).toEqual(['Dimensions', 'Specifications', 'Electrical data', 'Downloads']);

    const material = recipe.fields.find((f) => f.key === detailFieldKey(['Compliance'], 'Material'));
    expect(material?.label).toBe('Material');
    expect(material?.sample_coverage).toBeCloseTo(1 / 3);
    expect(recipe.sections.map((s) => [s.role, ...s.section])).toContainEqual(['specifications', 'Dimensions']);
    expect(recipe.templates?.length).toBeGreaterThanOrEqual(3);
    // Identity once per sample; content asks repeat whenever new shapes mount after a reveal.
    const steps = judge.trace.map((t) => t.step);
    expect(steps.filter((s) => s === 'detail-identity')).toHaveLength(3);
    expect(steps.filter((s) => s === 'detail-content').length).toBeGreaterThanOrEqual(6);

    expect(listingPage.url()).toBe('https://detail.test/list');
    expect(await listingPage.title()).toBe('Fixture list');
    expect(context.pages()).toEqual([listingPage]);
  });

  it('replays each compiled template without false reveal_missing', async () => {
    const page = await context.newPage();
    try {
      for (const [path, code] of [['/a', 'FIX-A101'], ['/b', 'FIX-B202'], ['/c', 'FIX-C303']] as const) {
        const r = await readDetail(page, recipe, { url: `https://detail.test${path}`, expected_code: code }, { revealTimeoutMs: 120 });
        expect(r.identity).toBe('matched');
        expect(r.status, `${path}: ${JSON.stringify(r.issues)}`).toBe('ok');
        expect(r.issues).toEqual([]);
      }
    } finally {
      await page.close();
    }
  });

  it('replays a same-signature page: novel field is kept and flagged, not silently merged', async () => {
    const page = await context.newPage();
    try {
      const r = await readDetail(page, recipe, { url: 'https://detail.test/d', expected_code: 'FIX-D404' }, { revealTimeoutMs: 120 });
      expect(r.identity).toBe('matched');
      expect(r.status).toBe('partial');
      expect(r.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('230 V');
      expect(r.values[detailFieldKey(['Technical data'], 'Coating')]).toBe('Nickel plated');
      expect(r.issues.some((i) => i.reason === 'schema_drift' && i.message?.includes('Coating'))).toBe(true);
      // The page's new accessories shape in the ignored Accessories section is drift too.
      expect(r.issues.some((i) => i.reason === 'schema_drift' && i.message?.includes('Accessories'))).toBe(true);
      expect(r.downloads.map((d) => d.url)).toContain('https://detail.test/files/FIX-D404-datasheet.pdf');
    } finally {
      await page.close();
    }
  });

  it('reports a required reveal missing on a known template', async () => {
    const page = await context.newPage();
    try {
      // A2 has A's initial control set but the nested accordion never mounts.
      const r = await readDetail(page, recipe, { url: 'https://detail.test/a2', expected_code: 'FIX-A101' }, { revealTimeoutMs: 120 });
      expect(r.identity).toBe('matched');
      expect(r.status).toBe('partial');
      expect(r.issues.some((i) => i.reason === 'reveal_missing' && i.message?.includes('Electrical data'))).toBe(true);
      expect(r.values[detailFieldKey(['Dimensions'], 'D')]).toBe('28.372 mm');
    } finally {
      await page.close();
    }
  });

  it('flags an unknown template instead of guessing controls', async () => {
    const page = await context.newPage();
    try {
      const r = await readDetail(page, recipe, { url: 'https://detail.test/x', expected_code: 'FIX-X141' }, { revealTimeoutMs: 120 });
      expect(r.identity).toBe('matched');
      expect(r.status).toBe('partial');
      expect(r.issues.some((i) => i.reason === 'template_drift')).toBe(true);
      // Its Documents tab is a declared kind never recorded for this template, so nothing was clicked.
      expect(r.reveals).toEqual([]);
      expect(r.values[detailFieldKey(['Technical data'], 'Weight')]).toBe('0.9 kg');
    } finally {
      await page.close();
    }
  });

  it('discards every value when a reveal silently switches the product at an unchanged URL', async () => {
    const result = await compileTargets(['/e']);
    const s = result.samples[0]!;
    expect(s.status).toBe('navigation_changed');
    expect(s.identity).toBe('mismatch');
    expect(s.observed_codes).toContain('FIX-E999');
    expect(s.values).toEqual({});
    expect(s.downloads).toEqual([]);
    expect(s.issues.some((i) => i.reason === 'product_changed')).toBe(true);
  });

  it('catches a delayed same-document query navigation after a click', async () => {
    const result = await compileTargets(['/f'], { revealTimeoutMs: 2_000 });
    const s = result.samples[0]!;
    expect(s.status).toBe('navigation_changed');
    expect(s.values).toEqual({});
    expect(s.issues.some((i) => i.reason === 'navigation_changed')).toBe(true);
    expect(s.reveals[0]).toMatchObject({ label: 'Documents', after_url: 'https://detail.test/f?productId=FIX-F999' });
    expect(s.final_url).toBe(s.reveals[0]!.after_url);
  });

  it('rejects an initial redirect to another origin before any Jev question', async () => {
    const judge = scriptedDetailJudge();
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/redir', expected_code: 'FIX-R111' }], { recipeVersion: 1, pauseMs: 0, revealTimeoutMs: 60 });
    const s = result.samples[0]!;
    expect(s.status).toBe('navigation_changed');
    expect(s.values).toEqual({});
    expect(s.final_url).toBe('https://other.test/landing');
    expect(judge.trace).toHaveLength(0);
  });

  it('treats an error page with the code only in the footer as blocked, and never asks content questions', async () => {
    const judge = scriptedDetailJudge();
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/g', expected_code: 'FIX-G707' }], {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    const s = result.samples[0]!;
    expect(['blocked', 'no_content']).toContain(s.status);
    expect(s.values).toEqual({});
    expect(judge.trace.filter((t) => t.step === 'detail-content')).toHaveLength(0);
    expect(result.recipe.sample_urls).toEqual([]);
  });

  it('does not flag a legitimate page that only shows a login price', async () => {
    const result = await compileTargets(['/n']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(['ok', 'partial']).toContain(s.status);
    expect(s.values[detailFieldKey(['Technical data'], 'Your price')]).toBe('please log in');
  });

  it('never reads hidden rows or nested hidden text', async () => {
    const result = await compileTargets(['/i']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    const all = Object.entries(s.values).map(([k, v]) => `${k} ${v}`).join(' ');
    expect(all).not.toContain('999 psi');
    expect(all).not.toContain('Secret');
    expect(all).not.toContain('Hidden value');
    expect(s.values[detailFieldKey(['Specifications'], 'Pressure')]).toBe('16 bar');
  });

  it('reads values through display:contents without collecting hidden spans', async () => {
    const result = await compileTargets(['/j']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey(['Specifications'], 'Pressure')]).toBe('69 bar / 1000 psi');
  });

  it('pairs only immediately adjacent dt+dd in a definition list', async () => {
    const result = await compileTargets(['/k']);
    const s = result.samples[0]!;
    expect(s.values[detailFieldKey(['Specifications'], 'New')]).toBe('NewValue');
    expect(s.values[detailFieldKey(['Specifications'], 'Width')]).toBe('10 mm');
    expect(Object.keys(s.values).some((k) => k.includes('"Old"'))).toBe(false);
  });

  it('namespaces same-label rows in sibling h2 sections under main', async () => {
    const result = await compileTargets(['/m']);
    const s = result.samples[0]!;
    expect(s.values[detailFieldKey(['Electrical'], 'Voltage')]).toBe('24 V');
    expect(s.values[detailFieldKey(['Mechanical'], 'Voltage')]).toBe('5 V');
  });

  it('unverified identity comes only from the header region, never a related section', async () => {
    const judge = scriptedDetailJudge();
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/p', expected_code: 'FIX-P111' }], { recipeVersion: 1, pauseMs: 0, revealTimeoutMs: 60 });
    const s = result.samples[0]!;
    expect(s.identity).toBe('unverified');
    expect(s.status).toBe('identity_unverified');
    expect(s.values).toEqual({});
    expect(judge.trace.filter((t) => t.step === 'detail-content')).toHaveLength(0);
  });

  it('finds the primary code below product navigation', async () => {
    const page = await context.newPage();
    try {
      await page.goto('https://detail.test/n1');
      const obs = await observeDetail(page);
      const primary = obs.candidates.filter((c) => c.value === '10.01.01.13237');
      expect(primary).toHaveLength(1);
      expect(obs.candidates.some((c) => c.value === '10.01.06.02802')).toBe(false);
    } finally {
      await page.close();
    }
    const judge = scriptedDetailJudge({ primaryPattern: /^10\.01\.01\.13237$/ });
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/n1', expected_code: '10.01.01.13237' }], { recipeVersion: 1, pauseMs: 0, revealTimeoutMs: 60 });
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('24 V');
  });

  it('verifies a new product with a different description', async () => {
    const judge = scriptedDetailJudge({ primaryPattern: /^\d{8}$/ });
    const result = await compileDetailRecipe(context, judge, detailTargets('https://detail.test', ['/lu1', '/lu2', '/lu3']), {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    expect(result.samples.map((s) => s.identity)).toEqual(['matched', 'matched', 'matched']);
    const page = await context.newPage();
    try {
      const r = await readDetail(page, result.recipe, { url: 'https://detail.test/lu4', expected_code: '50153812' }, { revealTimeoutMs: 60 });
      expect(r.identity).toBe('matched');
      expect(r.observed_codes).toContain('50153812');
    } finally {
      await page.close();
    }
  });

  it('handles a remounted DOM between observations with fresh ids only', async () => {
    const result = await compileTargets(['/t']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey(['Dimensions'], 'D')]).toBe('30 mm');
    expect(s.values[detailFieldKey(['Specifications'], 'Voltage')]).toBe('24 V');
  });

  it('refuses duplicate stable controls and never clicks either one', async () => {
    const result = await compileTargets(['/dup']);
    const s = result.samples[0]!;
    expect(s.status).toBe('partial');
    expect(s.issues.some((i) => i.reason === 'reveal_ambiguous')).toBe(true);
    expect(s.reveals).toEqual([]);
    expect(Object.values(s.values).join(' ')).not.toContain('4 A');
  });

  it('stops at the reveal cap and reports reveal_limit', async () => {
    const result = await compileTargets(['/many'], { revealTimeoutMs: 60 });
    const s = result.samples[0]!;
    expect(s.status).toBe('partial');
    expect(s.issues.some((i) => i.reason === 'reveal_limit')).toBe(true);
    expect(s.reveals.filter((r) => r.changed || !r.changed)).toHaveLength(16);
  }, 30_000);

  it('never clicks a control Jev did not accept at the role threshold', async () => {
    const judge = scriptedDetailJudge({ controlProbability: 0.4 });
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/a', expected_code: 'FIX-A101' }], {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.status).toBe('partial');
    expect(s.reveals).toEqual([]);
    expect(s.values).toEqual({});
    expect(s.issues.some((i) => i.reason === 'role_unverified')).toBe(true);
    expect(result.recipe.sections).toEqual([]);
  });

  it('malformed identity answers surface as unverified, never a guess', async () => {
    const inner = scriptedDetailJudge();
    const judge = {
      trace: inner.trace,
      async ask(step: string, state: unknown, questions: Record<string, unknown>) {
        const out = await inner.ask(step, state, questions as never);
        if (step === 'detail-identity') {
          // `choice` with no probabilities is a malformed answer, not a role.
          for (const k of Object.keys(out as object)) (out as Record<string, unknown>)[k] = { choice: 'primary_code' };
        }
        return out;
      },
    } as never;
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/a', expected_code: 'FIX-A101' }], { recipeVersion: 1, pauseMs: 0, revealTimeoutMs: 60 });
    expect(result.samples[0]!.status).toBe('identity_unverified');
    expect(result.samples[0]!.values).toEqual({});
  });

  it('returns observations but no recipe contribution for a target without an expected code', async () => {
    const judge = scriptedDetailJudge();
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/c' }], {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    const s = result.samples[0]!;
    expect(s.identity).toBe('unverified');
    expect(s.status).toBe('identity_unverified');
    expect(s.values).toEqual({});
    expect(s.observed_codes).toContain('FIX-C303');
    expect(result.recipe.sample_urls).toEqual([]);
  });

  it('keeps two differently labelled tables in one section to their own judgments', async () => {
    const result = await compileTargets(['/mix']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('230 V');
    expect(s.values[detailFieldKey(['Technical data'], 'Pressure')]).toBe('16 bar');
    const all = Object.keys(s.values).join(' ');
    expect(all).not.toContain('Compatible model');
    expect(all).not.toContain('Order code');
    const ign = result.recipe.ignored_sections ?? [];
    expect(ign.some((i) => i.section.includes('Technical data') && i.row_labels?.includes('Compatible model'))).toBe(true);
    const page = await context.newPage();
    try {
      const r = await readDetail(page, result.recipe, { url: 'https://detail.test/mix', expected_code: 'FIX-M505' }, { revealTimeoutMs: 60 });
      expect(r.status).toBe('ok');
      expect(r.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('230 V');
      expect(Object.keys(r.values).join(' ')).not.toContain('Compatible model');
      expect(r.issues.filter((i) => i.reason === 'schema_drift')).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it('flags a disjoint block in a declared section as drift and never extracts it', async () => {
    const page = await context.newPage();
    try {
      const r = await readDetail(page, recipe, { url: 'https://detail.test/d2', expected_code: 'FIX-D606' }, { revealTimeoutMs: 60 });
      expect(r.identity).toBe('matched');
      expect(r.status).toBe('partial');
      expect(r.issues.some((i) => i.reason === 'schema_drift')).toBe(true);
      expect(Object.keys(r.values).join(' ')).not.toContain('Mounting flange');
      expect(r.downloads.map((d) => d.url)).toContain('https://detail.test/files/FIX-D606-datasheet.pdf');
    } finally {
      await page.close();
    }
  });

  it('discards everything when a reveal turns the main region into an error page', async () => {
    const result = await compileTargets(['/err']);
    const s = result.samples[0]!;
    expect(s.status).toBe('blocked');
    expect(s.values).toEqual({});
    expect(s.downloads).toEqual([]);
    expect(s.issues.some((i) => i.reason === 'blocked_page')).toBe(true);
  });

  it('watches the full reveal budget after a slow-actionability click', async () => {
    const result = await compileTargets(['/f2'], { revealTimeoutMs: 500 });
    const s = result.samples[0]!;
    expect(s.status).toBe('navigation_changed');
    expect(s.values).toEqual({});
    expect(s.reveals[0]?.after_url).toContain('productId=FIX-Q001');
  });

  it('reports a large cross-origin content frame instead of silently reading the main document', async () => {
    const result = await compileTargets(['/frame']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.status).toBe('partial');
    expect(s.issues.some((i) => i.reason === 'unsupported_frame')).toBe(true);
    expect(s.values[detailFieldKey([], 'Voltage')]).toBe('24 V');
  });

  it('uses a table caption as a section label', async () => {
    const result = await compileTargets(['/cap']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey(['Ordering data'], 'Voltage')]).toBe('24 V');
  });

  it('collects a single-link downloads list without fetching it', async () => {
    const before = requested.length;
    const result = await compileTargets(['/one']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.downloads.map((d) => d.url)).toEqual(['https://detail.test/files/FIX-O121-datasheet.pdf']);
    expect(requested.slice(before).filter((u) => u.includes('/files/'))).toEqual([]);
  });

  it('rejects display:contents inside hidden ancestors and all-hidden values', async () => {
    const result = await compileTargets(['/i2']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    const all = Object.entries(s.values).map(([k, v]) => `${k} ${v}`).join(' ');
    expect(all).not.toContain('999 psi');
    expect(all).not.toContain('Secret');
    expect(s.values[detailFieldKey([], 'Voltage')]).toBe('24 V');
    expect(s.values[detailFieldKey(['Technical data'], 'Weight')]).toBe('0.5 kg');
    expect(Object.keys(s.values).some((k) => k.includes('"Pressure"'))).toBe(false);
  });

  it('scopes a main-less page to the smallest substantial product ancestor', async () => {
    const result = await compileTargets(['/nomain']);
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey([], 'Voltage')]).toBe('24 V');
    expect(s.values[detailFieldKey([], 'Speed')]).toBe('120 rpm');
    const all = Object.entries(s.values).map(([k, v]) => `${k} ${v}`).join(' ');
    expect(all).not.toContain('Compatible with');
    expect(all).not.toContain('FIX-Z999');
  });

  it('refuses multi-origin batches and reports invalid or conflicting inputs without opening a page', async () => {
    const judge = scriptedDetailJudge();
    const multi = await compileDetailRecipe(context, judge, [
      { url: 'https://detail.test/a', expected_code: 'FIX-A101' },
      { url: 'https://other.test/x', expected_code: 'FIX-B202' },
      { url: 'javascript:alert(1)' },
      { url: 'https://detail.test/p', expected_code: 'A-1' },
      { url: 'https://detail.test/p', expected_code: 'A-2' },
    ], { recipeVersion: 1, pauseMs: 0 });
    expect(multi.samples).toEqual([]);
    expect(multi.recipe.sample_urls).toEqual([]);
    expect(multi.issues.some((i) => i.reason === 'multi_origin')).toBe(true);
    expect(multi.issues.some((i) => i.reason === 'invalid_target')).toBe(true);
    expect(multi.issues.some((i) => i.reason === 'shared_url')).toBe(true);
    expect(judge.trace).toHaveLength(0);
    expect(context.pages()).toEqual([listingPage]);
  });

  it('rejects a non-http target before navigating', async () => {
    const page = await context.newPage();
    try {
      const r = await readDetail(page, recipe, { url: 'javascript:alert(1)', expected_code: 'X' });
      expect(r.status).toBe('error');
      expect(r.issues[0]?.reason).toBe('invalid_url');
      expect(page.url()).toBe('about:blank');
    } finally {
      await page.close();
    }
  });

  it('clears stale control tags before every observation so old ids never collide', async () => {
    const page = await context.newPage();
    try {
      await page.goto('https://detail.test/a');
      await observeDetail(page);
      // A hidden element and an unrelated one still carry tags from an earlier read (or a DOM
      // that was remounted since). The next observation must leave exactly the fresh ids.
      await page.evaluate(() => {
        document.querySelector('#panel-docs')?.setAttribute('data-jc-detail-control', 'd97');
        document.querySelector('.accessories')?.setAttribute('data-jc-detail-control', 'd98');
      });
      const obs2 = await observeDetail(page);
      const tagged = await page.evaluate(() =>
        [...document.querySelectorAll('[data-jc-detail-control]')].map((e) => e.getAttribute('data-jc-detail-control')),
      );
      expect(tagged.sort()).toEqual(obs2.controls.map((c) => c.id).sort());
      expect(new Set(tagged).size).toBe(tagged.length);
    } finally {
      await page.close();
    }
  });

  it('accepts a Deublin-style complete heading code as primary identity', async () => {
    const judge = scriptedDetailJudge({ primaryPattern: /^1005-000-001$/ });
    const result = await compileDetailRecipe(context, judge, detailTargets('https://detail.test', ['/deu']), {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 120,
    });
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.status).toBe('ok');
    expect(s.values[detailFieldKey(['Dimensions'], 'D')]).toBe('28.372 mm');
    expect(s.values[detailFieldKey(['Dimensions'], 'd')]).toBe('12 mm');
    const page = await context.newPage();
    try {
      const r = await readDetail(page, result.recipe, { url: 'https://detail.test/deu', expected_code: '1005-000-001' }, { revealTimeoutMs: 60 });
      expect(r.identity).toBe('matched');
      expect(r.status).toBe('ok');
      expect(r.values[detailFieldKey(['Dimensions'], 'A')]).toBe('1/8"-27 NPT RH');
    } finally {
      await page.close();
    }
  });

  it('answers a consent overlay through the gate seam before judging the product', async () => {
    const judge = scriptedDetailJudge();
    const result = await compileDetailRecipe(context, judge, [{ url: 'https://detail.test/consent', expected_code: 'FIX-C424' }], {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    const s = result.samples[0]!;
    expect(s.identity).toBe('matched');
    expect(s.values[detailFieldKey([], 'Voltage')]).toBe('24 V');
    const gate = judge.trace.filter((t) => t.step === 'gate');
    expect(gate.length).toBeGreaterThanOrEqual(1);
    const answers = gate[0]!.answers as Record<string, any>;
    expect(answers.gate_present?.noul).toBeGreaterThanOrEqual(0.6);
    expect(Object.values(answers).some((a: any) => a.probabilities?.reject_optional >= 0.6)).toBe(true);
  });

  it('keeps the product title header and site menu out of section paths on Deublin-shaped pages', async () => {
    const judge = scriptedDetailJudge({ primaryPattern: /^1005-\d{3}-\d{3}$/ });
    const result = await compileDetailRecipe(context, judge, detailTargets('https://detail.test', ['/dub1', '/dub2']), {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    expect(result.samples.map((s) => s.identity)).toEqual(['matched', 'matched']);
    const leaked = (s?: string[]) => (s ?? []).some((x) => /union|produkte|branchen/i.test(x));
    expect(leaked(result.recipe.identity?.section)).toBe(false);
    for (const sec of [...result.recipe.sections, ...(result.recipe.ignored_sections ?? [])]) {
      expect(leaked(sec.section)).toBe(false);
    }
    const s2 = result.samples[1]!;
    expect(s2.values[detailFieldKey(['Dimensions'], 'B')]).toBe('73 mm');
    expect(s2.downloads.every((d) => d.section.includes('Downloads'))).toBe(true);
    const page = await context.newPage();
    try {
      const r = await readDetail(page, result.recipe, { url: 'https://detail.test/dub2', expected_code: '1005-011-037' }, { revealTimeoutMs: 60 });
      expect(r.identity).toBe('matched');
      expect(r.status).toBe('ok');
      expect(r.values[detailFieldKey(['Dimensions'], 'A')]).toBe('1/8"-27 NPT RH');
      expect(r.downloads.every((d) => d.section.includes('Downloads'))).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('tombstones a shape with contradictory roles across samples and prunes its fields', async () => {
    const judge = scriptedDetailJudge({ blockRoleByUrl: { '/rc2': 'accessories' } });
    const result = await compileDetailRecipe(context, judge, detailTargets('https://detail.test', ['/rc1', '/rc2', '/rc3']), {
      recipeVersion: 1, pauseMs: 0,
      revealTimeoutMs: 60,
    });
    expect(result.issues.some((i) => i.reason === 'role_conflict')).toBe(true);
    // The conflicting shape is trusted by no one: not declared, not ignored, not a field.
    expect(result.recipe.sections.some((s) => s.row_labels?.includes('Speed'))).toBe(false);
    expect((result.recipe.ignored_sections ?? []).some((s) => s.row_labels?.includes('Speed'))).toBe(false);
    expect(result.recipe.fields.some((f) => f.label === 'Speed' || f.label === 'Torque')).toBe(false);
    // The samples themselves still collected what they were told to trust at the time.
    expect(result.samples[0]!.values[detailFieldKey(['Technical data'], 'Speed')]).toBe('120 rpm');
  });

  it('observeDetail never reads hidden panel content before it is revealed', async () => {
    const page = await context.newPage();
    try {
      await page.goto('https://detail.test/a');
      const obs = await observeDetail(page);
      expect(obs.candidates.some((c) => c.value === 'FIX-A101')).toBe(true);
      expect(obs.blocks.every((b) => !b.section.includes('Dimensions'))).toBe(true);
      expect(obs.controls.map((c) => c.label)).toEqual(['Dimensions', 'Specifications', 'Downloads', 'Related products']);
    } finally {
      await page.close();
    }
  });
});

// ---------- CLI regression: validation before any browser or key ----------

describe('details CLI input handling', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jc-details-'));
  const run = (file: string) =>
    execFileSync('npx', ['tsx', 'src/cli.ts', 'details', file, join(dir, 'out')], {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, TYPESAFE_API_KEY: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  const attempt = (file: string) => {
    try {
      return { code: 0, stdout: run(file) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
    }
  };

  it('exits 2 on malformed JSON and wrong shapes without launching anything', () => {
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(attempt(bad).code).toBe(2);
    const rowsNull = join(dir, 'rows-null.json');
    writeFileSync(rowsNull, JSON.stringify({ recipe: { version: 1, source_url: 'https://s.test/l', fields: [] }, rows: null }));
    expect(attempt(rowsNull).code).toBe(2);
    const fieldsObject = join(dir, 'fields-object.json');
    writeFileSync(fieldsObject, JSON.stringify({ recipe: { version: 1, source_url: 'https://s.test/l', fields: { Code: {} } }, rows: [] }));
    expect(attempt(fieldsObject).code).toBe(2);
  });

  it('exits 1 with persisted input diagnostics when every row lacks a usable URL', () => {
    const file = join(dir, 'empty.json');
    writeFileSync(file, JSON.stringify({
      recipe: { version: 1, source_url: 'https://s.test/l', fields: [{ name: 'Code', role: 'order_code' }] },
      rows: [{ Code: 'A-1' }, { Code: 'A-2' }],
    }));
    const r = attempt(file);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('no usable detail targets');
    const inputs = JSON.parse(
      execFileSync('cat', [join(dir, 'out', 'inputs.json')], { encoding: 'utf8' }),
    );
    expect(inputs.issues.map((i: { reason: string }) => i.reason)).toEqual(['missing_url', 'missing_url']);
  });
});
