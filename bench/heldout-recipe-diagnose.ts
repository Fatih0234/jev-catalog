// Inspect the identity boundary without Jev or changing the baseline recipes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultHeadless, settle } from '../src/browser.js';
import { observeDetail } from '../src/detail.js';
import { DETAIL_POLICY, normalizeDetailCode } from '../src/detail-policy.js';
import type { Site } from './heldout-recipe-evidence.js';

const [manifestPath, compileDir, outDir] = process.argv.slice(2);
if (!manifestPath || !compileDir || !outDir) throw new Error('usage: tsx bench/heldout-recipe-diagnose.ts <manifest> <compile-dir> <new-output-dir>');
if (process.env.TYPESAFE_API_KEY) throw new Error('Diagnostics must run without TYPESAFE_API_KEY');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sites: Site[] };
const observer = readFileSync(new URL('../src/page/detail.js', import.meta.url), 'utf8');
const inspection = observer.replace('for (const b of blocks) delete b.el;', `
  out.debug = {
    first_block: firstBlockEl ? {
      tag: firstBlockEl.tagName, classes: firstBlockEl.className,
      text_start: clean(firstBlockEl.innerText, 300)
    } : null,
    code_elements: all.filter((e) => clean(e.textContent, 80) === P.expectedCode).map((e) => ({
      tag: e.tagName, classes: e.className, visible: visible(e), in_scope: inScope(e),
      global_chrome: inGlobalChrome(e), excluded: excluded(e),
      in_header: inHeaderRegion(e), related_section: inRelatedSection(e),
      candidate_ok: candidateOk(e), inside_first_block: !!firstBlockEl?.contains(e)
    })),
    primary_headings: all.filter((e) => e.tagName === 'H1' && inScope(e)).map((e) => ({
      text: clean(e.innerText, 120), candidate_ok: candidateOk(e),
      in_header: inHeaderRegion(e), inside_first_block: !!firstBlockEl?.contains(e)
    }))
  };
  for (const b of blocks) delete b.el;`);
if (inspection === observer) throw new Error('Diagnostic insertion point changed');
mkdirSync(outDir, { recursive: false });
const browser = await chromium.launch({
  headless: defaultHeadless(),
  args: defaultHeadless() ? [] : ['--window-position=-2400,-2400'],
});
try {
  for (const site of manifest.sites) {
    const target = site.teach[0]!;
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 }, locale: 'en-US',
      storageState: join(compileDir, site.id, 'browser-state.json'),
    });
    try {
      const page = await context.newPage();
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settle(page);
      const observation = await observeDetail(page);
      const inspected: unknown = await page.evaluate(`(${inspection})(${JSON.stringify({
        ...DETAIL_POLICY, expectedCode: target.expected_code,
      })})`);
      const body = await page.locator('body').innerText();
      const visiblePrimaryCode = /Part no\.:\s*([^\s]+)/.exec(body)?.[1];
      const offeredPrimaryCode = observation.candidates.some((candidate) =>
        normalizeDetailCode(candidate.value) === target.expected_code);
      const result = { target, visible_primary_code: visiblePrimaryCode, offered_primary_code: offeredPrimaryCode, observation, inspected };
      writeFileSync(join(outDir, `${site.id}.json`), JSON.stringify(result, null, 2) + '\n');
      await page.screenshot({ path: join(outDir, `${site.id}.png`), fullPage: true });
      const passed = visiblePrimaryCode === target.expected_code && offeredPrimaryCode;
      console.log(`${site.id}: ${passed ? 'PASS' : 'FAIL'}, visible=${visiblePrimaryCode}, candidates=${observation.candidates.length}`);
      if (!passed) process.exitCode = 1;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
