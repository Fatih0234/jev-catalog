import { readFileSync } from 'node:fs';
import { choice } from '@typesafe-ai/sdk';
import type { Page } from 'playwright';
import { settle } from './browser.js';
import type { Judge } from './jev.js';
import { applyRecipe, mergeByIdentity, readItems, type ListingRecipe, type Row } from './listing.js';

const PAGING_SRC = readFileSync(new URL('./page/paging.js', import.meta.url), 'utf8');

// ---------- Page evidence ----------

export interface PagingCandidate {
  id: string;
  label: string;
  hint?: string;
  href?: string;
  position: 'above' | 'beside' | 'below' | 'far';
  in_pager: boolean;
  disabled: boolean;
  current: boolean;
}
export interface PagingDump {
  url: string;
  item_count: number;
  candidates: PagingCandidate[];
  selects: { id: string; options: string[]; selected: string }[];
  rel_next: string | null;
  scroll_height: number;
}

export async function collectPaging(page: Page, recipe: Pick<ListingRecipe, 'item_signature' | 'container_signature'>): Promise<PagingDump> {
  return page.evaluate(`(${PAGING_SRC})(${JSON.stringify({ itemSignature: recipe.item_signature, containerSignature: recipe.container_signature })})`) as Promise<PagingDump>;
}

// ---------- Jev: what each control does ----------

export const PAGING_ROLES = {
  next_page: 'Goes to the next page of the list, for example "Next", "Weiter", "›" or an arrow icon pointing right.',
  page_number: 'Goes to one specific numbered page of the list, for example "2" or "3".',
  load_more: 'Loads more products into the same list, for example "Load more", "Show more" or "Mehr laden".',
  previous_first_last: 'Goes to the previous, first or last page of the list.',
  page_size: 'Changes how many products are shown per page.',
  other: 'Something else, such as a filter, sort order, category, product, download or contact link.',
} as const;
export type PagingRole = keyof typeof PAGING_ROLES;
export const PAGING_MIN_CONFIDENCE = 0.5;

export function pagingRequest(dump: PagingDump, context: { title: string; heading?: string }) {
  const state = { page: { title: context.title, url: dump.url }, list: { heading: context.heading ?? '', products_shown: dump.item_count } };
  const questions: Record<string, ReturnType<typeof choice>> = {};
  for (const c of dump.candidates) {
    questions[`role_${c.id}`] = choice(
      {
        control: {
          text: c.label || '(no text, icon only)',
          ...(c.hint ? { attributes: c.hint } : {}),
          ...(c.href ? { link: c.href } : {}),
          placed: `${c.position} the product list`,
          ...(c.in_pager ? { inside: 'a pagination bar' } : {}),
        },
        question: 'What does `control` do for the product list?',
      },
      PAGING_ROLES as any,
    );
  }
  for (const s of dump.selects) {
    questions[`role_${s.id}`] = choice(
      { control: { dropdown_options: s.options, selected: s.selected }, question: 'What does the dropdown `control` do for the product list?' },
      PAGING_ROLES as any,
    );
  }
  return { state, questions };
}

export function readRoles(answers: Record<string, any>): Record<string, { role: PagingRole; confidence: number }> {
  const out: Record<string, { role: PagingRole; confidence: number }> = {};
  for (const [k, a] of Object.entries(answers)) {
    if (!k.startsWith('role_')) continue;
    out[k.slice(5)] = { role: (a?.choice ?? 'other') as PagingRole, confidence: Number(a?.confidence ?? 0) };
  }
  return out;
}

// ---------- Mechanisms (pure) ----------

/** How to reach page n. URL templates are cheapest and replayable; clicks re-find their control each time. */
export type Mechanism =
  | { kind: 'url'; template: string; a: number; b: number; source: string }
  | { kind: 'click_next'; match: ControlMatch }
  | { kind: 'load_more'; match: ControlMatch }
  | { kind: 'click_number' }
  | { kind: 'scroll' };
export interface ControlMatch { label: string; hint?: string }

const NUM_TOKENS = /\d+/g;

/**
 * Fit a URL template from links to known page numbers. Two links that differ in exactly one number
 * give value = a * n + b ("page=1" for page 2 is zero-based, "start=50" is an offset).
 */
export function inferTemplate(links: { n: number; href: string }[]): { template: string; a: number; b: number } | undefined {
  const parse = (href: string) => {
    const raw = [...href.matchAll(NUM_TOKENS)].map((m) => m[0]);
    return { parts: href.split(NUM_TOKENS), raw, nums: raw.map(Number) };
  };
  const uniq = [...new Map(links.map((l) => [l.n, l])).values()].sort((x, y) => x.n - y.n);
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const p = parse(uniq[i]!.href), q = parse(uniq[j]!.href);
      if (p.parts.join('#') !== q.parts.join('#') || p.nums.length !== q.nums.length) continue;
      const diff = p.raw.map((v, k) => (v !== q.raw[k] ? k : -1)).filter((k) => k >= 0);
      if (diff.length !== 1) continue;
      const k = diff[0]!;
      const a = (q.nums[k]! - p.nums[k]!) / (uniq[j]!.n - uniq[i]!.n);
      if (!Number.isInteger(a) || a <= 0) continue;
      const b = p.nums[k]! - a * uniq[i]!.n;
      const template = p.parts.map((part, idx) => part + (idx < p.nums.length ? (idx === k ? '{v}' : p.raw[idx]) : '')).join('');
      return { template, a, b };
    }
  }
  return undefined;
}

/** A single "next" link from page 1: guess the scheme from its value (2 = page number, 1 = zero-based, N = offset). */
export function templateFromNext(href: string, currentUrl: string, perPage: number): { template: string; a: number; b: number } | undefined {
  const cur = new URL(currentUrl), nxt = new URL(href);
  if (cur.origin + cur.pathname !== nxt.origin + nxt.pathname) return undefined;
  const changed = [...nxt.searchParams.entries()].filter(([k, v]) => cur.searchParams.get(k) !== v && /^\d+$/.test(v));
  if (changed.length !== 1) return undefined;
  const [key, raw] = changed[0]!;
  const v = Number(raw);
  const scheme = v === 2 ? { a: 1, b: 0 } : v === 1 ? { a: 1, b: -1 } : v === perPage ? { a: perPage, b: -perPage } : undefined;
  if (!scheme) return undefined;
  nxt.searchParams.set(key, '__V__');
  return { template: nxt.href.replace('__V__', '{v}'), ...scheme };
}

export const pageUrl = (m: { template: string; a: number; b: number }, n: number) => m.template.replace('{v}', String(m.a * n + m.b));

/** Code's priority: replayable URLs, then next, load more, numbered clicks, and scrolling last. */
export function planMechanisms(dump: PagingDump, roles: Record<string, { role: PagingRole; confidence: number }>): Mechanism[] {
  const is = (c: PagingCandidate, r: PagingRole) => roles[c.id]?.role === r && roles[c.id]!.confidence >= PAGING_MIN_CONFIDENCE;
  const out: Mechanism[] = [];
  const numbered = dump.candidates.filter((c) => is(c, 'page_number') && c.href && /^\d+$/.test(c.label)).map((c) => ({ n: Number(c.label), href: c.href! }));
  const nextLinks = dump.candidates.filter((c) => is(c, 'next_page') && !c.disabled);
  const fromNumbers = inferTemplate(numbered);
  if (fromNumbers) out.push({ kind: 'url', ...fromNumbers, source: 'numbered links' });
  else {
    const nextHref = nextLinks.find((c) => c.href)?.href ?? dump.rel_next ?? undefined;
    const t = nextHref ? templateFromNext(nextHref, dump.url, dump.item_count) : undefined;
    if (t) out.push({ kind: 'url', ...t, source: 'next link' });
  }
  if (nextLinks[0]) out.push({ kind: 'click_next', match: { label: nextLinks[0].label, hint: nextLinks[0].hint } });
  const more = dump.candidates.find((c) => is(c, 'load_more') && !c.disabled);
  if (more) out.push({ kind: 'load_more', match: { label: more.label, hint: more.hint } });
  if (dump.candidates.some((c) => is(c, 'page_number') && c.label === '2')) out.push({ kind: 'click_number' });
  out.push({ kind: 'scroll' });
  return out;
}

export function findControl(dump: PagingDump, m: ControlMatch): PagingCandidate | undefined {
  return dump.candidates.find((c) => c.label === m.label && (c.hint ?? '') === (m.hint ?? '')) ?? dump.candidates.find((c) => c.label === m.label && c.label !== '');
}

// ---------- Running it ----------

export interface PagingStep { page: number; pass?: number; new_rows: number; repeated_rows: number; total_rows: number; ms: number; server_errors?: number }
export interface PagingResult {
  mechanism?: Mechanism;
  tried: { kind: string; ok: boolean; reason?: string }[];
  pages: number;
  rows: Row[];
  steps: PagingStep[];
  stop: 'single_page' | 'no_new_items' | 'not_advancing' | 'empty_page' | 'server_error' | 'end_of_list' | 'reached_total' | 'page_limit' | 'error';
  /** Passes over the list and the new rows each one added (the first pass includes page 1). */
  passes: { stop: PagingResult['stop']; new_rows: number }[];
  /** Pages the site failed to serve (HTTP 5xx while loading them). */
  failed_pages: number[];
  /** Rows that appeared again on a later page; many of them mean the site's order is not stable. */
  repeated_rows: number;
  advertised_total?: number;
  completeness_pct?: number;
}

export interface PagingOptions {
  maxPages?: number;
  /** Max time to wait for new products after an action. */
  waitMs?: number;
  /** Pause before each page after the second. Default 1 s: ifm's firewall blocked us after 34 pages in a minute. */
  pauseMs?: number;
  /**
   * Total passes over the list. Extra passes run only when the advertised total was not reached and
   * rows repeated across pages, which means the site's order shifts between loads.
   */
  maxPasses?: number;
  log?: (line: string) => void;
}

/** A further pass must add at least this share of the advertised total to justify another one. */
export const MIN_PASS_GAIN = 0.01;

/** Whether another pass over the list is worth it. Pure, so the policy is testable. */
export function shouldRepass(r: Pick<PagingResult, 'stop' | 'repeated_rows' | 'advertised_total'>, rows: number, passGain: number, passesDone: number, maxPasses: number): boolean {
  if (passesDone >= maxPasses || !r.advertised_total || rows >= r.advertised_total) return false;
  if (['server_error', 'error', 'single_page'].includes(r.stop)) return false;
  // A handful of repeats (Pepperl: 16 of 2960) is noise; a shifting order shows many.
  if (r.repeated_rows < MIN_PASS_GAIN * r.advertised_total) return false;
  return passGain >= MIN_PASS_GAIN * r.advertised_total;
}

/** Consecutive pages with nothing new before giving up (a page of repeats can still mean progress). */
export const MAX_STALE_PAGES = 3;
/** Pages the site fails to serve that a URL template may skip over. */
export const MAX_SKIPPED_PAGES = 3;

const idOf = (recipe: ListingRecipe) => (r: Row) => (recipe.identity ? r[recipe.identity] : undefined) ?? JSON.stringify(r);
const growing = (m: Mechanism) => m.kind === 'load_more' || m.kind === 'scroll';

async function readRows(page: Page, recipe: ListingRecipe, from = 0): Promise<{ rows: Row[]; total_items: number }> {
  const items = await readItems(page, { itemSignature: recipe.item_signature, containerSignature: recipe.container_signature, from, skipCounts: true });
  return { rows: mergeByIdentity(applyRecipe(recipe, items.items), recipe.identity), total_items: items.total_items };
}

/**
 * Wait until the list has changed after an action, then read it. Waiting is code's job: it knows what
 * it waits for. A loaded URL is read once rows exist; a click must show rows other than the previous
 * page; a growing list must show items beyond the old count. Repeats are fine: on lists whose order
 * shifts, a changed page full of known products is still progress.
 */
async function waitForChange(page: Page, recipe: ListingRecipe, m: Mechanism, previousIds: string, from: number, waitMs: number) {
  const id = idOf(recipe);
  const deadline = Date.now() + waitMs;
  let last = { rows: [] as Row[], total_items: 0 };
  while (Date.now() < deadline) {
    await page.waitForTimeout(m.kind === 'url' ? 100 : 500);
    try {
      last = await readRows(page, recipe, from);
      const changed = last.rows.length > 0 && (m.kind === 'url' || growing(m) || last.rows.map(id).join('\n') !== previousIds);
      if (changed) {
        await page.waitForTimeout(400); // let the rest of the batch render
        return await readRows(page, recipe, from).catch(() => last);
      }
    } catch {
      // navigation in progress
    }
  }
  return last;
}

async function clickTagged(page: Page, id: string): Promise<boolean> {
  const el = page.locator(`[data-jc-page="${id}"]`).first();
  if ((await el.count()) === 0) return false;
  await el.scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
  await el.click({ timeout: 5_000 }).catch(() => el.dispatchEvent('click'));
  return true;
}

/** Perform one step toward page n. Returns false when the control is gone or disabled (end of list). */
async function act(page: Page, recipe: ListingRecipe, m: Mechanism, n: number): Promise<boolean> {
  if (m.kind === 'url') {
    await page.goto(pageUrl(m, n), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page);
    return true;
  }
  if (m.kind === 'scroll') {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    return true;
  }
  const dump = await collectPaging(page, recipe);
  const target = m.kind === 'click_number' ? dump.candidates.find((c) => c.label === String(n) && !c.current) : findControl(dump, m.match);
  if (!target || target.disabled) return false;
  return clickTagged(page, target.id);
}

/** Count HTTP 5xx answers to page loads and data requests while `fn` runs. */
async function watchServerErrors<T>(page: Page, fn: () => Promise<T>): Promise<{ value: T; errors: number }> {
  let errors = 0;
  const onResponse = (r: import('playwright').Response) => {
    if (r.status() >= 500 && ['document', 'fetch', 'xhr'].includes(r.request().resourceType())) errors++;
  };
  page.on('response', onResponse);
  try {
    return { value: await fn(), errors };
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Page through a list whose first page is loaded and whose recipe is known. Jev names the paging
 * controls once; code tries mechanisms in priority order and keeps the first that brings products
 * it has not seen, then repeats it until the list stops advancing.
 */
export async function paginate(
  page: Page,
  judge: Judge,
  recipe: ListingRecipe,
  firstRows: Row[],
  context: { title: string; heading?: string },
  opts: PagingOptions = {},
): Promise<PagingResult> {
  const maxPages = opts.maxPages ?? 200;
  const waitMs = opts.waitMs ?? 12_000;
  const pauseMs = opts.pauseMs ?? 1_000;
  const log = opts.log ?? (() => {});
  const id = idOf(recipe);
  const seen = new Set(firstRows.map(id));
  const all = [...firstRows];
  const total = recipe.total?.value;
  const firstUrl = page.url();
  const result: PagingResult = { tried: [], pages: 1, rows: all, steps: [], stop: 'single_page', passes: [], failed_pages: [], repeated_rows: 0, advertised_total: total };
  const finish = (stop: PagingResult['stop']) => {
    result.stop = stop;
    if (total) result.completeness_pct = Math.round((1000 * all.length) / total) / 10;
    return result;
  };
  if (total !== undefined && all.length >= total) return finish('reached_total');

  const dump = await collectPaging(page, recipe);
  let roles: ReturnType<typeof readRoles> = {};
  if (dump.candidates.length || dump.selects.length) {
    const req = pagingRequest(dump, context);
    roles = readRoles(await judge.ask('paging', req.state, req.questions));
  }
  const plan = planMechanisms(dump, roles);

  const absorb = (rows: Row[]) => {
    let fresh = 0;
    for (const r of rows) if (!seen.has(id(r))) { seen.add(id(r)); all.push(r); fresh++; }
    return fresh;
  };

  // Find the first mechanism that brings new products on page 2.
  let itemsOnPage = dump.item_count;
  let previousIds = firstRows.map(id).join('\n');
  for (const m of plan) {
    const t0 = performance.now();
    const from = growing(m) ? itemsOnPage : 0;
    const acted = await act(page, recipe, m, 2).catch(() => false);
    const read = acted ? await waitForChange(page, recipe, m, previousIds, from, m.kind === 'scroll' ? 3_000 : waitMs) : { rows: [], total_items: 0 };
    const fresh = absorb(read.rows);
    result.tried.push({ kind: m.kind, ok: fresh > 0, ...(acted ? {} : { reason: 'control not found' }) });
    if (fresh > 0) {
      result.mechanism = m;
      result.pages = 2;
      itemsOnPage = read.total_items;
      previousIds = read.rows.map(id).join('\n');
      result.steps.push({ page: 2, new_rows: fresh, repeated_rows: read.rows.length - fresh, total_rows: all.length, ms: Math.round(performance.now() - t0) });
      log(`paging: ${m.kind} works, page 2 +${fresh}`);
      break;
    }
    if (m.kind === 'url' && page.url() !== firstUrl) {
      await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
      await settle(page);
    }
  }
  const m = result.mechanism;
  if (!m) return finish(plan.length > 1 ? 'no_new_items' : 'single_page');

  const expectedPages = total !== undefined && firstRows.length ? Math.ceil(total / firstRows.length) : undefined;
  /** Pages n = startPage.. until the list stops advancing. Returns why it stopped. */
  const runPass = async (startPage: number, pass: number): Promise<PagingResult['stop']> => {
    let stale = 0;
    for (let n = startPage; n <= maxPages; n++) {
      if (total !== undefined && all.length >= total) return 'reached_total';
      if (pauseMs) await page.waitForTimeout(pauseMs);
      const t0 = performance.now();
      const from = growing(m) ? itemsOnPage : 0;
      const { value: acted, errors } = await watchServerErrors(page, () => act(page, recipe, m, n).catch(() => false));
      if (!acted) return 'end_of_list';
      const { value: read, errors: waitErrors } = await watchServerErrors(page, () => waitForChange(page, recipe, m, previousIds, from, m.kind === 'scroll' ? 3_000 : waitMs));
      const serverErrors = errors + waitErrors;
      const fresh = absorb(read.rows);
      const repeated = read.rows.length - fresh;
      result.repeated_rows += repeated;
      if (growing(m)) itemsOnPage = Math.max(itemsOnPage, read.total_items);
      result.steps.push({ page: n, ...(pass > 1 ? { pass } : {}), new_rows: fresh, repeated_rows: repeated, total_rows: all.length, ms: Math.round(performance.now() - t0), ...(serverErrors ? { server_errors: serverErrors } : {}) });
      log(`paging: ${pass > 1 ? `pass ${pass} ` : ''}page ${n} +${fresh}${repeated ? ` (${repeated} seen before)` : ''}${serverErrors ? ` [${serverErrors} server errors]` : ''} (${all.length}${total ? `/${total}` : ''})`);

      if (read.rows.length === 0) {
        if (serverErrors) {
          if (!result.failed_pages.includes(n)) result.failed_pages.push(n);
          // A URL can jump over a page the site fails to serve; a click-driven list usually cannot.
          if (m.kind === 'url' && result.failed_pages.length <= MAX_SKIPPED_PAGES) continue;
          return 'server_error';
        }
        return 'empty_page';
      }
      const ids = read.rows.map(id).join('\n');
      if (!growing(m) && ids === previousIds) return 'not_advancing';
      previousIds = ids;
      stale = fresh === 0 ? stale + 1 : 0;
      // With an advertised total, repeats before the expected last page mean a shifting order, not the end.
      if (stale >= MAX_STALE_PAGES && (expectedPages === undefined || n > expectedPages)) return 'no_new_items';
      result.pages = Math.max(result.pages, n);
    }
    return total !== undefined && all.length >= total ? 'reached_total' : 'page_limit';
  };

  const maxPasses = opts.maxPasses ?? 3;
  let before = 0;
  let stop = await runPass(3, 1);
  result.passes.push({ stop, new_rows: all.length - before });
  while (shouldRepass({ stop, repeated_rows: result.repeated_rows, advertised_total: total }, all.length, result.passes.at(-1)!.new_rows, result.passes.length, maxPasses)) {
    // The order shifted between loads: start again from page 1 and keep only products not seen yet.
    before = all.length;
    await page.goto(firstUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page);
    absorb((await readRows(page, recipe)).rows);
    itemsOnPage = (await readRows(page, recipe)).total_items;
    previousIds = '';
    log(`paging: pass ${result.passes.length + 1} (${all.length}/${total})`);
    stop = await runPass(2, result.passes.length + 1);
    result.passes.push({ stop, new_rows: all.length - before });
  }
  return finish(stop);
}
