import { readFileSync } from 'node:fs';
import { choice, noul } from '@typesafe-ai/sdk';
import type { Page } from 'playwright';
import type { Judge } from './jev.js';

const ITEMS_SRC = readFileSync(new URL('./page/items.js', import.meta.url), 'utf8');

// ---------- Page evidence ----------

export interface Leaf {
  /** Structural path inside the item, or "td:<i>" for table cells. */
  path: string;
  /** Path of the leaf's parent element; label and value pairs share it. */
  parent: string;
  value: string;
  /** Explicit label found on the page: a column header, a <dt>, "Label:" text, or "Label: value". */
  label?: string;
}
export interface RawItem {
  leaves: Leaf[];
  links: string[];
  image?: string;
}
export interface PageItems {
  url: string;
  item_signature: string;
  container_signature: string;
  containers: number;
  items: RawItem[];
  count_texts: string[];
}

export async function readItems(page: Page, target: { group: string } | { itemSignature: string; containerSignature: string }): Promise<PageItems> {
  return page.evaluate(`(${ITEMS_SRC})(${JSON.stringify(target)})`) as Promise<PageItems>;
}

// ---------- Slot alignment (pure) ----------

export interface Slot {
  key: string;
  /** Label shown on the page for this slot, if any. */
  label?: string;
  /** Share of items that have a value here, 0..1. */
  coverage: number;
  /** Distinct values divided by filled items, 0..1. 1 means every item differs. */
  distinct: number;
  samples: string[];
}

export interface Alignment {
  slots: Slot[];
  /** Constant leaves that act as labels for the value that follows them: key -> label text. */
  pairs: Record<string, string>;
  /** Per item, slot key -> value. */
  rows: Record<string, string>[];
}

const leafKey = (l: Leaf) => (l.label ? `label:${l.label}` : l.path);

/**
 * Turn items into rows keyed by slot. Two passes: first find leaves whose value is the same in every
 * item ("Measuring range", "Add to cart"); a constant followed by a varying value under the same
 * parent is a label, so the value is keyed by that label and the constant leaf is dropped.
 */
export function alignSlots(items: RawItem[], knownPairs?: Record<string, string>): Alignment {
  let pairs = knownPairs;
  if (!pairs) {
    pairs = {};
    const values = new Map<string, Set<string>>();
    const present = new Map<string, number>();
    for (const it of items) {
      const seen = new Set<string>();
      for (const l of it.leaves) {
        const k = leafKey(l);
        if (!values.has(k)) values.set(k, new Set());
        values.get(k)!.add(l.value);
        if (!seen.has(k)) present.set(k, (present.get(k) ?? 0) + 1);
        seen.add(k);
      }
    }
    const constant = (k: string) =>
      items.length >= 3 && (present.get(k) ?? 0) >= 0.6 * items.length && values.get(k)!.size === 1 && [...values.get(k)!][0]!.length <= 40;
    for (const it of items) {
      it.leaves.forEach((l, i) => {
        const next = it.leaves[i + 1];
        const k = leafKey(l);
        // Label and value share a wrapper (a spec row, a price box); leaves directly in the card do not pair.
        if (!l.label && constant(k) && next && !next.label && next.parent === l.parent && l.parent !== '.' && !constant(leafKey(next))) pairs![k] = l.value;
      });
    }
  }
  const rows = items.map((it) => {
    const row: Record<string, string> = {};
    const put = (k: string, v: string) => { row[k] = row[k] ? `${row[k]} | ${v}` : v; };
    for (let i = 0; i < it.leaves.length; i++) {
      const l = it.leaves[i]!;
      const k = leafKey(l);
      const next = it.leaves[i + 1];
      if (pairs![k] !== undefined && l.value === pairs![k] && next && !next.label && next.parent === l.parent) {
        put(`label:${pairs![k]}`, next.value);
        i++;
        continue;
      }
      put(k, l.value);
    }
    return row;
  });
  const order: string[] = [];
  const stats = new Map<string, string[]>();
  for (const r of rows) for (const [k, v] of Object.entries(r)) {
    if (!stats.has(k)) { stats.set(k, []); order.push(k); }
    stats.get(k)!.push(v);
  }
  const slots = order.map((key) => {
    const vals = stats.get(key)!;
    const distinctVals = [...new Set(vals)];
    return {
      key,
      ...(key.startsWith('label:') ? { label: key.slice(6) } : {}),
      coverage: vals.length / Math.max(1, rows.length),
      distinct: distinctVals.length / vals.length,
      samples: distinctVals.slice(0, 5),
    };
  });
  return { slots, pairs, rows };
}

/** The item's own link: the anchor position whose URL differs most across items. */
export function ownLinkPosition(items: RawItem[]): number | undefined {
  const max = Math.max(0, ...items.map((i) => i.links.length));
  let best: number | undefined;
  let bestDistinct = 1;
  for (let p = 0; p < max; p++) {
    const d = new Set(items.map((i) => i.links[p]).filter(Boolean)).size;
    if (d > bestDistinct) { bestDistinct = d; best = p; }
  }
  return best;
}

// ---------- Jev: slot roles and advertised total ----------

export const SLOT_ROLES = {
  name: 'The product name or title.',
  order_code: 'An article number, order code, part number, SKU or type code that identifies one product.',
  description: 'A descriptive sentence or short text about the product.',
  spec: 'A technical property value, such as a dimension, range, material, voltage, thread or weight.',
  price: 'A price or price range.',
  availability: 'Stock, availability or delivery time.',
  category: 'The category, series or family the product belongs to.',
  chrome: 'Text that is not product data: a button or link text, a badge, a marketing phrase, or a label that is the same for every product, such as "Add to cart", "Compare" or "Details".',
  other: 'Other product data.',
} as const;
export type SlotRole = keyof typeof SLOT_ROLES;

export const COUNT_KINDS = {
  product_count: 'How many products there are in total, for example "Products (31)", "3,823 products" or "Applicable products: 1655".',
  result_count: 'How many search results there are, which may include documents, pages or other content besides products, for example "All results 49".',
  page_count: 'How many pages the list has, for example "Page 1 of 34".',
  other: 'Something else, such as a filter option count, a product value, a cart count or a phone number.',
} as const;

export const LISTING_THRESHOLDS = { count: 0.6, minCoverage: 0.2 };
const MAX_SLOTS_ASKED = 40;

export function listingRequest(pageItems: PageItems, al: Alignment, context: { title: string; heading?: string }) {
  const asked = al.slots.filter((s) => s.coverage >= LISTING_THRESHOLDS.minCoverage).slice(0, MAX_SLOTS_ASKED);
  const example = (r: Record<string, string>) => Object.values(r).join(' · ').slice(0, 400);
  const state = {
    page: { title: context.title, url: pageItems.url },
    list: { heading: context.heading ?? '', item_count: pageItems.items.length, example_items: al.rows.slice(0, 3).map(example) },
  };
  const questions: Record<string, ReturnType<typeof choice>> = {};
  asked.forEach((s, i) => {
    questions[`role_${i}`] = choice(
      {
        slot: { ...(s.label ? { label: s.label } : {}), sample_values: s.samples, filled_in_pct: Math.round(100 * s.coverage) },
        question: 'Each product in the list shows a value at the position described by `slot`. What does this position hold?',
      },
      SLOT_ROLES as any,
    );
  });
  pageItems.count_texts.forEach((text, i) => {
    questions[`count_${i}`] = choice({ text, question: 'What number does `text` state?' }, COUNT_KINDS as any);
  });
  return { state, questions, asked: asked.map((s) => s.key) };
}

/** Code proposes label pairs from constants; Jev confirms each, because a constant can also be a series name. */
export function pairRequest(al: Alignment) {
  const keys = Object.keys(al.pairs);
  const questions: Record<string, ReturnType<typeof noul>> = {};
  keys.forEach((k, i) => {
    const valueKey = `label:${al.pairs[k]}`;
    const slot = al.slots.find((s) => s.key === valueKey);
    questions[`pair_${i}`] = noul({
      text: al.pairs[k] ?? '',
      values_after_it: slot?.samples.slice(0, 4) ?? [],
      question: 'Every product in the list shows `text` directly before one of `values_after_it`. Is `text` a field label that names that value, such as "Preis", "Measuring range" or "Weight"? A product type, series name, category or link is not a field label.',
    });
  });
  return { questions, keys };
}

export const PAIR_MIN_PROBABILITY = 0.5;

export function acceptedPairs(al: Alignment, keys: string[], answers: Record<string, any>): Record<string, string> {
  const out: Record<string, string> = {};
  keys.forEach((k, i) => { if (Number(answers[`pair_${i}`]?.noul ?? 0) >= PAIR_MIN_PROBABILITY) out[k] = al.pairs[k]!; });
  return out;
}

// ---------- Recipe (pure) ----------

export interface Field {
  key: string;
  name: string;
  role: SlotRole;
  confidence: number;
  coverage: number;
}
export interface ListingRecipe {
  version: 1;
  source_url: string;
  item_signature: string;
  container_signature: string;
  pairs: Record<string, string>;
  own_link_position?: number;
  fields: Field[];
  dropped: { key: string; role: string; samples: string[] }[];
  identity?: string;
  total?: { text: string; value: number; kind: 'product_count' | 'result_count' };
  pages?: { text: string; value: number };
}

/** Roles whose slot becomes an output field. Chrome is dropped. */
const KEPT: SlotRole[] = ['name', 'order_code', 'description', 'spec', 'price', 'availability', 'category', 'other'];
/** Identity priority. A spec value that happens to be unique on one page is not an identity. */
const IDENTITY_ORDER: SlotRole[] = ['order_code', 'name'];

/** "1–50 of 3,823" -> 3823. "Treffer: 97" -> 97. Separators are dropped: counts are whole numbers. */
export function parseTotal(text: string): number | undefined {
  const NUM = String.raw`\d{1,3}(?:[.,\u202f\u00a0' ]\d{3})+(?!\d)|\d+`;
  const num = (s: string) => Number(s.replace(/[.,\u202f\u00a0\s']/g, '')) || undefined;
  const of = new RegExp(String.raw`(?:of|von|de|di|aus|sur|/)\s*(${NUM})`, 'i').exec(text);
  if (of) return num(of[1]!);
  const first = new RegExp(NUM).exec(text);
  return first ? num(first[0]) : undefined;
}

export function buildRecipe(
  pageItems: PageItems,
  al: Alignment,
  asked: string[],
  answers: Record<string, any>,
): ListingRecipe {
  const fields: Field[] = [];
  const dropped: ListingRecipe['dropped'] = [];
  const used = new Map<string, number>();
  const specCount = { n: 0 };
  asked.forEach((key, i) => {
    const a = answers[`role_${i}`];
    const role = (a?.choice ?? 'other') as SlotRole;
    const slot = al.slots.find((s) => s.key === key)!;
    if (!KEPT.includes(role)) {
      dropped.push({ key, role, samples: slot.samples.slice(0, 3) });
      return;
    }
    // Keep the page's own label as written ("D" and "d" are different dimensions); roles name the rest.
    let base = slot.label ? slot.label : role === 'spec' || role === 'other' ? `${role}_${++specCount.n}` : role;
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    if (n > 1) base = `${base}_${n}`;
    fields.push({ key, name: base, role, confidence: Number(a?.confidence ?? 0), coverage: slot.coverage });
  });

  const unique = (f: Field) => {
    const s = al.slots.find((x) => x.key === f.key)!;
    return s.coverage === 1 && s.distinct === 1;
  };
  let identity: string | undefined;
  for (const role of IDENTITY_ORDER) {
    const f = fields.find((x) => x.role === role && unique(x));
    if (f) { identity = f.name; break; }
  }
  const linkPos = ownLinkPosition(pageItems.items);
  if (!identity && linkPos !== undefined) {
    const links = pageItems.items.map((i) => i.links[linkPos]);
    if (links.every(Boolean) && new Set(links).size === links.length) identity = '_url';
  }

  const { total, pages } = pickCounts(pageItems.count_texts, answers, pageItems.items.length);

  return {
    version: 1,
    source_url: pageItems.url,
    item_signature: pageItems.item_signature,
    container_signature: pageItems.container_signature,
    pairs: al.pairs,
    ...(linkPos !== undefined ? { own_link_position: linkPos } : {}),
    fields,
    dropped,
    ...(identity ? { identity } : {}),
    ...(total ? { total } : {}),
    ...(pages ? { pages } : {}),
  };
}

/**
 * Jev says what each count text states; code picks. A product count beats a search-result count,
 * the most confident wins, and a total smaller than the rows already on screen is impossible.
 */
export function pickCounts(texts: string[], answers: Record<string, any>, rowsShown: number) {
  const judged = texts.map((text, i) => {
    const pr = answers[`count_${i}`]?.probabilities ?? { [answers[`count_${i}`]?.choice]: answers[`count_${i}`]?.confidence };
    return { text, product: Number(pr.product_count ?? 0), result: Number(pr.result_count ?? 0), pages: Number(pr.page_count ?? 0), value: parseTotal(text) };
  }).filter((c) => c.value !== undefined);
  // "1728 found" splits between product and result count; together they say "this counts the list".
  const lists = judged.filter((c) => c.product + c.result >= LISTING_THRESHOLDS.count && c.value! >= rowsShown)
    .sort((a, b) => b.product - a.product || b.product + b.result - (a.product + a.result));
  const top = lists[0];
  let t: { text: string; value?: number; kind: string } | undefined = top && { text: top.text, value: top.value, kind: top.product >= top.result ? 'product_count' : 'result_count' };
  const p = judged.filter((c) => c.pages >= LISTING_THRESHOLDS.count).sort((a, b) => b.pages - a.pages)[0];
  // A bare "49 / 2960" whose first number is the rows on screen is a progress indicator.
  if (!t) {
    for (const text of texts) {
      const m = /^\s*(\d+)\s*\/\s*(\d[\d.,]*)\s*$/.exec(text);
      const value = m ? parseTotal(text) : undefined;
      if (m && Number(m[1]) === rowsShown && value && value >= rowsShown) { t = { text, value, kind: 'product_count' }; break; }
    }
  }
  return {
    total: t ? { text: t.text, value: t.value!, kind: t.kind as 'product_count' | 'result_count' } : undefined,
    pages: p ? { text: p.text, value: p.value! } : undefined,
  };
}

export type Row = Record<string, string>;

/** Apply a recipe to items read from any page built from the same template. */
export function applyRecipe(recipe: ListingRecipe, items: RawItem[]): Row[] {
  const al = alignSlots(items, recipe.pairs);
  return al.rows.map((r, i) => {
    const row: Row = {};
    for (const f of recipe.fields) if (r[f.key] !== undefined) row[f.name] = r[f.key]!;
    const it = items[i]!;
    const link = recipe.own_link_position !== undefined ? it.links[recipe.own_link_position] : undefined;
    if (link) row._url = link;
    if (it.image) row._image = it.image;
    return row;
  });
}

/** Share of recipe fields found in these items; used to decide whether a recipe fits a page. */
export function recipeFit(recipe: ListingRecipe, items: RawItem[]): number {
  if (!recipe.fields.length || !items.length) return 0;
  const al = alignSlots(items, recipe.pairs);
  const keys = new Set(al.slots.filter((s) => s.coverage >= 0.5).map((s) => s.key));
  const core = recipe.fields.filter((f) => f.coverage >= 0.5);
  if (!core.length) return 0;
  return core.filter((f) => keys.has(f.key)).length / core.length;
}

export interface ListingCheck {
  rows: number;
  identity?: string;
  identity_unique_pct?: number;
  field_coverage: Record<string, number>;
  advertised_total?: number;
  advertised_pages?: number;
  containers?: number;
  rows_merged?: number;
}

export function checkRows(recipe: ListingRecipe, rows: Row[]): ListingCheck {
  const field_coverage: Record<string, number> = {};
  for (const f of recipe.fields) field_coverage[f.name] = Math.round((100 * rows.filter((r) => r[f.name]).length) / Math.max(1, rows.length));
  const out: ListingCheck = { rows: rows.length, field_coverage };
  if (recipe.identity) {
    const ids = rows.map((r) => r[recipe.identity!]).filter(Boolean);
    out.identity = recipe.identity;
    out.identity_unique_pct = Math.round((100 * new Set(ids).size) / Math.max(1, rows.length));
  }
  if (recipe.total) out.advertised_total = recipe.total.value;
  if (recipe.pages) out.advertised_pages = recipe.pages.value;
  return out;
}

// ---------- One page, end to end ----------

export interface Listing {
  recipe: ListingRecipe;
  rows: Row[];
  check: ListingCheck;
  reused_recipe: boolean;
}

/** Well-filled slots on these items that the recipe has never seen (neither kept nor dropped). */
export function unknownSlots(recipe: ListingRecipe, items: RawItem[]): string[] {
  const known = new Set([...recipe.fields.map((f) => f.key), ...recipe.dropped.map((d) => d.key)]);
  return alignSlots(items, recipe.pairs).slots.filter((s) => s.coverage >= 0.5 && !known.has(s.key)).map((s) => s.key);
}

/**
 * Recipes by template, so sibling pages rendered from one template cost no Jev call. A recipe is
 * reused only if it fits and the new page has no column it has not judged; otherwise those columns
 * would be dropped silently.
 */
export class RecipeMemo {
  private recipes: ListingRecipe[] = [];
  find(items: PageItems): ListingRecipe | undefined {
    return this.recipes.find((r) => r.item_signature === items.item_signature && r.container_signature === items.container_signature &&
      recipeFit(r, items.items) >= 0.8 && unknownSlots(r, items.items).length === 0);
  }
  add(r: ListingRecipe) { this.recipes.push(r); }
}

/**
 * Build (or reuse) the recipe for the main group on a loaded, snapshotted page, then read every list
 * on the page built from the same template (Elesa splits one variant table into several tables).
 */
export async function extractListing(
  page: Page,
  judge: Judge,
  groupId: string,
  context: { title: string; heading?: string },
  memo?: RecipeMemo,
): Promise<Listing> {
  const first = await readItems(page, { group: groupId });
  const all = await readItems(page, { itemSignature: first.item_signature, containerSignature: first.container_signature });
  // Merge only same-template lists that the recipe fits; otherwise stay with the tagged group.
  let recipe = memo?.find(first);
  const reused = !!recipe;
  if (!recipe) {
    let al = alignSlots(first.items);
    if (Object.keys(al.pairs).length) {
      const pr = pairRequest(al);
      const pairAnswers = await judge.ask('listing-pairs', { list: { heading: context.heading ?? '', example_items: al.rows.slice(0, 3) } }, pr.questions);
      al = alignSlots(first.items, acceptedPairs(al, pr.keys, pairAnswers));
    }
    const req = listingRequest(first, al, context);
    const answers = await judge.ask('listing', req.state, req.questions);
    recipe = buildRecipe(first, al, req.asked, answers);
    memo?.add(recipe);
  }
  const source = all.items.length > first.items.length && recipeFit(recipe, all.items) >= 0.8 ? all.items : first.items;
  const raw = applyRecipe(recipe, source);
  const rows = mergeByIdentity(raw, recipe.identity);
  const check = checkRows(recipe, rows);
  return { recipe, rows, check: { ...check, containers: source === all.items ? all.containers : first.containers, rows_merged: raw.length - rows.length }, reused_recipe: reused };
}

/**
 * Rows with the same identity are one product seen twice, e.g. a fixed-column clone of a table that
 * repeats only the code column. Merge their fields; the first non-empty value wins.
 */
export function mergeByIdentity(rows: Row[], identity?: string): Row[] {
  if (!identity) return rows;
  const byId = new Map<string, Row>();
  const out: Row[] = [];
  for (const r of rows) {
    const id = r[identity];
    if (!id) { out.push(r); continue; }
    const prev = byId.get(id);
    if (!prev) { const copy = { ...r }; byId.set(id, copy); out.push(copy); continue; }
    for (const [k, v] of Object.entries(r)) if (!prev[k]) prev[k] = v;
  }
  return out;
}
