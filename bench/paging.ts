// Stage 4 bench: judge each list, build its recipe, then page through it.
// usage: npx tsx bench/paging.ts [maxPages=4] [seed-id]
import { mkdirSync, writeFileSync } from 'node:fs';
import { assessPage } from '../src/assess.js';
import { open } from '../src/browser.js';
import { createJudge } from '../src/jev.js';
import { extractListing } from '../src/listing.js';
import { paginate } from '../src/paging.js';

const SEEDS: { id: string; url: string }[] = [
  { id: 'deublin-selektor', url: 'https://www.deublin.com/de/produkt-selektor' },
  { id: 'wago-search-221', url: 'https://www.wago.com/global/search?text=221%20ex' },
  { id: 'posital-inclinometers', url: 'https://www.posital.com/en/products/inclinometers/search' },
  { id: 'ifm-inductive', url: 'https://www.ifm.com/de/en/category/200_010_010' },
  { id: 'ifm-search-de', url: 'https://www.ifm.com/de/de/search?q=inductive%20sensor' },
  { id: 'pepperl-inductive-de', url: 'https://www.pepperl-fuchs.com/de-de/products-gp25581?class=30734' },
  { id: 'elesa-vb839b', url: 'https://www.elesa-ganter.com/en/www/clamping-knobs--three-arm-knobs--vbv839-b' },
];
const maxPages = Number(process.argv[2] ?? 4);
const only = process.argv[3];
const runDir = `artifacts/paging-bench/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const lines: string[] = [];
for (const seed of SEEDS.filter((s) => !only || s.id === only)) {
  const dir = `${runDir}/${seed.id}`;
  mkdirSync(dir, { recursive: true });
  const judge = createJudge();
  const started = performance.now();
  const s = await open(seed.url);
  try {
    const a = await assessPage(s.page, s.context, judge, { gates: true });
    if (a.next !== 'extract' || !a.main_group) { lines.push(`| ${seed.id} | ${a.next} |||||||`); continue; }
    const ctx = { title: a.title, heading: a.main_group.heading };
    const l = await extractListing(s.page, judge, a.main_group.id, ctx);
    const p = await paginate(s.page, judge, l.recipe, l.rows, ctx, { maxPages, log: (x) => console.log(`[${seed.id}] ${x}`) });
    writeFileSync(`${dir}/paging.json`, JSON.stringify({ ...p, rows: undefined, row_count: p.rows.length }, null, 2));
    writeFileSync(`${dir}/rows.json`, JSON.stringify(p.rows, null, 2));
    const secs = Math.round((performance.now() - started) / 1000);
    const mech = p.mechanism ? (p.mechanism.kind === 'url' ? `url (${p.mechanism.source}) ${p.mechanism.template.replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}` : p.mechanism.kind) : 'none';
    const tried = p.tried.map((t) => `${t.kind}${t.ok ? '✓' : '✗'}`).join(' ');
    lines.push(`| ${seed.id} | ${mech} | ${tried} | ${p.pages} | ${p.rows.length} | ${p.advertised_total ?? ''} | ${p.stop} | ${judge.trace.length} | ${secs} s |`);
  } catch (e) {
    lines.push(`| ${seed.id} | error: ${String(e).slice(0, 120)} |||||||`);
  } finally {
    writeFileSync(`${dir}/trace.json`, JSON.stringify(judge.trace, null, 2));
    await s.browser.close();
  }
  console.log(lines.at(-1));
}
const md = [`# Paging bench (max ${maxPages} pages)`, '', '| list | mechanism | tried | pages | rows | advertised | stop | Jev calls | time |', '|---|---|---|---|---|---|---|---|---|', ...lines].join('\n');
writeFileSync(`${runDir}/summary.md`, md + '\n');
console.log(`\n${md}\n\n${runDir}`);
