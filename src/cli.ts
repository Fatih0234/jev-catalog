import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultHeadless } from './browser.js';
import { crawl, renderTree } from './crawl.js';
import { compileDetailRecipe } from './detail.js';
import { parseDetailListing, targetsFromListing } from './detail-policy.js';
import { createJudge } from './jev.js';
import { recon } from './recon.js';

const [command, url, outArg] = process.argv.slice(2);
if (!['recon', 'crawl', 'details'].includes(command ?? '') || !url) {
  console.error('usage: npm run recon -- <url> [out-dir]\n       npm run crawl -- <url> [out-dir] [maxPages] [maxListPages]\n       npm run details -- <listing.json> [out-dir]');
  process.exit(2);
}
if (command === 'crawl') {
  const out = outArg ?? `artifacts/crawl/${new URL(url).host}-${Date.now()}`;
  const maxPages = Number(process.argv[5] ?? 40);
  const maxListPages = Number(process.argv[6] ?? 50);
  const r = await crawl(url, createJudge(), { outDir: out, maxPages, maxListPages, log: (l) => console.log(l) });
  console.log(`\n${renderTree(r)}\nartifacts: ${out}`);
  process.exit(0);
}
if (command === 'details') {
  // Input is a saved crawl list file ({recipe, rows, ...}) validated before any browser or key
  // is touched. Selection diagnostics are persisted under the output dir first.
  const out = outArg ?? `artifacts/details/${Date.now()}`;
  let input: ReturnType<typeof parseDetailListing>;
  try {
    input = parseDetailListing(JSON.parse(readFileSync(url, 'utf8')));
  } catch (e) {
    console.error(`invalid listing input: ${e instanceof Error ? e.message : e}`);
    process.exit(2);
  }
  const selection = targetsFromListing(input.recipe, input.rows);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'inputs.json'), JSON.stringify({ listing: url, targets: selection.targets, issues: selection.issues }, null, 2));
  if (!selection.targets.length) {
    console.log(JSON.stringify({ error: 'no usable detail targets', issues: selection.issues, artifacts: out }, null, 2));
    process.exit(1);
  }
  let failed = true;
  const browser = await chromium.launch({ headless: defaultHeadless() });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    const r = await compileDetailRecipe(context, createJudge(), selection.targets, { outDir: out });
    const usable = r.samples.filter((s) => s.identity === 'matched' && ['ok', 'partial'].includes(s.status)).length;
    console.log(JSON.stringify({
      attempted: r.samples.length,
      usable,
      samples: r.samples.map((s) => `${s.status} ${s.identity} ${s.target.url}`),
      recipe_version: r.recipe.version,
      fields: r.recipe.fields.length,
      sections: r.recipe.version === 1 ? r.recipe.sections.length : r.recipe.regions.length,
      learning: r.recipe.version === 2 ? {
        state: r.recipe.learning.state,
        attempted: r.recipe.learning.attempted.length,
        verified: r.recipe.learning.verified.length,
        inspected: r.recipe.learning.inspected.length,
        unresolved: r.recipe.diagnostics.length,
      } : undefined,
      input_issues: selection.issues,
      issues: r.issues,
      artifacts: out,
    }, null, 2));
    failed = usable === 0;
  } finally {
    await browser.close();
  }
  process.exit(failed ? 1 : 0);
}
const out = outArg ?? 'artifacts/recon/latest';
const r = await recon(url, createJudge(), out);
console.log(JSON.stringify({
  final_url: r.final_url,
  gates: r.gates.map((g) => (g.decision.action === 'click' ? `${g.decision.role} "${g.decision.label}"` : g.decision.reason)),
  page_kind: `${r.judgment.page_kind.choice} (${r.judgment.page_kind.confidence.toFixed(2)})`,
  listed_items: r.listed_items,
  probes: r.probes.map((p) => `${p.kind ?? 'error'} ${p.confidence?.toFixed(2) ?? ''} ${p.url}`),
  main_items: r.main_items,
  next: r.next,
  view_all: r.view_all,
  jev_calls: r.jev_calls,
  tokens: r.jev_input_tokens,
  elapsed_ms: r.elapsed_ms,
  artifacts: out,
}, null, 2));
