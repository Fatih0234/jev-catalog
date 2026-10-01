import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessPage, ProbeMemo, type Assessment } from './assess.js';
import { open, settle } from './browser.js';
import type { NextAction } from './classify.js';
import { siteKey } from './gate.js';
import type { Judge } from './jev.js';
import { extractListing, RecipeMemo } from './listing.js';
import { paginate, type PagingResult } from './paging.js';

export interface CrawlOptions {
  /** Hard cap on pages judged (probe pages not counted). */
  maxPages?: number;
  maxDepth?: number;
  /** Children enqueued per expanded page; the rest are recorded as truncated. */
  maxChildren?: number;
  outDir?: string;
  /** Read rows from every product list reached. Default true. */
  extract?: boolean;
  /** Pages read per list, including the first. 1 disables paging. Default 50. */
  maxListPages?: number;
  log?: (line: string) => void;
}

export interface NodeListing {
  rows: number;
  identity?: string;
  identity_unique_pct?: number;
  fields: string[];
  advertised_total?: number;
  advertised_pages?: number;
  reused_recipe: boolean;
  rows_file?: string;
  paging?: { mechanism: string; pages: number; stop: PagingResult['stop']; completeness_pct?: number; failed_pages: number[]; repeated_rows: number };
}

export interface CrawlNode {
  id: number;
  url: string;
  final_url?: string;
  title?: string;
  depth: number;
  parent?: number;
  /** How this page was reached. */
  via: 'seed' | 'item' | 'view_all' | 'fallback_item';
  next?: NextAction;
  listed_items?: string;
  main_items?: string;
  item_count?: number;
  probes?: string[];
  probes_skipped_by_memo?: boolean;
  view_all?: Assessment['view_all'];
  children_enqueued?: number;
  children_truncated?: number;
  sample_items?: string[];
  listing?: NodeListing;
  listing_error?: string;
  error?: string;
}

export interface CrawlResult {
  seed: string;
  nodes: CrawlNode[];
  leaf_lists: CrawlNode[];
  product_pages: CrawlNode[];
  configurable_families: CrawlNode[];
  series_pages: CrawlNode[];
  needs_input: CrawlNode[];
  stopped: CrawlNode[];
  /** Rows read from product lists (first pages) and the totals those lists advertise. */
  rows_extracted: number;
  rows_advertised: number;
  unvisited: number;
  jev_calls: number;
  jev_input_tokens: number;
  elapsed_ms: number;
}

/** Normalize for deduplication: drop the fragment, keep the query (search and filter state live there). */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  return u.href;
}

interface Pending {
  url: string;
  depth: number;
  parent?: number;
  via: CrawlNode['via'];
  /** For view-all pages: children to crawl if the view-all page turns out not to be a product list. */
  fallback?: string[];
}

/** Children of an expanded page: distinct same-site item links of its main group. */
export function childLinks(a: Pick<Assessment, 'main_group' | 'url'>, seedSite: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of a.main_group?.item_links ?? []) {
    if (!raw) continue;
    let href: string;
    try {
      href = normalizeUrl(raw);
    } catch {
      continue;
    }
    if (href === normalizeUrl(a.url) || seen.has(href) || siteKey(href) !== seedSite) continue;
    seen.add(href);
    out.push(href);
  }
  return out;
}

/**
 * Breadth-first crawl from a seed until every branch reaches a product list, a product page,
 * a configurable family, a finder that needs input, or a dead end.
 */
export async function crawl(seed: string, judge: Judge, opts: CrawlOptions = {}): Promise<CrawlResult> {
  const maxPages = opts.maxPages ?? 40;
  const maxDepth = opts.maxDepth ?? 4;
  const maxChildren = opts.maxChildren ?? 25;
  const log = opts.log ?? (() => {});
  const started = performance.now();
  const callsBefore = judge.trace.length;

  const session = await open(seed);
  const seedSite = siteKey(session.page.url());
  const memo = new ProbeMemo();
  const recipes = new RecipeMemo();
  const nodes: CrawlNode[] = [];
  const queue: Pending[] = [{ url: normalizeUrl(seed), depth: 0, via: 'seed' }];
  const visited = new Set<string>();
  let first = true;

  try {
    while (queue.length && nodes.length < maxPages) {
      const item = queue.shift()!;
      if (visited.has(item.url)) continue;
      visited.add(item.url);
      const node: CrawlNode = { id: nodes.length, url: item.url, depth: item.depth, parent: item.parent, via: item.via };
      nodes.push(node);
      try {
        if (!first) {
          await session.page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
          await settle(session.page);
        }
        const parentUrl = item.parent !== undefined ? nodes[item.parent]!.url : undefined;
        const a = await assessPage(session.page, session.context, judge, { gates: first, memo, parentUrl });
        first = false;
        visited.add(normalizeUrl(a.url));
        Object.assign(node, {
          final_url: a.url,
          title: a.title,
          next: a.next,
          listed_items: a.listed_items,
          main_items: a.main_items,
          item_count: a.main_group?.item_count,
          probes: a.probes.map((p) => `${p.kind ?? 'error'} ${p.confidence?.toFixed(2) ?? ''}`),
          probes_skipped_by_memo: a.probes_skipped_by_memo,
          view_all: a.view_all,
          sample_items: a.main_group?.samples.slice(0, 2).map((s) => s.slice(0, 90)),
        });

        if (a.next === 'extract' && a.main_group && !a.main_group.id.startsWith('f') && opts.extract !== false) {
          try {
            const l = await extractListing(session.page, judge, a.main_group.id, { title: a.title, heading: a.main_group.heading }, recipes);
            const maxListPages = opts.maxListPages ?? 50;
            let rows = l.rows;
            let p: PagingResult | undefined;
            if (maxListPages > 1) {
              p = await paginate(session.page, judge, l.recipe, l.rows, { title: a.title, heading: a.main_group.heading }, { maxPages: maxListPages, log: (x) => log(`   ${x}`) });
              rows = p.rows;
            }
            let rows_file: string | undefined;
            if (opts.outDir) {
              mkdirSync(join(opts.outDir, 'lists'), { recursive: true });
              rows_file = join('lists', `${node.id}.json`);
              writeFileSync(join(opts.outDir, rows_file), JSON.stringify({ url: a.url, recipe: l.recipe, check: l.check, paging: p && { ...p, rows: undefined }, rows }, null, 2));
            }
            node.listing = {
              rows: rows.length,
              identity: l.check.identity,
              identity_unique_pct: l.check.identity_unique_pct,
              fields: l.recipe.fields.map((f) => f.name),
              advertised_total: l.check.advertised_total,
              advertised_pages: l.check.advertised_pages,
              reused_recipe: l.reused_recipe,
              rows_file,
              ...(p ? { paging: { mechanism: p.mechanism?.kind ?? 'none', pages: p.pages, stop: p.stop, completeness_pct: p.completeness_pct, failed_pages: p.failed_pages, repeated_rows: p.repeated_rows } } : {}),
            };
          } catch (e) {
            node.listing_error = String(e).slice(0, 200);
          }
        }

        const enqueue = (urls: string[], via: Pending['via']) => {
          const fresh = urls.filter((u) => !visited.has(u) && !queue.some((q) => q.url === u));
          const kept = item.depth + 1 <= maxDepth ? fresh.slice(0, maxChildren) : [];
          node.children_enqueued = (node.children_enqueued ?? 0) + kept.length;
          node.children_truncated = (node.children_truncated ?? 0) + fresh.length - kept.length;
          for (const url of kept) queue.push({ url, depth: item.depth + 1, parent: node.id, via });
        };

        if (item.via === 'view_all' && a.next !== 'extract' && item.fallback) {
          // The shortcut did not lead to a product list: crawl the original children instead.
          enqueue(item.fallback, 'fallback_item');
        }
        if (a.next === 'expand_items') {
          const children = childLinks(a, seedSite);
          const viewAll = a.view_all && siteKey(a.view_all.href) === seedSite ? normalizeUrl(a.view_all.href) : undefined;
          if (viewAll && !visited.has(viewAll)) {
            // Try the "view all" list first; its children are the fallback.
            queue.unshift({ url: viewAll, depth: item.depth + 1, parent: node.id, via: 'view_all', fallback: children });
            node.children_enqueued = 1;
          } else {
            enqueue(children, 'item');
          }
        }
        log(`#${node.id} d${node.depth} ${node.next?.padEnd(19)} ${(node.main_items ?? '').padEnd(18)} ${node.title?.slice(0, 50)} ${node.view_all ? `[view all: ${node.view_all.label}]` : ''} ${node.children_enqueued ? `+${node.children_enqueued}` : ''}${node.children_truncated ? ` (${node.children_truncated} truncated)` : ''}`);
      } catch (e) {
        node.error = String(e).slice(0, 200);
        log(`#${node.id} error ${node.error}`);
      }
    }
  } finally {
    await session.browser.close();
  }

  const calls = judge.trace.slice(callsBefore);
  const by = (n: NextAction) => nodes.filter((x) => x.next === n);
  const result: CrawlResult = {
    seed,
    nodes,
    leaf_lists: by('extract'),
    product_pages: by('product_page'),
    configurable_families: by('configurable_family'),
    series_pages: by('series_page'),
    needs_input: by('needs_input'),
    stopped: nodes.filter((x) => x.next === 'stop' || x.error),
    rows_extracted: nodes.reduce((n, x) => n + (x.listing?.rows ?? 0), 0),
    rows_advertised: nodes.reduce((n, x) => n + (x.listing?.advertised_total ?? 0), 0),
    unvisited: queue.length,
    jev_calls: calls.length,
    jev_input_tokens: calls.reduce((n, c) => n + c.input_tokens, 0),
    elapsed_ms: Math.round(performance.now() - started),
  };
  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, 'crawl.json'), JSON.stringify(result, null, 2));
    writeFileSync(join(opts.outDir, 'trace.json'), JSON.stringify(calls, null, 2));
    writeFileSync(join(opts.outDir, 'tree.md'), renderTree(result));
  }
  return result;
}

export function renderTree(r: CrawlResult): string {
  const lines = [
    `# Crawl of ${r.seed}`,
    '',
    `Pages judged: ${r.nodes.length} · product lists: ${r.leaf_lists.length} · product pages: ${r.product_pages.length} · configurable families: ${r.configurable_families.length} · series pages (variants not listed): ${r.series_pages.length} · needs input: ${r.needs_input.length} · stopped/errors: ${r.stopped.length} · still queued: ${r.unvisited}`,
    `Rows read: ${r.rows_extracted}${r.rows_advertised ? ` · advertised by those lists: ${r.rows_advertised}` : ''}`,
    `Jev calls: ${r.jev_calls} · input tokens: ${r.jev_input_tokens} · time: ${Math.round(r.elapsed_ms / 1000)} s`,
    '',
    '```',
  ];
  const kids = new Map<number | undefined, CrawlNode[]>();
  for (const n of r.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const walk = (parent: number | undefined, indent: string) => {
    for (const n of kids.get(parent) ?? []) {
      const tag = n.error ? 'ERROR' : n.next;
      const via = n.via === 'seed' || n.via === 'item' ? '' : ` (${n.via})`;
      const items = n.item_count && n.main_items ? ` ${n.item_count}× ${n.main_items}` : '';
      const l = n.listing;
      const pg = l?.paging && l.paging.pages > 1 ? `, ${l.paging.pages} pages by ${l.paging.mechanism}, ${l.paging.stop}` : '';
      const rows = l ? ` [${l.rows} rows${l.advertised_total ? ` of ${l.advertised_total}` : ''}, id ${l.identity ?? 'none'}${l.reused_recipe ? ', recipe reused' : ''}${pg}]` : n.listing_error ? ' [listing error]' : '';
      const extra = (n.children_truncated ? ` +${n.children_truncated} not crawled` : '') + rows;
      lines.push(`${indent}${tag}${via}${items}  ${n.title?.slice(0, 60) ?? ''}  ${n.final_url ?? n.url}${extra}`);
      walk(n.id, indent + '  ');
    }
  };
  walk(undefined, '');
  lines.push('```', '');
  return lines.join('\n');
}
