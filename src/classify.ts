import { choice, noul } from '@typesafe-ai/sdk';
import { ITEM_PAGE_KINDS, type ItemPageKind } from './probe.js';
import type { Control, Group, Snapshot } from './types.js';

export const PAGE_KINDS = {
  product_listing:
    'The main content lists individual products. Each entry is one specific product with its own name, model or article number, and does not open a further list of products.',
  family_listing:
    'The main content lists product families or series. Each entry groups several models or variants and opens a further list, table or configurator of products.',
  category_hub:
    'The main content is a set of product categories or product areas that lead to deeper category pages rather than to specific products.',
  finder_needs_input:
    'The page is a product finder, selector, configurator or search that shows no products until the visitor selects filters or enters a query.',
  product_detail: 'The page describes one single product or one product series in detail.',
  document_catalogue: 'The catalogue is offered as a PDF, flipbook or document download rather than as a web list of products.',
  error_or_blocked: 'The page shows an error, access denial, bot check, or a message that no products or results were found.',
  not_catalogue: 'The page is not a product catalogue page, for example a home page, news, careers or corporate content.',
} as const;

export const ITEM_KINDS = {
  individual_product: 'One specific product with its own name, model or article number that does not expand into further products.',
  product_family: 'A product family, series or product line that contains several models or variants.',
  product_category: 'A product category or product area that leads to more categories or families.',
  filter_option: 'A filter, facet, sort or search option.',
  navigation: 'A site menu, breadcrumb, footer or language link.',
  content: 'News, articles, events, marketing teasers, services or company information.',
  document: 'A document, datasheet, brochure or download.',
  other: 'Something else.',
} as const;

export type PageKind = keyof typeof PAGE_KINDS;
export type ItemKind = keyof typeof ITEM_KINDS;
export const MAX_CLASSIFIED_GROUPS = 6;
const MAX_VIEW_ALL_OFFERED = 40;

export function candidateGroups(snap: Snapshot): Group[] {
  return snap.groups.filter((g) => !g.in_overlay).slice(0, MAX_CLASSIFIED_GROUPS);
}

/** Links in the page body that could open a complete product list. Menus and footers are excluded. */
export function viewAllCandidates(snap: Snapshot): Control[] {
  return snap.controls
    .filter((c) => c.role === 'link' && c.href && !c.in_overlay && !['nav', 'header', 'footer'].includes(c.region) && c.label.length <= 60)
    .slice(0, MAX_VIEW_ALL_OFFERED);
}

export function classifyRequest(snap: Snapshot) {
  const groups = candidateGroups(snap);
  const viewAll = viewAllCandidates(snap);
  const state = {
    page: { url: snap.url, title: snap.title, lang: snap.lang },
    headings: snap.headings,
    text_start: snap.text.slice(0, 2500),
    embedded_frames: (snap.frames ?? []).map((f) => ({ text: f.text.slice(0, 1200) })),
    repeated_groups: groups.map(({ id, item_count, region, heading, samples }) => ({ id, item_count, region, heading, samples })),
  };
  const mainCriteria: Record<string, string> = {};
  for (const g of groups) mainCriteria[g.id] = `Group ${g.id}: ${g.item_count} items under "${g.heading}", e.g. "${g.samples[0] ?? ''}"`;
  mainCriteria.none = 'No listed group is the main list of products, families or categories.';
  const viewAllCriteria: Record<string, unknown> = {};
  for (const c of viewAll) viewAllCriteria[c.id] = { link_text: c.label, path: c.href };
  viewAllCriteria.none = 'No listed link does this.';

  const questions: Record<string, ReturnType<typeof choice> | ReturnType<typeof noul>> = {
    needs_input: noul('Does the page ask the visitor to make a selection, set filters or enter a query before any products are shown?'),
    page_kind: choice('What kind of page is this, judged by its main content?', PAGE_KINDS as any),
    main_group: choice(
      'Which repeated group in `repeated_groups` is the main content list of products, product families or product categories? Ignore menus, filters, footers, teasers, related products and accessories.',
      mainCriteria as any,
    ),
    // The same questions a probe asks about an item page, asked about this page (speculative fan-out).
    self_kind: choice('What is this page about?', ITEM_PAGE_KINDS as any),
    self_one_exact_code: noul(
      'Does the page identify the product shown by exactly one complete article number or order code, for example "Item no. 221-413"?',
    ),
    self_configurator: noul(
      'Does the page let the visitor choose product options, such as a configurator, option dropdowns or selectable sizes, variants or versions, before ordering or requesting a quote?',
    ),
    view_all: choice(
      'Which link opens one complete list of all products of the category or product line shown on this page, for example "View all", "All products" or "Show all 245 products"? A link to a single subcategory, product, document or other page is not such a link.',
      viewAllCriteria as any,
    ),
  };
  for (const g of groups) {
    questions[`related_${g.id}`] = noul({
      group: { heading: g.heading, samples: g.samples },
      question: 'Is `group` presented as related, recommended, similar or accessory products, for example under "You might also like" or "Könnte Sie interessieren"?',
    });
    questions[`item_kind_${g.id}`] = choice(
      {
        group: { item_count: g.item_count, region: g.region, heading: g.heading, samples: g.samples },
        question: 'What is each item in `group`? Judge from the sample items.',
      },
      ITEM_KINDS as any,
    );
  }
  return { state, questions, groups: groups.map((g) => g.id), viewAll: viewAll.map((c) => c.id) };
}

export interface Judged<T extends string> {
  choice: T;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface PageAssessment {
  page_kind: Judged<PageKind>;
  main_group: Judged<string>;
  item_kinds: Record<string, Judged<ItemKind>>;
  /** Probability per group that it is a related/recommended carousel rather than the page's own list. */
  related: Record<string, number>;
  needs_input: number;
  self: { kind: Judged<ItemPageKind>; one_exact_code: number; configurator: number };
  view_all: Judged<string>;
}

const pick = <T extends string>(a: any): Judged<T> => ({
  choice: (a?.choice ?? 'none') as T,
  confidence: Number(a?.confidence ?? 0),
  probabilities: a?.probabilities ?? {},
});

export function interpretClassification(groupIds: string[], answers: any): PageAssessment {
  const item_kinds: Record<string, Judged<ItemKind>> = {};
  const related: Record<string, number> = {};
  for (const id of groupIds) {
    if (answers[`item_kind_${id}`]) item_kinds[id] = pick<ItemKind>(answers[`item_kind_${id}`]);
    related[id] = Number(answers[`related_${id}`]?.noul ?? 0);
  }
  return {
    related,
    page_kind: pick<PageKind>(answers.page_kind),
    main_group: pick<string>(answers.main_group),
    item_kinds,
    needs_input: Number(answers.needs_input?.noul ?? 0),
    self: {
      kind: pick<ItemPageKind>(answers.self_kind),
      one_exact_code: Number(answers.self_one_exact_code?.noul ?? 0),
      configurator: Number(answers.self_configurator?.noul ?? 0),
    },
    view_all: pick<string>(answers.view_all),
  };
}

export type NextAction = 'extract' | 'expand_items' | 'product_page' | 'configurable_family' | 'series_page' | 'needs_input' | 'stop';

export const THRESHOLDS = {
  needsInput: 0.6,
  configurator: 0.6,
  exactCode: 0.5,
  productPage: 0.8,
  viewAll: 0.7,
  related: 0.6,
  selfAboutOne: 0.9,
};

/** The listed item kind of the main group, if a main group was chosen. */
/** The page is about one product or one series (its lists are variants or carousels, never children). */
export function isDetailLike(a: PageAssessment): boolean {
  const selfAboutOne = ['single_product', 'series_with_variants'].includes(a.self.kind.choice) && a.self.kind.confidence >= THRESHOLDS.selfAboutOne;
  return a.page_kind.choice === 'product_detail' || selfAboutOne;
}

/**
 * Related-product carousels are ignored on detail-like pages only. On a listing page titled
 * "Recommended products" (Misumi) the recommended list is the main content.
 */
export function listedMainItems(a: PageAssessment): ItemKind | undefined {
  const g = a.main_group.choice;
  if (g === 'none') return undefined;
  if (isDetailLike(a) && (a.related[g] ?? 0) >= THRESHOLDS.related) return undefined;
  return a.item_kinds[g]?.choice;
}

/**
 * Code, not the model, turns judgments into a crawl action. `mainItems` is the main group's item
 * kind after probing item pages (probes override the listing card judgment).
 */
export function decideNext(a: PageAssessment, mainItems: string | undefined): NextAction {
  const selfConfigurable = a.self.configurator >= THRESHOLDS.configurator && a.self.one_exact_code < THRESHOLDS.exactCode;
  if (isDetailLike(a)) {
    // A page about one product or one series is terminal. Never expand from it: its only lists are
    // variants (extract) or carousels of other products (ignore). A listed variant table beats a
    // configurator, because its rows are the non-expandable products.
    if (mainItems === 'individual_product') return 'extract';
    if (selfConfigurable) return 'configurable_family';
    if (a.self.kind.choice === 'single_product') return 'product_page';
    if (a.self.kind.choice === 'series_with_variants') return 'series_page';
    return 'product_page';
  }
  if (mainItems === 'individual_product') return 'extract';
  if (mainItems === 'product_family' || mainItems === 'product_category') return 'expand_items';
  if (a.needs_input >= THRESHOLDS.needsInput) return 'needs_input';
  return 'stop';
}
