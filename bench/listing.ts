// Stage 3 bench: judge each leaf list, build its listing recipe, and extract the first page of rows.
// usage: npx tsx bench/listing.ts [seed-id]
import { mkdirSync, writeFileSync } from 'node:fs';
import { assessPage } from '../src/assess.js';
import { open } from '../src/browser.js';
import { createJudge } from '../src/jev.js';
import { extractListing } from '../src/listing.js';

const SEEDS: { id: string; url: string }[] = [
  { id: 'deublin-selektor', url: 'https://www.deublin.com/de/produkt-selektor' },
  { id: 'wago-search-221', url: 'https://www.wago.com/global/search?text=221%20ex' },
  { id: 'posital-inclinometers', url: 'https://www.posital.com/en/products/inclinometers/search' },
  { id: 'ifm-inductive', url: 'https://www.ifm.com/de/en/category/200_010_010' },
  { id: 'ifm-search-de', url: 'https://www.ifm.com/de/de/search?q=inductive%20sensor' },
  { id: 'pepperl-inductive-de', url: 'https://www.pepperl-fuchs.com/de-de/products-gp25581?class=30734' },
  { id: 'elesa-vb839b', url: 'https://www.elesa-ganter.com/en/www/clamping-knobs--three-arm-knobs--vbv839-b' },
  { id: 'elesa-vtt-sst-vd', url: 'https://www.elesa-ganter.com/en/www/clamping-knobs--solid-lobe-knobs--vtt-sst-vd' },
];
const only = process.argv[2];
const runDir = `artifacts/listing-bench/${new Date().toISOString().replace(/[:.]/g, '-')}`;
const lines: string[] = [];
for (const seed of SEEDS.filter((s) => !only || s.id === only)) {
  const dir = `${runDir}/${seed.id}`;
  mkdirSync(dir, { recursive: true });
  const judge = createJudge();
  const started = performance.now();
  const s = await open(seed.url);
  try {
    const a = await assessPage(s.page, s.context, judge, { gates: true });
    await s.page.screenshot({ path: `${dir}/page.png`, fullPage: false });
    if (a.next !== 'extract' || !a.main_group) {
      lines.push(`| ${seed.id} | ${a.next} | | | | | | | |`);
      continue;
    }
    const l = await extractListing(s.page, judge, a.main_group.id, { title: a.title, heading: a.main_group.heading });
    writeFileSync(`${dir}/recipe.json`, JSON.stringify(l.recipe, null, 2));
    writeFileSync(`${dir}/rows.json`, JSON.stringify(l.rows, null, 2));
    writeFileSync(`${dir}/check.json`, JSON.stringify(l.check, null, 2));
    const secs = Math.round((performance.now() - started) / 1000);
    const fields = l.recipe.fields.map((f) => `${f.name}(${l.check.field_coverage[f.name]}%)`).join(', ');
    const dropped = l.recipe.dropped.map((d) => `${d.role}:"${d.samples[0]?.slice(0, 20)}"`).join(', ');
    lines.push(`| ${seed.id} | extract | ${l.check.rows} (${l.check.containers} lists) | ${l.recipe.total ? `${l.recipe.total.value} ("${l.recipe.total.text}")` : ''}${l.recipe.pages ? `, ${l.recipe.pages.value} pages` : ''} | ${l.check.identity ?? ''} ${l.check.identity_unique_pct ?? ''}% | ${fields} | ${dropped} | ${judge.trace.length} | ${secs} s |`);
  } catch (e) {
    lines.push(`| ${seed.id} | error: ${String(e).slice(0, 100)} | | | | | | | |`);
  } finally {
    writeFileSync(`${dir}/trace.json`, JSON.stringify(judge.trace, null, 2));
    await s.browser.close();
  }
  console.log(lines.at(-1));
}
const md = ['# Listing bench', '', '| seed | action | rows | advertised total | identity, unique | fields (coverage) | dropped as | Jev calls | time |', '|---|---|---|---|---|---|---|---|---|', ...lines].join('\n');
writeFileSync(`${runDir}/summary.md`, md + '\n');
console.log(`\n${md}\n\n${runDir}`);
