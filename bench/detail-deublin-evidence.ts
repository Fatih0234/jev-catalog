// Capture independent, Jev-free detail expectations before running the pipeline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultHeadless, settle } from '../src/browser.js';
import { observeDetail } from '../src/detail.js';
import { parseDetailListing, sampleDetailTargets, targetsFromListing } from '../src/detail-policy.js';

const base = 'artifacts/listing-bench/2026-09-30T23-19-06-338Z/deublin-selektor';
const out = process.argv[2];
if (!out) throw new Error('usage: tsx bench/detail-deublin-evidence.ts <new-output-dir>');
const listing = parseDetailListing({
  recipe: JSON.parse(readFileSync(join(base, 'recipe.json'), 'utf8')),
  rows: JSON.parse(readFileSync(join(base, 'rows.json'), 'utf8')),
});
const targets = sampleDetailTargets(targetsFromListing(listing.recipe, listing.rows).targets);
mkdirSync(out, { recursive: false });
writeFileSync(join(out, 'listing.json'), JSON.stringify(listing, null, 2));
writeFileSync(join(out, 'targets.json'), JSON.stringify(targets, null, 2));

const browser = await chromium.launch({
  headless: defaultHeadless(),
  args: defaultHeadless() ? [] : ['--window-position=-2400,-2400'],
});
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
  for (const [i, target] of targets.entries()) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 1_500));
    const page = await context.newPage();
    const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await settle(page);
    const independent = await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('main [class*="ProductDetailsRow]"]')]
        .filter((el) => el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))
        .map((el) => {
          const section = el.closest('[class*="ProductDetails]"]')?.querySelector<HTMLElement>('h3')?.innerText.trim();
          const [label, value] = [...el.children] as HTMLElement[];
          if (!section || !label || !value) throw new Error('Deublin row structure changed');
          return { section, label: label.innerText.trim(), value: value.innerText.trim() };
        });
      const downloads = [...document.querySelectorAll<HTMLAnchorElement>('main [class*="DownloadCard]"] a[href]')]
        .filter((el) => el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))
        .map((el) => ({
          url: el.href,
          label: el.closest('[class*="DownloadCard]"]')?.textContent?.replace(/\s+/g, ' ').trim(),
        }));
      return {
        title: document.title,
        primary_code: document.querySelector<HTMLElement>('main h2')?.innerText.trim(),
        rows,
        downloads,
        main_text: document.querySelector<HTMLElement>('main')?.innerText,
      };
    });
    if (independent.primary_code !== target.expected_code || independent.rows.length === 0) {
      throw new Error(`Unusable independent evidence for ${target.url}`);
    }
    writeFileSync(join(out, `sample-${i}-expected.json`), JSON.stringify({
      target, final_url: page.url(), status: response?.status(), captured_at: new Date().toISOString(),
      ...independent,
    }, null, 2));
    writeFileSync(join(out, `sample-${i}-observer-before.json`), JSON.stringify(await observeDetail(page), null, 2));
    writeFileSync(join(out, `sample-${i}.html`), await page.content());
    await page.screenshot({ path: join(out, `sample-${i}.png`), fullPage: true });
    console.log(`${target.expected_code}: captured independent rows and download URLs`);
    await page.close();
  }
} finally {
  await browser.close();
}
