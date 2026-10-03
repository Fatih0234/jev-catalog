import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import type { Site, Target } from './heldout-recipe-evidence.js';

const [manifestPath, outDir, stateDir] = process.argv.slice(2);
if (!manifestPath || !outDir) {
  throw new Error('usage: tsx bench/detail-schema-capture.ts <manifest> <new-captures-dir> [anonymous-state-dir]');
}
if (existsSync(outDir)) throw new Error('Refusing to replace independent captures');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sites: Site[] };
mkdirSync(outDir, { recursive: false });
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function capture(page: Page, dir: string) {
  mkdirSync(dir);
  await page.waitForTimeout(1_000);
  const state = await page.evaluate(() => ({
    url: location.href,
    text: document.body.innerText,
    links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return anchor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
          rect.width > 0 && rect.height > 0;
      })
      .map((anchor) => ({ text: anchor.innerText, href: anchor.href })),
  }));
  save(join(dir, 'state.json'), state);
  writeFileSync(join(dir, 'page.html'), await page.content(), { flag: 'wx' });
  await page.screenshot({ path: join(dir, 'page.png'), fullPage: true });
}

async function clearConsent(page: Page) {
  const deny = page.getByRole('button', { name: /^(Deny|Reject all|Decline all|Only necessary cookies)$/i });
  if (await deny.count() === 1 && await deny.isVisible()) {
    await deny.click();
    await page.waitForTimeout(500);
  }
}

async function openDetails(page: Page, name: string) {
  const summary = page.locator('main details > summary').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`, 'i') });
  if (await summary.count() !== 1) throw new Error(`Independent disclosure is missing or ambiguous: ${name}`);
  const opened = await summary.evaluate((element) => (element.parentElement as HTMLDetailsElement).open);
  if (!opened) await summary.click();
}

async function captureProduct(page: Page, site: Site, target: Target, dir: string) {
  mkdirSync(dir);
  const response = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (!response || response.status() >= 400) throw new Error(`Product navigation failed: ${response?.status()}`);
  await page.waitForTimeout(2_000);
  await clearConsent(page);
  if (page.url() !== target.url) throw new Error('Independent capture navigated to a different URL');
  const body = await page.locator('body').innerText();
  if (/Part no\.:\s*([^\s]+)/.exec(body)?.[1] !== target.expected_code) {
    throw new Error('Independent visible article number differs from target');
  }
  await capture(page, join(dir, 'initial'));
  if (site.id === 'leuze-fiber-optics') {
    const tab = page.getByRole('tab', { name: 'Downloads', exact: true });
    if (await tab.count() !== 1) throw new Error('Independent Downloads tab is missing or ambiguous');
    await tab.click();
    await page.locator('#downloads-tab-pane').waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(() => {
      const panel = document.querySelector('#downloads-tab-pane');
      return !!panel && getComputedStyle(panel).opacity === '1';
    }, undefined, { timeout: 10_000 });
    await capture(page, join(dir, 'reveal-1-downloads'));
  } else if (site.id === 'schmalz-spf') {
    await openDetails(page, 'Technical Data');
    await capture(page, join(dir, 'reveal-1-technical-data'));
    await openDetails(page, 'Documentation');
    await capture(page, join(dir, 'reveal-2-documentation'));
  } else {
    throw new Error(`No independent capture procedure for ${site.id}`);
  }
  if (page.url() !== target.url) throw new Error('Disclosure changed the independent target URL');
}

const browser = await chromium.launch({
  headless: false,
  args: ['--window-position=-2400,-2400'],
});
try {
  for (const site of manifest.sites) {
    const dir = join(outDir, site.id);
    mkdirSync(dir);
    const statePath = stateDir ? join(stateDir, site.id, 'browser-state.json') : undefined;
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      locale: 'en-US',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      ...(statePath ? { storageState: statePath } : {}),
    });
    const errors: { target: Target; error: string }[] = [];
    const consoleLog: string[] = [];
    let forbiddenApiAttempts = 0;
    await context.route('**/*', async (route) => {
      if (/typesafe\.ai/i.test(route.request().url())) {
        forbiddenApiAttempts++;
        await route.abort();
      } else {
        await route.continue();
      }
    });
    for (const target of [...site.teach, ...site.test]) {
      const page = await context.newPage();
      page.on('pageerror', (error) => consoleLog.push(error.message));
      try {
        await captureProduct(page, site, target, join(dir, `detail-${target.expected_code}`));
        console.log(`${site.id}: captured ${target.expected_code}`);
      } catch (error) {
        errors.push({ target, error: String(error) });
        console.error(`${site.id}: capture failed for ${target.expected_code}: ${String(error)}`);
      } finally {
        await page.close();
      }
    }
    save(join(dir, 'capture-errors.json'), errors);
    save(join(dir, 'capture-receipt.json'), { judge_created: false, forbidden_api_attempts: forbiddenApiAttempts });
    save(join(dir, 'page-errors.json'), consoleLog);
    if (errors.length || forbiddenApiAttempts) process.exitCode = 1;
    await context.close();
  }
} finally {
  await browser.close();
}
