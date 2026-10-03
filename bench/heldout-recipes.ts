// Run the frozen experiment. Compilation and replay use separate processes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { defaultHeadless, settle } from '../src/browser.js';
import { classifyRequest, decideNext, interpretClassification, listedMainItems } from '../src/classify.js';
import { compileDetailRecipe, readDetail, type DetailCompilation, type DetailRecipe } from '../src/detail.js';
import { clearGates } from '../src/gate.js';
import { createJudge } from '../src/jev.js';
import { applyRecipe, checkRows, extractListing, mergeByIdentity, readItems, recipeFit, unknownSlots, type ListingRecipe } from '../src/listing.js';
import { collectPaging, findControl, pageUrl, pagingRequest, planMechanisms, readRoles, type Mechanism } from '../src/paging.js';
import type { Site, FrozenEvidence } from './heldout-recipe-evidence.js';

const detailsOnly = process.argv.includes('--details-only');
const [mode, manifestPath, evidencePath, outDir, compiledDir] = process.argv.slice(2).filter((arg) => arg !== '--details-only');
if (!['compile', 'replay'].includes(mode ?? '') || !manifestPath || !evidencePath || !outDir ||
    (mode === 'replay' && !compiledDir)) {
  throw new Error('usage: tsx bench/heldout-recipes.ts <compile|replay> <manifest> <expectations> <new-output-dir> [compiled-dir]');
}
const load = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const manifest = load<{ sites: Site[] }>(manifestPath);
const expected = load<FrozenEvidence>(evidencePath);
if (hash(readFileSync(manifestPath)) !== expected.manifest_sha256) throw new Error('Manifest differs from frozen evidence');
for (const [file, sha] of Object.entries(expected.files)) {
  if (hash(readFileSync(file)) !== sha) throw new Error(`Independent capture changed: ${file}`);
}
mkdirSync(outDir, { recursive: false });
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
save(join(outDir, 'inputs.json'), {
  mode, manifest: manifestPath, manifest_sha256: expected.manifest_sha256,
  details_only: detailsOnly,
  expectations: evidencePath, expectations_sha256: hash(readFileSync(evidencePath)),
  compiled_dir: compiledDir, teaching_targets: manifest.sites.map((site) => ({ id: site.id, targets: site.teach })),
});
let forbiddenApiAttempts = 0;
if (mode === 'replay') {
  if (process.env.TYPESAFE_API_KEY) throw new Error('Replay must run without TYPESAFE_API_KEY');
  const fetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = args[0] instanceof Request ? args[0].url : String(args[0]);
    if (/typesafe\.ai/i.test(url)) {
      forbiddenApiAttempts++;
      throw new Error('TypeSafe API access is forbidden during replay');
    }
    return fetch(...args);
  };
}

async function readList(page: Page, recipe: ListingRecipe) {
  const items = await readItems(page, {
    itemSignature: recipe.item_signature, containerSignature: recipe.container_signature,
  });
  const rows = mergeByIdentity(applyRecipe(recipe, items.items), recipe.identity);
  return { rows, check: checkRows(recipe, rows), fit: recipeFit(recipe, items.items), unknown_slots: unknownSlots(recipe, items.items) };
}

async function stepToSecondPage(page: Page, recipe: ListingRecipe, mechanism: Mechanism) {
  const before = page.url();
  if (mechanism.kind === 'url') {
    await page.goto(pageUrl(mechanism, 2), { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } else {
    const dump = await collectPaging(page, recipe);
    const candidate = mechanism.kind === 'click_number'
      ? dump.candidates.find((c) => c.label === '2' && !c.current && !c.disabled)
      : mechanism.kind === 'click_next' || mechanism.kind === 'load_more'
        ? findControl(dump, mechanism.match) : undefined;
    if (!candidate || candidate.disabled) throw new Error('Saved paging mechanism has no observed control');
    await page.locator(`[data-jc-page="${candidate.id}"]`).click({ timeout: 5_000 });
  }
  await settle(page);
  return { mechanism, before_url: before, after_url: page.url() };
}

const browser = await chromium.launch({
  headless: defaultHeadless(),
  args: defaultHeadless() ? [] : ['--window-position=-2400,-2400'],
});
try {
  for (const site of manifest.sites) {
    const dir = join(outDir, site.id);
    mkdirSync(dir);
    const judge = mode === 'compile' ? createJudge() : undefined;
    const context = await browser.newContext({
      viewport: { width: 1366, height: 900 }, locale: 'en-US',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
      ...(mode === 'replay' ? { storageState: join(compiledDir!, site.id, 'browser-state.json') } : {}),
    });
    const consoleLog: string[] = [];
    const requests: string[] = [];
    context.on('page', (page) => {
      page.on('console', (message) => consoleLog.push(`${message.type()}: ${message.text()}`));
      page.on('pageerror', (error) => consoleLog.push(`pageerror: ${error.message}`));
      page.on('requestfailed', (request) => requests.push(`${request.url()} ${request.failure()?.errorText}`));
      page.on('response', (response) => {
        if (response.status() >= 400) requests.push(`${response.status()} ${response.url()}`);
      });
    });
    try {
      const page = await context.newPage();
      if (mode === 'compile') {
        if (!detailsOnly) {
          try {
            await page.goto(site.listing_url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await settle(page);
            const { snap, steps } = await clearGates(page, judge!);
            const req = classifyRequest(snap);
            const judgment = interpretClassification(req.groups, await judge!.ask('classify', req.state, req.questions));
            const main = snap.groups.find((group) => group.id === judgment.main_group.choice);
            const next = decideNext(judgment, listedMainItems(judgment));
            save(join(dir, 'assessment.json'), { snap, steps, judgment, next });
            if (!main || next !== 'extract') throw new Error(`Listing discovery returned ${next}`);
            const listing = await extractListing(page, judge!, main.id, { title: snap.title, heading: main.heading });
            save(join(dir, 'listing.json'), listing);
            const dump = await collectPaging(page, listing.recipe);
            save(join(dir, 'paging-dump.json'), dump);
            await page.screenshot({ path: join(dir, 'listing-teach.png'), fullPage: true });
            const paging = pagingRequest(dump, { title: snap.title, heading: main.heading });
            if (!Object.keys(paging.questions).length) throw new Error('No observed paging controls to learn');
            const answers = await judge!.ask('paging', paging.state, paging.questions);
            const mechanisms = planMechanisms(dump, readRoles(answers));
            // A scroll fallback does not establish a second numbered page for this experiment.
            const mechanism = mechanisms.find((candidate) => candidate.kind !== 'scroll');
            save(join(dir, 'paging.json'), { dump, answers, mechanisms, mechanism });
          } catch (error) {
            save(join(dir, 'listing-error.json'), { error: String(error) });
          }
        }
        await page.close();
        // Only the explicitly frozen teaching targets enter detail compilation.
        const details = await compileDetailRecipe(context, judge!, site.teach, { outDir: join(dir, 'details') });
        save(join(dir, 'compilation.json'), details);
        save(join(dir, 'detail-recipe.json'), details.recipe);
        await context.storageState({ path: join(dir, 'browser-state.json') });
      } else {
        const recipePath = join(compiledDir!, site.id, 'detail-recipe.json');
        const recipe = load<DetailRecipe>(recipePath);
        const compilation = load<DetailCompilation>(join(compiledDir!, site.id, 'compilation.json'));
        if (compilation.samples.some((sample) => !site.teach.some((target) => target.url === sample.target.url)) ||
            recipe.sample_urls.some((url) => !site.teach.some((target) => target.url === url))) {
          throw new Error('Detail recipe includes an untaught target');
        }
        save(join(dir, 'recipe-hashes.json'), { detail: hash(readFileSync(recipePath)) });
        if (!detailsOnly) {
          try {
            const listing = load<{ recipe: ListingRecipe }>(join(compiledDir!, site.id, 'listing.json'));
            const { mechanism } = load<{ mechanism?: Mechanism }>(join(compiledDir!, site.id, 'paging.json'));
            if (!mechanism) throw new Error('No learned pagination mechanism');
            await page.goto(site.listing_url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
            await settle(page);
            const first = await readList(page, listing.recipe);
            const transition = await stepToSecondPage(page, listing.recipe, mechanism);
            const second = await readList(page, listing.recipe);
            save(join(dir, 'listing-replay.json'), { recipe: listing.recipe, first, second, transition });
            await page.screenshot({ path: join(dir, 'listing-test.png'), fullPage: true });
          } catch (error) {
            save(join(dir, 'listing-error.json'), { error: String(error) });
          }
        }
        await page.close();
        for (const target of site.test) {
          const detailPage = await context.newPage();
          try {
            const result = await readDetail(detailPage, recipe, target);
            save(join(dir, `test-${target.expected_code}.json`), result);
            await detailPage.screenshot({ path: join(dir, `test-${target.expected_code}.png`), fullPage: true });
          } catch (error) {
            save(join(dir, `test-${target.expected_code}.json`), {
              target, identity: 'unverified', status: 'error', values: {}, downloads: [],
              issues: [{ reason: 'error', message: String(error) }],
            });
          } finally {
            await detailPage.close();
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      }
    } catch (error) {
      save(join(dir, 'site-error.json'), { error: String(error) });
    } finally {
      if (judge) save(join(dir, 'trace.json'), judge.trace);
      writeFileSync(join(dir, 'console.txt'), consoleLog.join('\n'));
      writeFileSync(join(dir, 'requests.txt'), requests.join('\n'));
      await context.close();
    }
  }
  save(join(outDir, 'execution.json'), {
    mode, details_only: detailsOnly, completed_at: new Date().toISOString(), judge_created: mode === 'compile',
    typesafe_key_present: Boolean(process.env.TYPESAFE_API_KEY), forbidden_api_attempts: forbiddenApiAttempts,
  });
} finally {
  await browser.close();
}
console.log(outDir);
