// Scratch local runner for the stage 5 detail recipe. No TypeSafe key needed: the fixture site
// comes from test/helpers/detail-site.ts and Jev is replaced by its scripted stand-in. This is a
// local integration demo, not an evaluated benchmark.
//
//   npx tsx bench/detail-local.ts [out-dir]  compile on the fixture site, write artifacts
//   npx tsx bench/detail-local.ts --serve    only serve the fixture pages on localhost and stay up
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { compileDetailRecipe, readDetail } from '../src/detail.js';
import { detailTargets, DETAIL_CODES, scriptedDetailJudge, startDetailSite } from '../test/helpers/detail-site.js';

const serveOnly = process.argv.includes('--serve');
const outDir = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? 'artifacts/detail-local';
const site = await startDetailSite(0);
console.log(`fixture detail site: ${site.origin}  (pages: /a /b /c /d /e /f /g /h /list)`);
if (serveOnly) {
  console.log('serving for manual inspection; stop with ctrl-c');
} else {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
    const judge = scriptedDetailJudge();
    const compilation = await compileDetailRecipe(context, judge, detailTargets(site.origin), { outDir, pauseMs: 0 });
    const page = await context.newPage();
    const replayB = await readDetail(page, compilation.recipe, { url: `${site.origin}/b`, expected_code: DETAIL_CODES['/b'] });
    const replayD = await readDetail(page, compilation.recipe, { url: `${site.origin}/d`, expected_code: DETAIL_CODES['/d'] });
    writeFileSync(join(outDir, 'replay-b.json'), JSON.stringify(replayB, null, 2));
    writeFileSync(join(outDir, 'replay-d.json'), JSON.stringify(replayD, null, 2));
    console.log('samples:', compilation.samples.map((s) => `${s.status}/${s.identity} ${s.target.url}`).join('\n         '));
    console.log(`recipe v${compilation.recipe.version}: ${compilation.recipe.fields.length} fields, ${compilation.recipe.version === 1 ? compilation.recipe.sections.length : compilation.recipe.regions.length} sections/regions, ${compilation.recipe.reveals.length} reveals, ${compilation.recipe.templates?.length ?? 0} templates${compilation.recipe.version === 2 ? `, learning ${compilation.recipe.learning.state} (${compilation.recipe.learning.verified.length}/${compilation.recipe.learning.attempted.length} verified)` : ''}`);
    console.log(`replay /b: ${replayB.status} (${replayB.issues.map((i) => i.reason).join(', ') || 'no issues'})`);
    console.log(`replay /d: ${replayD.status} (${replayD.issues.map((i) => i.reason).join(', ') || 'no issues'})`);
    console.log(`requests served: ${site.requested.join(' ')}`);
    console.log(`artifacts: ${outDir}`);
  } finally {
    await browser.close();
    await site.close();
  }
}
