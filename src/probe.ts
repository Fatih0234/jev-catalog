import { choice, noul } from '@typesafe-ai/sdk';
import type { BrowserContext } from 'playwright';
import { settle, snapshot } from './browser.js';
import type { Judge } from './jev.js';
import type { Group, Snapshot } from './types.js';

/**
 * Family vs product is often invisible on the listing card ("VEGAPULS 42" looks like a model).
 * It shows on the item page: one article number vs a variant table or ordering-code configurator.
 */
export const ITEM_PAGE_KINDS = {
  single_product:
    'The page is about one specific orderable product: it shows one article number or order code and one set of specifications.',
  series_with_variants:
    'The page is about a product series, family or product line and offers several variants, models, sizes or article numbers, for example a variant or model table, an ordering-code configurator, or a list of models to choose from.',
  listing: 'The page mainly lists other products or categories to choose from.',
  other: 'Something else, such as an error, a login page, a download or a marketing page without product data.',
} as const;
export type ItemPageKind = keyof typeof ITEM_PAGE_KINDS;

export const PROBE_COUNT = 2;

/** Pick up to n distinct same-site item links, spread across the list. */
export function probeLinks(group: Group, pageUrl: string, n = PROBE_COUNT): string[] {
  const origin = new URL(pageUrl).origin;
  const seen = new Set<string>();
  const links: string[] = [];
  for (const raw of group.item_links) {
    if (!raw) continue;
    const u = new URL(raw);
    u.hash = '';
    if (u.origin !== origin || u.href === pageUrl || seen.has(u.href)) continue;
    seen.add(u.href);
    links.push(u.href);
  }
  if (links.length <= n) return links;
  // First item and one from the middle: two templates are likelier to disagree than neighbours.
  return [links[0]!, links[Math.floor(links.length / 2)]!].slice(0, n);
}

export function itemPageRequest(snap: Snapshot) {
  const state = {
    page: { url: snap.url, title: snap.title },
    headings: snap.headings.slice(0, 12),
    text_start: snap.text.slice(0, 2500),
    repeated_groups: snap.groups.slice(0, 4).map(({ item_count, heading, samples }) => ({ item_count, heading, samples })),
  };
  const questions = {
    item_page_kind: choice('What is this page about?', ITEM_PAGE_KINDS as any),
    several_codes: noul('Does the page show several different article numbers, order codes or model numbers for the product?'),
    one_exact_code: noul(
      'Does the page identify the product shown by exactly one complete article number or order code, for example "Item no. 221-413"?',
    ),
    configurator: noul(
      'Does the page let the visitor choose product options, such as a configurator, option dropdowns or selectable sizes, variants or versions, before ordering or requesting a quote?',
    ),
  };
  return { state, questions };
}

export interface ProbeResult {
  url: string;
  final_url?: string;
  kind?: ItemPageKind;
  confidence?: number;
  several_codes?: number;
  configurator?: number;
  one_exact_code?: number;
  error?: string;
}

export async function probeItems(context: BrowserContext, judge: Judge, group: Group, pageUrl: string): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const url of probeLinks(group, pageUrl)) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settle(page);
      const snap = await snapshot(page);
      const { state, questions } = itemPageRequest(snap);
      const a = (await judge.ask('probe', state, questions)) as any;
      results.push({ url, final_url: snap.url, kind: a.item_page_kind.choice, confidence: a.item_page_kind.confidence, several_codes: a.several_codes.noul, configurator: a.configurator.noul, one_exact_code: a.one_exact_code.noul });
    } catch (e) {
      results.push({ url, error: String(e).slice(0, 160) });
    } finally {
      await page.close();
    }
  }
  return results;
}

/**
 * A product with an options configurator counts as a family (user decision, 2026-09-30).
 * A page that already names one exact article (WAGO "Item no. 221-413") and only offers a switcher
 * to sibling articles is a product: the siblings are separate leaf products.
 */
export const CONFIGURATOR_MIN_PROBABILITY = 0.6;
export const EXACT_CODE_MIN_PROBABILITY = 0.5;
export const isConfigurableFamily = (p: ProbeResult) =>
  (p.configurator ?? 0) >= CONFIGURATOR_MIN_PROBABILITY && (p.one_exact_code ?? 0) < EXACT_CODE_MIN_PROBABILITY;

/** Code combines probe verdicts: any series or configurable page means the list holds families. */
export function itemsFromProbes(probes: ProbeResult[]): 'individual_product' | 'product_family' | 'product_category' | undefined {
  if (probes.some(isConfigurableFamily)) return 'product_family';
  const kinds = probes.filter((p) => p.kind && (p.confidence ?? 0) >= 0.5).map((p) => p.kind);
  if (kinds.includes('series_with_variants')) return 'product_family';
  if (kinds.length && kinds.every((k) => k === 'single_product')) return 'individual_product';
  if (kinds.length && kinds.every((k) => k === 'listing')) return 'product_category';
  return undefined;
}
