import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultHeadless } from '../src/browser.js';
import { compileDetailRecipe } from '../src/detail.js';
import { parseDetailListing, targetsFromListing } from '../src/detail-policy.js';
import { createJudge } from '../src/jev.js';

const [rowsPath, recipePath, output] = process.argv.slice(2);
if (!rowsPath || !recipePath) {
  console.error('usage: npx tsx bench/details.ts <rows.json> <recipe.json> [out-dir]');
  process.exit(2);
}
const { rows, recipe } = parseDetailListing({
  rows: JSON.parse(readFileSync(rowsPath, 'utf8')),
  recipe: JSON.parse(readFileSync(recipePath, 'utf8')),
});
const selection = targetsFromListing(recipe, rows);
const outDir = output ?? `artifacts/detail-bench/${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'inputs.json'), JSON.stringify({
  rows_file: rowsPath, recipe_file: recipePath, targets: selection.targets, issues: selection.issues,
}, null, 2));
if (!selection.targets.length) {
  console.log(JSON.stringify({ error: 'no usable detail targets', issues: selection.issues }, null, 2));
  process.exit(1);
}
const judge = createJudge();
const browser = await chromium.launch({ headless: defaultHeadless() });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  const result = await compileDetailRecipe(context, judge, selection.targets, { outDir });
  writeFileSync(join(outDir, 'compilation.json'), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, 'trace.json'), JSON.stringify(judge.trace, null, 2));
  await context.storageState({ path: join(outDir, 'browser-state.json') });
  const summary = [
    '# Detail discovery',
    '',
    'This run reads saved listing inputs. It does not rerun listing discovery or pagination.',
    '',
    '| URL | Identity | Status | Fields | Issues |',
    '| --- | --- | --- | --- | --- |',
    ...result.samples.map((sample) => `| ${sample.target.url} | ${sample.identity} | ${sample.status} | ${Object.keys(sample.values).length} | ${sample.issues.map((issue) => issue.reason).join(', ')} |`),
    '',
    `Jev requests recorded: ${judge.trace.length}.`,
    `Input issues: ${selection.issues.length}.`,
    'Identity matches do not prove that every specification was extracted.',
    '',
  ].join('\n');
  writeFileSync(join(outDir, 'summary.md'), summary);
  console.log(`${summary}\n${outDir}`);
} finally {
  await browser.close();
}
