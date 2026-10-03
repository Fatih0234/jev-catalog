import { chromium, type Browser, type BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compileDetailRecipe, observeDetail, readDetail } from '../src/detail.js';
import { detailFieldKey } from '../src/detail-policy.js';
import { learnDetailSchema, type SchemaSampleInput } from '../src/detail-schema.js';
import type { Judge } from '../src/jev.js';
import { detailRouteHandler, detailTargets, scriptedDetailJudge } from './helpers/detail-site.js';

describe('detail observation evidence', () => {
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await context.route('**', detailRouteHandler([]));
  });
  afterAll(async () => browser.close());

  const observe = async (path: string) => {
    const page = await context.newPage();
    try {
      await page.goto(`https://detail.test${path}`);
      return await observeDetail(page);
    } finally {
      await page.close();
    }
  };

  it('annotates row kinds: thead is table_header, mixed and plain rows stay table_row', async () => {
    const obs = await observe('/s1');
    const table = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'));
    expect(table).toBeTruthy();
    expect(table!.rows.map((r) => `${r.label}=${r.value}:${r.evidence?.kind}`)).toEqual([
      'Attribute=Value:table_header',
      'Voltage=24 V:table_row',
      'Pressure=10 bar:table_row',
    ]);
    expect(table!.rows[0]!.evidence).toMatchObject({ label_tag: 'th', value_tag: 'th' });
    expect(table!.rows[1]!.evidence).toMatchObject({ kind: 'table_row', label_tag: 'th', value_tag: 'td' });
    const plain = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Weight'))!;
    expect(plain.rows[0]!.label).toBe('Attribute');
    expect(plain.rows[0]!.evidence).toMatchObject({ kind: 'table_row', label_tag: 'td', value_tag: 'td' });
    expect(table!.rows.map((r) => r.label)).not.toContain('Stale');
    expect(JSON.stringify(table!.rows)).not.toContain('999');
    const ids = new Set(obs.blocks.flatMap((b) => b.rows.map((r) => r.evidence!.id)));
    expect(ids.size).toBe(obs.blocks.reduce((n, b) => n + b.rows.length, 0));
  });

  it('records heading provenance for the same ancestry the legacy section uses', async () => {
    const obs = await observe('/s1');
    const table = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'))!;
    expect(table.section).toEqual(['Technical data', 'Electrical data']);
    const heads = table.evidence!.headings;
    const sum = heads.find((h) => h.text === 'Electrical data');
    const tech = heads.find((h) => h.text === 'Technical data');
    expect(sum).toMatchObject({ tag: 'summary', via: 'summary', relation: 'ancestor', depth: 1 });
    expect(tech).toMatchObject({ tag: 'h3', via: 'heading', relation: 'ancestor' });
    expect(tech!.depth).toBeGreaterThan(sum!.depth);
    expect(heads.some((h) => h.text === 'Related products')).toBe(false);
    expect(heads.some((h) => h.tag === 'h1')).toBe(false);
    expect(heads.some((h) => h.text.includes('Compact series'))).toBe(false);
    const related = obs.blocks.find((b) => b.rows.some((r) => r.label === 'REL-9'))!;
    expect(related.section).toEqual(['Related products']);
    expect(table.evidence!.headings.every((h) => /^h\d+$/.test(h.id))).toBe(true);
    expect(new Set(heads.map((h) => h.id)).size).toBe(heads.length);
  });

  it('keeps the changing description heading on the ancestry path with provenance', async () => {
    const obs = await observe('/sp1');
    const table = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'))!;
    expect(table.section).toEqual(['Compact series, brushed housing', 'Technical data', 'Electrical data']);
    const desc = table.evidence!.headings.find((h) => h.text === 'Compact series, brushed housing');
    expect(desc).toMatchObject({ via: 'accordion_header', relation: 'ancestor', tag: 'div' });
    const obs4 = await observe('/sp4');
    const table4 = obs4.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'))!;
    expect(table4.section[0]).toBe('Long-range series, different description');
  });

  it('keeps later headings available when a page holds more than twelve headed blocks', async () => {
    const obs = await observe('/sh');
    expect(obs.blocks.length).toBeGreaterThanOrEqual(14);
    const last = obs.blocks[obs.blocks.length - 1]!;
    const late = last.evidence!.headings.find((h) => h.text === 'Section 14');
    expect(late).toBeTruthy();
    expect(late!.id).toMatch(/^h\d+$/);
  });

  it('clips evidence only in evidence diagnostics, never legacy truncation or V1 status', async () => {
    const obs = await observe('/deep');
    const table = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Depth'))!;
    const path = table.evidence!.path;
    expect(path).toHaveLength(6);
    expect(path[0]!.tag).toBe('main');
    expect(path[path.length - 1]!.tag).toBe('table');
    expect(table.evidence!.truncated).toContain('context');
    expect(obs.evidence_truncated).toContain('context');
    expect(obs.truncated).not.toContain('context');
    expect(obs.truncated).not.toContain('headings');
    const result = await compileDetailRecipe(
      context,
      scriptedDetailJudge({ primaryPattern: /^DEP-/, blockRoleByUrl: { '/deep': 'specifications' } }),
      detailTargets('https://detail.test', ['/deep']),
      { pauseMs: 0, revealTimeoutMs: 60, recipeVersion: 1 },
    );
    const s = result.samples[0]!;
    expect(s.status).toBe('ok');
    expect(s.values[detailFieldKey([], 'Depth')]).toBe('5 mm');
  });

  it('associates blocks with their containing panel and fresh control ids after remount', async () => {
    const page = await context.newPage();
    try {
      await page.goto('https://detail.test/s1');
      const first = await observeDetail(page);
      const table = first.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'))!;
      const summary = first.controls.find((c) => c.label === 'Electrical data')!;
      expect(table.evidence!.panel).toMatchObject({ label: 'Electrical data', control_id: summary.id });
      expect(table.evidence!.panel!.id).toMatch(/^p\d+$/);
      const sharedHeading = table.evidence!.headings.find((h) => h.text === 'Electrical data');
      const controlHeading = summary.evidence!.headings.find((h) => h.text === 'Electrical data');
      expect(sharedHeading && controlHeading && sharedHeading.id === controlHeading.id).toBe(true);
      await page.evaluate(() => {
        const d = document.querySelector('details')!;
        const parent = d.parentElement!;
        d.remove();
        parent.appendChild(d);
      });
      const second = await observeDetail(page);
      const table2 = second.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'))!;
      const summary2 = second.controls.find((c) => c.label === 'Electrical data')!;
      expect(table2.evidence!.panel!.control_id).toBe(summary2.id);
      expect(new Set(second.controls.map((c) => c.id)).size).toBe(second.controls.length);
      expect(second.controls.every((c) => /^d\d+$/.test(c.id))).toBe(true);
    } finally {
      await page.close();
    }
  });

  it('wires panels that are the block itself and blocks inside open shadow roots', async () => {
    const obs = await observe('/pan');
    const linkBlock = obs.blocks.find((b) => b.links.some((l) => l.label === 'Datasheet'))!;
    const linkCtl = obs.controls.find((c) => c.label === 'Product links')!;
    expect(linkBlock.evidence!.panel).toMatchObject({ control_id: linkCtl.id });
    const shadowBlock = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Shadow weight'))!;
    const shadowCtl = obs.controls.find((c) => c.label === 'Shadow specs')!;
    expect(shadowBlock.evidence!.panel).toMatchObject({ control_id: shadowCtl.id });
  });

  it('uses the panel title or control label, never a nested sibling heading', async () => {
    const obs = await observe('/pan');
    const table = obs.blocks.find((b) => b.rows.some((r) => r.label === 'Depth'))!;
    const ctl = obs.controls.find((c) => c.label === 'Specs panel')!;
    expect(table.evidence!.panel).toBeTruthy();
    expect(table.evidence!.panel!.label).toBe('Specs panel');
    expect(table.evidence!.panel!.control_id).toBe(ctl.id);
    expect(table.evidence!.headings.some((h) => h.text === 'Unrelated' && h.via === 'panel_label')).toBe(false);
  });

  it('records control evidence and offers identity on the fourth product with a new description', async () => {
    const obs = await observe('/s4');
    const summary = obs.controls.find((c) => c.label === 'Electrical data')!;
    expect(summary.evidence!.path[summary.evidence!.path.length - 1]!.tag).toBe('summary');
    expect(summary.evidence!.headings.map((h) => h.text)).toEqual(expect.arrayContaining(['Electrical data', 'Technical data']));
    expect(obs.candidates.some((c) => c.value === 'SCH-4004')).toBe(true);
    expect(obs.blocks.find((b) => b.rows.some((r) => r.label === 'Voltage'))!.section).toEqual(['Technical data', 'Electrical data']);
  });
});

describe('detail recipe v2', () => {
  let browser: Browser;
  let context: BrowserContext;
  const v2Judge = (opts: Parameters<typeof scriptedDetailJudge>[0] = {}) =>
    scriptedDetailJudge({
      primaryPattern: /^(SPH|DUP|OPT|OFR|DIM|AL|TSK|AUX|DOC|SCH|AX|OV|SA|XT|SW|XC|AM|OK|CR|SKD|ID|PT|MP|M|FM|FIX|LY|TB|OVE|LAY|UA)-/,
      descriptivePattern: /housing|description|series/i,
      headingRoles: { 'Current offers': 'other' },
      ...opts,
    });
  const v2 = (recipe: Parameters<typeof readDetail>[1]): Extract<Parameters<typeof readDetail>[1], { version: 2 }> => {
    if (recipe.version !== 2) throw new Error(`expected v2 recipe, got v${recipe.version}`);
    return recipe;
  };
  const compile2 = (paths: string[], judgeOpts: Parameters<typeof scriptedDetailJudge>[0] = {}) =>
    compileDetailRecipe(context, v2Judge(judgeOpts), detailTargets('https://detail.test', paths), { pauseMs: 0, revealTimeoutMs: 300 });
  const replay = async (recipe: Parameters<typeof readDetail>[1], path: string) => {
    const page = await context.newPage();
    try {
      return await readDetail(page, recipe, detailTargets('https://detail.test', [path])[0]!, { revealTimeoutMs: 300 });
    } finally {
      await page.close();
    }
  };

  let fileFetches = 0;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    await context.route('https://detail.test/**', detailRouteHandler());
    await context.route('https://files.test/**', (r) => { fileFetches++; return r.fulfill({ status: 404, body: 'x' }); });
  });
  afterAll(async () => { await context.close(); await browser.close(); });

  it('learns across three teaching products and replays a changed description', async () => {
    const r = await compile2(['/sp1', '/sp2', '/sp3']);
    expect(r.recipe.version).toBe(2);
    const recipe = v2(r.recipe);
    expect(recipe.learning.verified).toHaveLength(3);
    const key = (l: string) => detailFieldKey(['Technical data', 'Electrical data'], l);
    expect(recipe.fields.some((f) => f.key === key('Voltage'))).toBe(true);
    const out = await replay(r.recipe, '/sp4');
    expect(out.identity).toBe('matched');
    expect(out.values[key('Voltage')]).toBe('48 V');
    expect(out.values[key('Pressure')]).toBe('12 bar');
    expect(out.recipe_version).toBe(2);
    const src = out.field_sources?.[key('Voltage')] ?? [];
    expect(src.length).toBeGreaterThan(0);
    expect(src[0]!.sample_url).toBe('https://detail.test/sp4');
    expect(src[0]!.section).toEqual(['Technical data', 'Electrical data']);
    expect(src[0]!.raw_section).toContain('Long-range series, different description');
  }, 30000);

  it('rejects a plain Attribute/Value row while keeping real TH/TD attributes', async () => {
    const r = await compile2(['/s1', '/s2', '/s3'], { fieldRoles: { Attribute: 'table_heading', Value: 'table_heading' } });
    const recipe = v2(r.recipe);
    const key = (l: string) => detailFieldKey(['Technical data', 'Electrical data'], l);
    expect(recipe.fields.some((f) => f.key === key('Voltage'))).toBe(true);
    expect(recipe.fields.some((f) => f.label === 'Attribute' || f.label === 'Value')).toBe(false);
    const out = await replay(r.recipe, '/s4');
    expect(out.values[key('Voltage')]).toBe('24 V');
    expect(Object.keys(out.values).join(' ')).not.toContain('Attribute');
  }, 30000);

  it('merges an agreed overview copy and detail source into one field with two sources', async () => {
    const r = await compile2(['/v1', '/v2', '/v3']);
    const recipe = v2(r.recipe);
    const material = recipe.fields.find((f) => f.label === 'Material')!;
    expect(material.sources.length).toBeGreaterThanOrEqual(2);
    expect(material.sources.map((s) => s.block_kind).sort()).toEqual(['dl', 'table']);
    const out = await replay(r.recipe, '/vx');
    const key = material.key;
    expect(out.field_sources?.[key]?.length).toBeGreaterThanOrEqual(2);
    expect(out.values[key]).toBeUndefined();
    expect(out.issues.some((i) => i.reason === 'value_conflict' || i.reason === 'source_conflict')).toBe(true);
  }, 30000);

  it('records inspected-absent coverage for an optional field and unknown after a failed reveal', async () => {
    const r = await compile2(['/o1', '/o2', '/o3']);
    const recipe = v2(r.recipe);
    const opt = recipe.fields.find((f) => f.label === 'Optional torque')!;
    expect(opt.coverage.present).toEqual(['https://detail.test/o1']);
    expect(opt.coverage.absent).toEqual(['https://detail.test/o2', 'https://detail.test/o3']);
    const r2 = await compile2(['/of1', '/of2', '/of3'], { blockRoleWhen: [{ match: /torque|mechanical/i, role: 'specifications' }] });
    const recipe2 = v2(r2.recipe);
    const torque = recipe2.fields.find((f) => f.label === 'Torque')!;
    expect(torque.coverage.unknown).toEqual(['https://detail.test/of2']);
    expect(recipe2.learning.state).toBe('partial');
  }, 60000);

  it('never merges D/d or coexisting scopes even when relations answer yes', async () => {
    const r = await compile2(['/dd1', '/dd2', '/dd3'], { relationNoul: 0.95 });
    const recipe = v2(r.recipe);
    const keys = recipe.fields.map((f) => f.key);
    expect(keys).toContain(detailFieldKey(['Outer dimensions'], 'D'));
    expect(keys).toContain(detailFieldKey(['Bore data'], 'd'));
    expect(keys).toContain(detailFieldKey(['Outer dimensions'], 'Voltage'));
    expect(keys).toContain(detailFieldKey(['Bore data'], 'Voltage'));
    const out = await replay(r.recipe, '/dd2');
    expect(out.values[detailFieldKey(['Outer dimensions'], 'D')]).toBe('40 mm');
    expect(out.values[detailFieldKey(['Bore data'], 'd')]).toBe('12 mm');
    expect(out.values[detailFieldKey(['Outer dimensions'], 'Voltage')]).toBe('230 V');
    expect(out.values[detailFieldKey(['Bore data'], 'Voltage')]).toBe('24 V');
  }, 30000);

  it('applies a learned label alias and reports an unseen alias as unmapped', async () => {
    const r = await compile2(['/al1', '/al2', '/al3']);
    const recipe = v2(r.recipe);
    const f = recipe.fields.find((x) => x.aliases.length > 0)!;
    expect([f.label, ...f.aliases].sort()).toEqual(['Mass', 'Weight']);
    const out = await replay(r.recipe, '/al4');
    expect(out.unmapped_fields?.some((u) => u.label === 'Gewicht')).toBe(true);
    expect(Object.keys(out.values).some((k) => k.includes('Weight') || k.includes('Mass'))).toBe(false);
    expect(out.status).toBe('partial');
  }, 30000);

  it('accepts model plus SKU but rejects two authoritative codes', async () => {
    const r = await compile2(['/sku1']);
    expect(r.samples[0]!.identity).toBe('matched');
    const r2 = await compile2(['/sku2']);
    expect(r2.samples[0]!.identity).toBe('mismatch');
    expect(r2.samples[0]!.status).toBe('identity_mismatch');
  }, 30000);

  it('warns on a changed auxiliary control but reports a missing relevant control', async () => {
    const r = await compile2(['/aux1', '/aux2', '/aux3']);
    const recipe = v2(r.recipe);
    const out = await replay(r.recipe, '/aux4');
    expect(out.status).toBe('ok');
    expect(out.warnings?.some((w) => w.reason === 'auxiliary_change')).toBe(true);
    const out2 = await replay(r.recipe, '/auxm');
    expect(out2.status).toBe('partial');
    expect(out2.issues.some((i) => i.reason === 'reveal_missing' || i.reason === 'template_drift')).toBe(true);
  }, 45000);

  it('clears values and sources when a reveal swaps the product', async () => {
    const r = await compileDetailRecipe(context, scriptedDetailJudge(), detailTargets('https://detail.test', ['/e']), { pauseMs: 0, revealTimeoutMs: 300 });
    const s = r.samples[0]!;
    expect(s.status).toBe('navigation_changed');
    expect(s.values).toEqual({});
    expect(s.field_sources).toBeUndefined();
    expect(s.downloads).toEqual([]);
  }, 30000);

  it('keeps version 1 recipes working and rejects unsupported versions before navigation', async () => {
    const r = await compileDetailRecipe(context, scriptedDetailJudge(), detailTargets('https://detail.test', ['/a', '/b', '/c']), { recipeVersion: 1, pauseMs: 0, revealTimeoutMs: 60 });
    expect(r.recipe.version).toBe(1);
    const page = await context.newPage();
    try {
      const out = await readDetail(page, r.recipe, { url: 'https://detail.test/a', expected_code: 'FIX-A101' }, { revealTimeoutMs: 60 });
      expect(out.identity).toBe('matched');
      expect(out.status).toBe('ok');
      const bad = await readDetail(page, { version: 3 } as never, { url: 'https://detail.test/a', expected_code: 'FIX-A101' });
      expect(bad.status).toBe('error');
      expect(bad.issues[0]!.reason).toBe('unsupported_recipe_version');
    } finally {
      await page.close();
    }
    const def = await compileDetailRecipe(context, v2Judge(), detailTargets('https://detail.test', ['/sp1', '/sp2', '/sp3']), { pauseMs: 0, revealTimeoutMs: 300 });
    expect(def.recipe.version).toBe(2);
  }, 60000);

  it('collects scoped document links under a tab panel and replays direct URLs', async () => {
    const r = await compile2(['/dl1', '/dl2', '/dl3'], {
      blockRoleWhen: [{ match: /DE EN|Log in/i, role: 'downloads' }],
      headingRoles: { 'Technical features': 'specification_section', Downloads: 'document_section', 'Current offers': 'other' },
    });
    const recipe = v2(r.recipe);
    expect(recipe.regions.some((x) => x.role === 'downloads')).toBe(true);
    const out = await replay(r.recipe, '/dl4');
    expect(out.identity).toBe('matched');
    const urls = out.downloads.map((d) => d.url);
    expect(urls).toContain('https://files.test/ds-DOC-4004-de.pdf');
    expect(urls).toContain('https://files.test/ds-DOC-4004-en.pdf');
    expect(urls.every((u) => !u.includes('login'))).toBe(true);
    expect(urls.every((u) => !u.includes('/products') && !u.includes('/acc') && !u.includes('/fib'))).toBe(true);
    expect(fileFetches).toBe(0);
  }, 45000);

  it('labels an icon link from its accessible label and local document title', async () => {
    const page = await context.newPage();
    try {
      await page.goto('https://detail.test/icon');
      const obs = await observeDetail(page, 2);
      const link = obs.blocks.flatMap((b) => b.links).find((l) => l.url.includes('icon-DOC-5005.pdf'));
      expect(link?.label).toBe('Download datasheet');
      expect(link?.document_title).toBe('Datasheet PDF');
    } finally {
      await page.close();
    }
  });

  it('never trusts a deep accessory region hidden inside a clipped path', async () => {
    const page = await context.newPage();
    try {
      await page.goto('https://detail.test/ax1');
      const obs = await observeDetail(page, 2);
      const acc = obs.blocks.find((b) => b.rows.some((r) => r.value === '48 V'))!;
      expect(acc.evidence?.excluded).toBe(true);
      expect(acc.evidence?.path.length).toBeLessThanOrEqual(6);
      expect(acc.evidence?.path.some((n) => n.classes.some((c) => c.includes('accessor')))).toBe(false);
    } finally {
      await page.close();
    }
    const r = await compile2(['/ax1', '/ax2', '/ax3']);
    const recipe = v2(r.recipe);
    expect(recipe.fields.map((f) => f.label)).toEqual(['Voltage']);
    expect(recipe.fields[0]!.sources).toHaveLength(1);
    const out = await replay(r.recipe, '/ax4');
    expect(out.status).toBe('ok');
    const collected = [...Object.values(out.values), ...Object.values(out.field_sources ?? {}).flatMap((s) => s.map((x) => x.value)), ...(out.unmapped_fields ?? []).map((x) => x.value)];
    expect(collected).toContain('24 V');
    expect(collected).not.toContain('48 V');
    expect(collected).not.toContain('AK-9');
  }, 45000);

  it('reports an unmounted document region as uninspected after the reveal budget', async () => {
    const r = await compile2(['/dl1', '/dl2', '/late'], {
      blockRoleWhen: [{ match: /DE EN|Log in/i, role: 'downloads' }],
      headingRoles: { 'Technical features': 'specification_section', Downloads: 'document_section', 'Current offers': 'other' },
    });
    const recipe = v2(r.recipe);
    expect(recipe.learning.state).toBe('partial');
    expect(recipe.diagnostics.some((i) => i.reason === 'region_uninspected')).toBe(true);
  }, 45000);

  it('freezes ranked identity mechanisms and rechecks them through reveals', async () => {
    const r = await compile2(['/id1', '/id2', '/id3'], { primaryPattern: /^(ID|M)-\d/ });
    const recipe = v2(r.recipe);
    expect(recipe.learning.verified).toHaveLength(3);
    expect(recipe.identity?.mechanisms.some((m) => m.source === 'metadata' && /sku|productID/i.test(m.via))).toBe(true);
    expect(recipe.identity?.mechanisms.some((m) => /model/i.test(m.via))).toBe(false);
    const out = await replay(r.recipe, '/id4');
    expect(out.identity).toBe('matched');
    expect(out.reveals.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(out.values)).toContain('24 V');
    expect(out.downloads.map((d) => d.url)).toContain('https://files.test/ID-4004.pdf');
    const bad = await compile2(['/id5'], { primaryPattern: /^(ID|PT|MP|M)-\d/ });
    expect(bad.samples[0]!.identity).toBe('mismatch');
    expect(bad.samples[0]!.status).toBe('identity_mismatch');
  }, 60000);

  it('accepts normalized same-code mechanisms from several sources', async () => {
    const r = await compile2(['/skd'], { primaryPattern: /^SKD-\d/ });
    const recipe = v2(r.recipe);
    expect(r.samples[0]!.identity).toBe('matched');
    expect(recipe.identity?.mechanisms.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it('shows one example per teaching product with distinct source ids', async () => {
    const fields: { instructions?: { candidate?: { label: string; examples?: { sample_url: string; source?: { id: string } }[] } } }[] = [];
    const dups: { instructions?: { left?: { examples?: { sample_url: string; source?: { id: string } }[] }; right?: { examples?: { sample_url: string; source?: { id: string } }[] } } }[] = [];
    const spy = v2Judge();
    const ask = spy.ask.bind(spy);
    spy.ask = async (step, state, questions) => {
      const qs2 = questions as Record<string, unknown>;
      if (step === 'detail-field') fields.push(...(Object.values(qs2) as typeof fields));
      if (step === 'detail-duplicate-relation') dups.push(...(Object.values(qs2) as typeof dups));
      return ask(step, state, questions as never);
    };
    const r = await compileDetailRecipe(context, spy, detailTargets('https://detail.test', ['/v1', '/v2', '/v3']), { pauseMs: 0, revealTimeoutMs: 300 });
    const recipe = v2(r.recipe);
    expect(recipe.learning.verified).toHaveLength(3);
    expect(fields.length).toBeGreaterThan(0);
    const all = ['https://detail.test/v1', 'https://detail.test/v2', 'https://detail.test/v3'];
    for (const q of fields) {
      const cand = q.instructions?.candidate;
      if (!['Material', 'Voltage'].includes(cand?.label ?? '')) continue;
      expect(cand!.examples!.map((e) => e.sample_url).sort()).toEqual([...all].sort());
      expect(cand!.examples!.every((e) => typeof e.source?.id === 'string' && e.source.id.length > 0)).toBe(true);
    }
    expect(dups.length).toBeGreaterThan(0);
    const [pair] = dups;
    if (pair) {
      const left = pair.instructions?.left;
      const right = pair.instructions?.right;
      expect(left?.examples?.[0]?.source?.id).not.toBe(right?.examples?.[0]?.source?.id);
      expect(left?.examples?.map((e) => e.sample_url).sort()).toEqual([...all].sort());
      expect(right?.examples?.map((e) => e.sample_url).sort()).toEqual([...all].sort());
    }
  }, 45000);

  it('merges an unheaded overview source with the detailed scope source', async () => {
    const r = await compile2(['/ov1', '/ov2', '/ov3'], {
      relationNoul: (kind: string, ins: any) =>
        String(ins.left?.label ?? '') === String(ins.right?.label ?? '') ? 0.95 : 0,
    });
    const recipe = v2(r.recipe);
    const material = recipe.fields.find((f) => f.label === 'Material')!;
    expect(material.section).toEqual(['Technical data']);
    expect(material.sources.length).toBeGreaterThanOrEqual(2);
    expect(material.sources.some((s) => s.region.length === 0)).toBe(true);
    const optional = recipe.fields.find((f) => f.label === 'Min. stroke')!;
    expect(optional.section).toEqual([]);
    const out = await replay(r.recipe, '/ov4');
    expect(out.status).toBe('ok');
    const key = detailFieldKey(['Technical data'], 'Material');
    expect(out.values[key]).toBe('NBR');
    const sources = out.field_sources?.[key] ?? [];
    expect(sources.map((s) => s.section.join('>')).sort()).toEqual(['', 'Technical data'].sort());
    const conflict = await replay(r.recipe, '/ovx');
    expect(conflict.status).toBe('partial');
    expect(conflict.values[key]).toBeUndefined();
    expect(conflict.issues.some((i) => i.reason === 'value_conflict')).toBe(true);
  }, 60000);

  it('merges section aliases and records the actual observed section', async () => {
    const r = await compile2(['/sa1', '/sa2', '/sa3']);
    const recipe = v2(r.recipe);
    const region = recipe.regions.find((x) => x.section.includes('Specifications'));
    expect(region?.aliases.some((a) => a.includes('Technical data'))).toBe(true);
    expect(recipe.regions.filter((x) => x.section.includes('Technical data'))).toHaveLength(0);
    const out = await replay(r.recipe, '/sa4');
    expect(out.status).toBe('ok');
    const key = detailFieldKey(['Specifications'], 'Voltage');
    expect(out.values[key]).toBe('24 V');
    expect((out.field_sources?.[key] ?? [])[0]?.section).toEqual(['Technical data']);
    expect(out.issues.filter((i) => i.reason === 'region_ambiguous')).toHaveLength(0);
  }, 60000);

  it('refuses an undeclared third table under the same scope for a two-source field', async () => {
    const r = await compile2(['/v1', '/v2', '/v3']);
    const recipe = v2(r.recipe);
    const material = recipe.fields.find((f) => f.label === 'Material')!;
    expect(material.sources.length).toBe(2);
    const out = await replay(r.recipe, '/xt');
    expect(out.status).toBe('partial');
    expect(out.issues.some((i) => i.reason === 'source_ambiguous')).toBe(true);
    const key = detailFieldKey(['Technical data'], 'Material');
    expect(out.values[key]).toBeUndefined();
    expect((out.field_sources?.[key] ?? []).map((s) => s.value)).toContain('FKM');
    expect(Object.values(out.values)).not.toContain('Value');
  }, 45000);

  it('keeps source layout variants distinct and declared without duplicate asks', async () => {
    const r = await compile2(['/ly1', '/ly2', '/ly3']);
    const recipe = v2(r.recipe);
    const voltage = recipe.fields.find((f) => f.label === 'Voltage')!;
    expect(voltage.sources.length).toBe(3);
    expect(new Set(voltage.sources.map((s) => s.id)).size).toBe(3);
    const out = await replay(r.recipe, '/ly4');
    expect(out.status).toBe('ok');
    expect(out.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('24 V');
  }, 45000);

  it('keeps distinct tables as separate sources and captures the conflict', async () => {
    const r = await compile2(['/tb1', '/tb2', '/tb3']);
    const recipe = v2(r.recipe);
    const voltage = recipe.fields.find((f) => f.label === 'Voltage')!;
    expect(voltage.sources.length).toBe(2);
    expect(new Set(voltage.sources.map((s) => s.id)).size).toBe(2);
    const out = await replay(r.recipe, '/tb4');
    const key = detailFieldKey(['Technical data'], 'Voltage');
    const recs = out.field_sources?.[key] ?? [];
    expect(new Set(recs.map((s) => s.binding_id)).size).toBe(2);
    expect(recs.map((s) => s.value).sort()).toEqual(['230 V', '48 V']);
    expect(out.values[key]).toBeUndefined();
    expect(out.status).toBe('partial');
  }, 45000);

  it('distinguishes ancestor layout variation four levels above the table', async () => {
    const r = await compile2(['/lay1', '/lay2', '/lay3']);
    const recipe = v2(r.recipe);
    const voltage = recipe.fields.find((f) => f.label === 'Voltage')!;
    expect(voltage.sources.length).toBe(3);
    expect(new Set(voltage.sources.map((s) => s.id)).size).toBe(3);
    for (const path of ['/lay4', '/lay5', '/lay6']) {
      const out = await replay(r.recipe, path);
      expect(out.status).toBe('ok');
      expect(out.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('24 V');
    }
  }, 60000);

  it('keeps two unheaded areas as separate structural regions', async () => {
    const r = await compile2(['/ua1', '/ua2', '/ua3'], {
      relationNoul: (kind: string, ins: any) =>
        String(ins.left?.label ?? '') === String(ins.right?.label ?? '') ? 0.95 : 0,
    });
    const recipe = v2(r.recipe);
    const material = recipe.fields.find((f) => f.label === 'Material')!;
    const weight = recipe.fields.find((f) => f.label === 'Weight')!;
    expect(material.section).toEqual([]);
    expect(weight.section).toEqual([]);
    expect(material.sources[0]!.id).not.toBe(weight.sources[0]!.id);
    const emptyRegions = recipe.regions.filter((x) => x.section.length === 0);
    expect(emptyRegions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(emptyRegions.map((x) => x.id)).size).toBe(emptyRegions.length);
    expect(weight.coverage.unknown).toContain('https://detail.test/ua3');
    expect(weight.coverage.absent).not.toContain('https://detail.test/ua3');
    const out = await replay(r.recipe, '/ua4');
    expect(out.values[detailFieldKey([], 'Material')]).toBe('NBR');
    expect(out.values[detailFieldKey([], 'Weight')]).toBe('800 g');
    const out2 = await replay(r.recipe, '/ua5');
    expect(out2.issues.some((i) => i.reason === 'field_missing' && i.message === 'Weight')).toBe(false);
    expect(out2.values[detailFieldKey([], 'Material')]).toBe('NBR');
  }, 60000);

  it('keeps conflicting values from a recycled block id as a value conflict', async () => {
    const r = await compile2(['/sw1', '/sw2', '/sw3']);
    const recipe = v2(r.recipe);
    const out = await replay(r.recipe, '/sw4');
    const key = detailFieldKey(['Technical data'], 'Weight');
    expect(out.values[key]).toBeUndefined();
    const recs = out.field_sources?.[key] ?? [];
    expect(recs.map((s) => s.value).sort()).toEqual(['900 g', '910 g']);
    expect(new Set(recs.map((s) => s.binding_id)).size).toBe(1);
    expect(out.status).toBe('partial');
  }, 45000);

  it('counts failed teachers as unknown coverage, not absence', async () => {
    const r = await compileDetailRecipe(context, v2Judge(), [
      ...detailTargets('https://detail.test', ['/sp1', '/sp2']),
      { url: 'https://detail.test/spx', expected_code: 'SPH-1003' },
    ], { pauseMs: 0, revealTimeoutMs: 300 });
    const recipe = v2(r.recipe);
    expect(recipe.learning.attempted).toHaveLength(3);
    expect(recipe.learning.verified).toHaveLength(2);
    expect(recipe.learning.state).toBe('partial');
    const voltage = recipe.fields.find((f) => f.label === 'Voltage')!;
    expect(voltage.coverage.unknown).toEqual(['https://detail.test/spx']);
    expect(voltage.observed_all).toBe(false);
  }, 45000);

  it('never clicks an excluded replacement control and reports the missing one', async () => {
    const r = await compileDetailRecipe(context, v2Judge(), detailTargets('https://detail.test', ['/a', '/b', '/c']), { pauseMs: 0, revealTimeoutMs: 60 });
    const recipe = v2(r.recipe);
    const out = await replay(r.recipe, '/xc');
    expect(out.status).toBe('partial');
    expect(out.reveals.some((x) => x.label === 'Electrical data')).toBe(false);
    expect(out.issues.some((i) => ['reveal_missing', 'template_drift', 'unknown_control', 'region_missing'].includes(i.reason))).toBe(true);
  }, 45000);

  it('refuses ambiguous repeated control labels', async () => {
    const r = await compileDetailRecipe(context, v2Judge(), detailTargets('https://detail.test', ['/a', '/b', '/c']), { pauseMs: 0, revealTimeoutMs: 60 });
    const out = await replay(r.recipe, '/am');
    expect(out.status).toBe('partial');
    expect(out.issues.some((i) => ['reveal_ambiguous', 'unknown_control'].includes(i.reason))).toBe(true);
  }, 45000);

  it('accepts confirmed opaque links but rejects same-label navigation', async () => {
    const r = await compile2(['/ok1', '/ok2', '/ok3'], {
      headingRoles: { Downloads: 'document_section', 'Current offers': 'other' },
      downloadLabels: /Datasheet/,
    });
    const recipe = v2(r.recipe);
    const region = recipe.regions.find((x) => x.role === 'downloads');
    expect(region?.confirmed_links?.some((c) => c.pattern.includes('part='))).toBe(true);
    const out = await replay(r.recipe, '/ok4');
    expect(out.downloads.map((d) => d.url).sort()).toEqual([
      'https://detail.test/file?part=OK-4004',
      'https://detail.test/file?serial=OK-4004',
    ]);
    expect(out.downloads.map((d) => d.url)).not.toContain('https://detail.test/login');
    expect(out.warnings?.some((w) => w.reason === 'unresolved_link' && w.message === 'Datasheet')).toBe(true);
  }, 60000);

  it('drops credential-bearing URLs before any question or artifact sees them', async () => {
    const r = await compile2(['/cr'], { headingRoles: { Documents: 'document_section', 'Current offers': 'other' } });
    expect(JSON.stringify(r)).not.toContain('p%40ssw0rd');
    expect(JSON.stringify(r)).not.toContain('user:');
    const out = await replay(r.recipe, '/cr');
    expect(JSON.stringify(out)).not.toContain('p%40ssw0rd');
    expect((out.downloads ?? []).map((d) => d.url)).toEqual(['https://files.test/pub-CR-4004.pdf']);
  }, 45000);

  it('flags a removed required field after inspecting its region', async () => {
    const r = await compile2(['/v1', '/v2', '/v3']);
    const out = await replay(r.recipe, '/fm');
    expect(out.status).toBe('partial');
    expect(out.issues.some((i) => i.reason === 'field_missing' && i.message === 'Material')).toBe(true);
    expect(out.values[detailFieldKey(['Technical data'], 'Voltage')]).toBe('24 V');
  }, 45000);

  it('replays nested V2 reveals on a default recipe without template drift', async () => {
    const r = await compileDetailRecipe(context, v2Judge(), detailTargets('https://detail.test', ['/a', '/b', '/c']), { pauseMs: 0, revealTimeoutMs: 60 });
    const recipe = v2(r.recipe);
    const out = await replay(r.recipe, '/a');
    expect(out.status).toBe('ok');
    expect(out.reveals.map((x) => x.label)).toContain('Electrical data');
    expect(out.reveals.map((x) => x.label)).toContain('Downloads');
    expect(out.issues.some((i) => i.reason === 'template_drift')).toBe(false);
  }, 45000);

  it('merges a non-exact overview alias with the detailed source', async () => {
    const judge = v2Judge({
      relationNoul: (kind: string, ins: Record<string, any>) => {
        const l = String(ins.left?.label ?? '');
        const r = String(ins.right?.label ?? '');
        return (l === 'Overview Material' && r === 'Material') || (l === 'Material' && r === 'Overview Material') ? 0.95 : 0;
      },
    });
    const r = await compileDetailRecipe(context, judge, detailTargets('https://detail.test', ['/ove1', '/ove2', '/ove3']), { pauseMs: 0, revealTimeoutMs: 300 });
    const recipe = v2(r.recipe);
    const material = recipe.fields.find((f) => f.label === 'Material')!;
    expect(material.section).toEqual(['Technical data']);
    expect(material.aliases).toContain('Overview Material');
    expect(material.sources.length).toBeGreaterThanOrEqual(2);
    const out = await replay(r.recipe, '/ove4');
    expect(out.values[detailFieldKey(['Technical data'], 'Material')]).toBe('NBR');
  }, 60000);

  it('flags an uninspected declared region as region_missing', async () => {
    const r = await compileDetailRecipe(context, v2Judge(), detailTargets('https://detail.test', ['/a', '/b', '/c']), { pauseMs: 0, revealTimeoutMs: 60 });
    const out = await replay(r.recipe, '/a2');
    expect(out.status).toBe('partial');
    expect(out.issues.some((i) => i.reason === 'region_missing')).toBe(true);
  }, 45000);
});

describe('learnDetailSchema (isolated)', () => {
  const row = (label: string, value: string, i = 0) => ({ label, value, evidence: { id: `r${i + 1}`, kind: 'table_row' as const, label_tag: 'td', value_tag: 'td' } });
  const heading = (text: string, depth = 0) => ({ id: `h${depth + 1}`, text, tag: 'h3', via: 'heading' as const, itemprop: '', relation: 'ancestor' as const, depth });
  const block = (section: string[], rows: [string, string][], id = 'b1', path: { tag: string; role: string; itemprop: string; classes: string[] }[] = []) => ({
    id, section, kind: 'table' as const,
    rows: rows.map(([l, v], i) => row(l, v, i)),
    links: [], total_rows: rows.length,
    evidence: { headings: section.map(heading), path },
  });
  const structPath = [{ tag: 'div', role: '', itemprop: '', classes: ['facts'] }];
  const sample = (url: string, blocks: ReturnType<typeof block>[]): SchemaSampleInput => ({
    url, signature: 'v2#', mechanisms: [{ source: 'labelled', via: 'Part no.' }], seen: [],
    identity: 'matched', status: 'ok', issues: [],
    captures: [{
      phase: 'initial', url, control_roles: {},
      block_roles: Object.fromEntries(blocks.map((b) => [b.id, 'specifications'])),
      obs: {
        url, title: 't', scope: 'main',
        candidates: [{ id: 'c1', source: 'labelled', via: 'Part no.', value: 'X-1', context: '', section: [] }],
        controls: [], blocks, text: 't', truncated: [], evidence_truncated: [],
        fingerprint: 'x', unsupported_frames: 0,
      },
    }],
  });
  const isoJudge = (noulOf: (l: string, r: string, kind: string, ins?: Record<string, unknown>) => number = () => 0.95, malformed = false): Judge => ({
    ask: async <Q extends Record<string, unknown>>(step: string, _s: unknown, qs: Q) => {
      const out: Record<string, unknown> = {};
      if (malformed) return out as Record<keyof Q, unknown>;
      const pick = (role: string) => ({ choice: role, probabilities: { [role]: 0.95 } });
      for (const [k, ins] of Object.entries(qs)) {
        if (step === 'detail-heading') out[k] = pick('specification_section');
        else if (step === 'detail-field') out[k] = pick('product_attribute');
        else if (step === 'detail-download') out[k] = pick('direct_download');
        else {
          const kind = step === 'detail-section-relation' ? 'section' : step === 'detail-field-relation' ? 'field' : 'duplicate';
          const pair = ins as { instructions?: { left?: { label?: string }; right?: { label?: string } } };
          out[k] = { noul: noulOf(String(pair.instructions?.left?.label ?? ''), String(pair.instructions?.right?.label ?? ''), kind, pair.instructions as Record<string, unknown> | undefined) ?? 0.95 };
        }
      }
      return out as Record<keyof Q, unknown>;
    },
    trace: [],
  });
  const three = (rows: [string, string][]) => [
    sample('https://x.test/p1', [block(['Technical data'], rows)]),
    sample('https://x.test/p2', [block(['Technical data'], rows)]),
    sample('https://x.test/p3', [block(['Technical data'], rows)]),
  ];

  it('marks learning unusable when every answer is missing or malformed', async () => {
    const { recipe, learned } = await learnDetailSchema(three([['Voltage', '24 V']]), isoJudge(() => 0.95, true));
    expect(recipe.learning.state).toBe('unusable');
    expect(recipe.fields).toEqual([]);
    expect(learned.unresolved.length).toBeGreaterThan(0);
  });

  it('caps non-exact relation proposals and keeps unmerged groups unresolved', async () => {
    const rows = Array.from({ length: 30 }, (_, i) => [`Field ${i}`, 'v'] as [string, string]);
    const samples = [sample('https://x.test/p1', [block(['Technical data'], rows)]), sample('https://x.test/p2', [block(['Technical data'], rows)]), sample('https://x.test/p3', [block(['Technical data'], rows.map(([l], i) => [`Alt ${i}`, 'v']))])];
    const { recipe, learned } = await learnDetailSchema(samples, isoJudge());
    expect(learned.unresolved.some((u) => u.reason === 'relation_cap')).toBe(true);
    expect(recipe.learning.state).toBe('partial');
    expect(recipe.fields.filter((f) => f.aliases.length).length).toBeLessThan(30);
  });

  it('does not merge a transitive chain when one member is a confirmed mismatch', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Technical data'], [['Watt', '5 W']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Power', '5 W']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Wattage', '5 W']])]),
    ];
    const judge = isoJudge((l, r) => (l === 'Watt' && r === 'Wattage') || (l === 'Wattage' && r === 'Watt') ? 0.05 : 0.95);
    const { recipe } = await learnDetailSchema(samples, judge);
    const merged = recipe.fields.find((f) => f.aliases.length >= 2);
    expect(merged).toBeUndefined();
  });

  it('refuses case-distinct symbols, unit conflicts and composite labels despite all-yes answers', async () => {
    const dRun = await learnDetailSchema([
      sample('https://x.test/p1', [block(['Technical data'], [['D', '5 mm'], ['d', '2 mm']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Diameter', '5 mm']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['D', '5 mm']])]),
    ], isoJudge());
    for (const f of dRun.recipe.fields) {
      const names = [f.label, ...f.aliases];
      expect(names.includes('d') && names.some((n) => ['D', 'Diameter'].includes(n))).toBe(false);
    }
    const uRun = await learnDetailSchema([
      sample('https://x.test/p1', [block(['Technical data'], [['Mass', '800 g']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Length', '800 mm']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Mass', '800 g']])]),
    ], isoJudge());
    const mass = uRun.recipe.fields.find((f) => f.label === 'Mass');
    expect(mass?.aliases).not.toContain('Length');
    expect(uRun.recipe.fields.find((f) => f.label === 'Length')?.aliases).not.toContain('Mass');
    const cRun = await learnDetailSchema([
      sample('https://x.test/p1', [block(['Technical data'], [['Size and material', 'x']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Material', 'x']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Material', 'x']])]),
    ], isoJudge());
    const composite = cRun.recipe.fields.find((f) => f.label === 'Size and material');
    expect(composite?.aliases).not.toContain('Material');
    const material = cRun.recipe.fields.find((f) => f.label === 'Material');
    expect(material?.aliases).not.toContain('Size and material');
  });

  it('refuses to bridge two coexisting scopes through a third product', async () => {
    const samples = [
      sample('https://x.test/p1', [
        block(['Electrical data'], [['Voltage', '24 V']], 'b1'),
        block(['Mechanical data'], [['Voltage', '230 V']], 'b2'),
      ]),
      sample('https://x.test/p2', [block(['Technical data'], [['Voltage', '24 V']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Voltage', '24 V']])]),
    ];
    const { recipe } = await learnDetailSchema(samples, isoJudge());
    for (const f of recipe.fields.filter((x) => x.label === 'Voltage')) {
      const regions = f.sources.map((s) => s.region.join('>'));
      expect(regions.includes('Electrical data') && regions.includes('Mechanical data')).toBe(false);
    }
  });

  it('lets a section no stand while a confirmed duplicate merge still works', async () => {
    const samples = [
      sample('https://x.test/p1', [
        block([], [['Material', 'NBR']], 'b1', structPath),
        block(['Technical data'], [['Material', 'NBR']], 'b2'),
      ]),
      sample('https://x.test/p2', [
        block([], [['Material', 'NBR']], 'b1', structPath),
        block(['Technical data'], [['Material', 'NBR']], 'b2'),
      ]),
      sample('https://x.test/p3', [
        block([], [['Material', 'NBR']], 'b1', structPath),
        block(['Technical data'], [['Material', 'NBR']], 'b2'),
      ]),
    ];
    const judge = isoJudge((_l, _r, kind) => (kind === 'section' ? 0.05 : 0.95));
    const { recipe } = await learnDetailSchema(samples, judge);
    const material = recipe.fields.find((f) => f.label === 'Material')!;
    expect(material.section).toEqual(['Technical data']);
    expect(material.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps an unconfirmed coexisting slot untrusted while a disjoint layout is declared', async () => {
    const pA = [{ tag: 'div', role: '', itemprop: '', classes: ['lay-a'] }];
    const pB = [{ tag: 'div', role: '', itemprop: '', classes: ['lay-b'] }];
    const pC = [{ tag: 'div', role: '', itemprop: '', classes: ['lay-c'] }];
    const samples = [
      sample('https://x.test/p1', [
        block(['Technical data'], [['Voltage', '24 V']], 'b1', pA),
        block(['Technical data'], [['Voltage', '230 V']], 'b2', pB),
      ]),
      sample('https://x.test/p2', [block(['Technical data'], [['Voltage', '24 V']], 'b1', pC)]),
      sample('https://x.test/p3', [block(['Technical data'], [['Voltage', '24 V']], 'b1', pA)]),
    ];
    const judge = isoJudge((_l, _r, kind) => (kind === 'duplicate' ? 0 : 0.95));
    const { recipe, learned } = await learnDetailSchema(samples, judge);
    const voltage = recipe.fields.find((f) => f.label === 'Voltage')!;
    expect(voltage.sources.length).toBe(2);
    expect(learned.unresolved.some((u) => u.reason === 'duplicate_unconfirmed')).toBe(true);
  });

  it('does not admit a slot through a chain that skips a confirmed coexisting no', async () => {
    const pA = [{ tag: 'div', role: '', itemprop: '', classes: ['lay-a'] }];
    const pB = [{ tag: 'div', role: '', itemprop: '', classes: ['lay-b'] }];
    const pC = [{ tag: 'div', role: '', itemprop: '', classes: ['lay-c'] }];
    const samples = [
      sample('https://x.test/p1', [
        block(['Technical data'], [['Voltage', '24 V']], 'b1', pA),
        block(['Technical data'], [['Voltage', '230 V']], 'b2', pB),
      ]),
      sample('https://x.test/p2', [
        block(['Technical data'], [['Voltage', '230 V']], 'b2', pB),
        block(['Technical data'], [['Voltage', '24 V']], 'b3', pC),
      ]),
      sample('https://x.test/p3', [block(['Technical data'], [['Voltage', '24 V']], 'b1', pA)]),
    ];
    const judge = isoJudge((_l, _r, kind, ins) => {
      if (kind !== 'duplicate') return 0.95;
      const t = JSON.stringify(ins ?? '');
      const has = (x: string) => t.includes(`lay-${x}`);
      return has('a') && has('b') ? 0 : 0.95;
    });
    const { recipe } = await learnDetailSchema(samples, judge);
    const voltage = recipe.fields.find((f) => f.label === 'Voltage')!;
    expect(voltage.sources.length).toBe(2);
    const srcs = JSON.stringify(voltage.sources);
    expect(srcs).toContain('lay-a');
    expect(srcs).toContain('lay-c');
    expect(srcs).not.toContain('lay-b');
  });

  it('refuses an all-yes unheaded bridge between coexisting named scopes', async () => {
    const samples = [
      sample('https://x.test/p1', [
        block([], [['Voltage', '24 V']], 'b1', structPath),
        block(['Electrical data'], [['Voltage', '24 V']], 'b2'),
        block(['Mechanical data'], [['Voltage', '230 V']], 'b3'),
      ]),
      sample('https://x.test/p2', [
        block([], [['Voltage', '24 V']], 'b1', structPath),
        block(['Electrical data'], [['Voltage', '24 V']], 'b2'),
        block(['Mechanical data'], [['Voltage', '230 V']], 'b3'),
      ]),
      sample('https://x.test/p3', [
        block([], [['Voltage', '24 V']], 'b1', structPath),
        block(['Electrical data'], [['Voltage', '24 V']], 'b2'),
        block(['Mechanical data'], [['Voltage', '230 V']], 'b3'),
      ]),
    ];
    const { recipe } = await learnDetailSchema(samples, isoJudge());
    for (const f of recipe.fields.filter((x) => x.label === 'Voltage')) {
      const regions = f.sources.map((s) => s.region.join('>'));
      expect(regions.includes('Electrical data') && regions.includes('Mechanical data')).toBe(false);
    }
  });

  it('refuses distinct labels coexisting in one block despite all-yes answers', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Technical data'], [['Mass', '800 g'], ['Length', '800 mm']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Mass', '800 g']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Mass', '800 g']])]),
    ];
    const judge = isoJudge((l, r) => (l === 'Mass' && r === 'Length') || (l === 'Length' && r === 'Mass') ? 0.95 : 0);
    const { recipe } = await learnDetailSchema(samples, judge);
    const mass = recipe.fields.find((f) => f.label === 'Mass');
    const length = recipe.fields.find((f) => f.label === 'Length');
    expect(mass?.aliases).not.toContain('Length');
    expect(length?.aliases).not.toContain('Mass');
  });

  it('merges a fully positive three-alias clique without invented conflicts', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Technical data'], [['Power', '5 W']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Wattage', '5 W']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Watt', '5 W']])]),
    ];
    const { recipe } = await learnDetailSchema(samples, isoJudge());
    const f = recipe.fields.filter((x) => ['Power', 'Wattage', 'Watt'].includes(x.label));
    expect(f.length).toBe(1);
    expect(new Set([f[0]!.label, ...f[0]!.aliases])).toEqual(new Set(['Power', 'Wattage', 'Watt']));
  });

  it('refuses incompatible bracket-label units', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Technical data'], [['Mass [g]', '800']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Length [mm]', '800']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['Mass [g]', '800']])]),
    ];
    const { recipe } = await learnDetailSchema(samples, isoJudge());
    const mass = recipe.fields.find((f) => f.label === 'Mass [g]');
    const length = recipe.fields.find((f) => f.label === 'Length [mm]');
    expect(mass?.aliases).not.toContain('Length [mm]');
    expect(length?.aliases).not.toContain('Mass [g]');
  });

  it('tolerates manufacturer labels containing literal pipes', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Technical data'], [['A||B', '1'], ['C', '2']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['A||B', '1'], ['C', '2']])]),
      sample('https://x.test/p3', [block(['Technical data'], [['A||B', '1'], ['C', '2']])]),
    ];
    const { recipe } = await learnDetailSchema(samples, isoJudge());
    expect(recipe.fields.find((f) => f.label === 'A||B')).toBeTruthy();
    expect(recipe.fields.find((f) => f.label === 'C')).toBeTruthy();
    expect(recipe.fields).toHaveLength(2);
  });

  it('lets a duplicate no across products stand while section and field aliases merge', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Specifications'], [['Voltage', '24 V']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Voltage', '24 V']])]),
      sample('https://x.test/p3', [block(['Specifications'], [['Voltage', '24 V']])]),
    ];
    const judge = isoJudge((_l, _r, kind) => (kind === 'duplicate' ? 0.05 : 0.95));
    const { recipe } = await learnDetailSchema(samples, judge);
    const region = recipe.regions.find((x) => x.section.includes('Specifications'));
    expect(region?.aliases.some((a) => a.includes('Technical data'))).toBe(true);
  });

  it('spends one shared relation budget across every proposal kind', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => [`F${i}`, 'v'] as [string, string]);
    const samples = [
      sample('https://x.test/p1', [block(['A'], rows)]),
      sample('https://x.test/p2', [block(['B'], rows)]),
      sample('https://x.test/p3', [block(['C'], rows)]),
    ];
    const asked: string[] = [];
    const judge = isoJudge();
    const ask = judge.ask.bind(judge);
    judge.ask = async (step, state, qs) => {
      if (String(step).includes('relation')) asked.push(...Object.keys(qs as Record<string, unknown>));
      return ask(step, state, qs);
    };
    await learnDetailSchema(samples, judge);
    expect(asked.length).toBeLessThanOrEqual(300);
    expect(asked.length).toBeGreaterThan(0);
  });

  it('treats out-of-range and non-finite nouls as unverified, never merges', async () => {
    for (const noul of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { recipe, learned } = await learnDetailSchema(three([['Voltage', '24 V']]), isoJudge(() => noul));
      expect(learned.relations.every((x) => !x.accepted)).toBe(true);
      expect(recipe.fields.every((f) => f.aliases.length === 0)).toBe(true);
    }
  });

  it('counts unknown coverage for an uninspected region instead of absence', async () => {
    const samples = [
      sample('https://x.test/p1', [block(['Technical data'], [['Torque', '8 Nm']])]),
      sample('https://x.test/p2', [block(['Technical data'], [['Torque', '8 Nm']])]),
      sample('https://x.test/p3', [block(['Other'], [['Torque', '8 Nm']])]),
    ];
    const { recipe } = await learnDetailSchema(samples, isoJudge(() => 0.05));
    const t = recipe.fields.find((f) => f.label === 'Torque')!;
    expect(t.coverage.unknown).toEqual(['https://x.test/p3']);
  });
});
