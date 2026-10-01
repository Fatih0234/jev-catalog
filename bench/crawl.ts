// Crawl several seeds with a small page budget and summarize where each branch ended.
// usage: npx tsx bench/crawl.ts [maxPages] [seed-id]
import { mkdirSync, writeFileSync } from 'node:fs';
import { crawl, renderTree } from '../src/crawl.js';
import { createJudge } from '../src/jev.js';

const SEEDS: { id: string; url: string; expect: string }[] = [
  { id: 'pedrollo', url: 'https://www.pedrollo.com/de/categoria-prodotto/trocken-aufgestellte-pumpen/peripheralrad-pumpen/', expect: 'families resolve to series or product pages; no drift into other categories' },
  { id: 'vega-radar', url: 'https://www.vega.com/de-de/produkte/produktkatalog/fuellstand/radar', expect: 'families resolve to configurable families' },
  { id: 'elesa-knobs', url: 'https://www.elesa-ganter.com/en/www/clamping-knobs--1', expect: 'families resolve to variant lists or configurable families' },
  { id: 'novotechnik-linear', url: 'https://www.novotechnik.de/en/product-category/position-sensors/linear-position-transducers/', expect: 'series cards expand to series pages or variant lists' },
  { id: 'ifm-hub', url: 'https://www.ifm.com/de/en/category', expect: 'hub descends to a leaf product list (e.g. inductive sensors), ideally via view all' },
  { id: 'kennametal-cutoff', url: 'https://www.kennametal.com/dk/en/products/metalworking-tools/turning/grooving-and-cut-off/cut-off.html', expect: 'mixed page descends to product lists' },
];
const maxPages = Number(process.argv[2] ?? 15);
const only = process.argv[3];
const runDir = `artifacts/crawl-bench/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(runDir, { recursive: true });
const rows: string[] = [];
for (const seed of SEEDS.filter((s) => !only || s.id === only)) {
  const judge = createJudge();
  try {
    const r = await crawl(seed.url, judge, { maxPages, outDir: `${runDir}/${seed.id}`, log: (l) => console.log(`[${seed.id}] ${l}`) });
    rows.push(`| ${seed.id} | ${r.nodes.length} | ${r.leaf_lists.length} | ${r.product_pages.length} | ${r.configurable_families.length} | ${r.series_pages.length} | ${r.needs_input.length} | ${r.stopped.length} | ${r.unvisited} | ${r.rows_extracted} | ${r.jev_calls} | ${Math.round(r.elapsed_ms / 1000)} s | ${seed.expect} |`);
    writeFileSync(`${runDir}/${seed.id}.md`, renderTree(r));
  } catch (e) {
    rows.push(`| ${seed.id} | error: ${String(e).slice(0, 80)} |`);
  }
}
const md = [
  `# Crawl bench (max ${maxPages} pages per seed)`,
  '',
  '| seed | pages | product lists | product pages | configurable families | series pages | needs input | stop/error | queued | rows read | Jev calls | time | expectation |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows,
].join('\n');
writeFileSync(`${runDir}/summary.md`, md + '\n');
console.log(`\n${md}\n\n${runDir}`);
