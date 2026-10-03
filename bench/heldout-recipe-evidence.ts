// Build fixed expectations from independent captures, never from scraper output.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

export interface Target { url: string; expected_code: string }
export interface Site { id: string; listing_url: string; teach: Target[]; test: Target[] }
export interface ExpectedField { section: string; label: string; value: string }
export interface ExpectedProduct {
  target: Target;
  fields: ExpectedField[];
  downloads: string[];
  evidence: string[];
}
export interface ExpectedListingRow {
  url: string;
  code: string;
  name: string;
  specs: Record<string, string>;
}
export interface FrozenEvidence {
  manifest_sha256: string;
  frozen_at: string;
  normalization: string;
  files: Record<string, string>;
  sites: {
    id: string;
    listing: { teach: ExpectedListingRow[]; test: ExpectedListingRow[]; test_url: string };
    teach: ExpectedProduct[];
    test: ExpectedProduct[];
  }[];
}
interface RawState {
  url: string; text: string; links: { text: string; href: string }[];
}

const reuseListingsOnly = process.argv.includes('--reuse-listings');
const [manifestPath, root, output, reusePath] = process.argv.slice(2).filter((arg) => arg !== '--reuse-listings');
if (!manifestPath || !root || !output) {
  throw new Error('usage: tsx bench/heldout-recipe-evidence.ts <manifest> <captures> <new-expectations.json> [reuse-expectations.json]');
}
if (existsSync(output)) throw new Error('Refusing to replace frozen expectations');
if (reuseListingsOnly && !reusePath) throw new Error('Listing reuse requires frozen prior evidence');
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const manifestText = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestText) as { sites: Site[] };
const files: Record<string, string> = {};
const reused = reusePath ? JSON.parse(readFileSync(reusePath, 'utf8')) as FrozenEvidence : undefined;
if (reused) {
  files[reusePath!] = digest(readFileSync(reusePath!));
  for (const [path, sha] of Object.entries(reused.files)) {
    if (digest(readFileSync(path)) !== sha) throw new Error(`Reused capture changed: ${path}`);
    files[path] = sha;
  }
}
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
function read(path: string): string {
  const text = readFileSync(path, 'utf8');
  files[path] = digest(text);
  return text;
}
function state(dir: string): RawState {
  return JSON.parse(read(join(dir, 'state.json'))) as RawState;
}
function listing(site: Site, which: 'teach' | 'test') {
  const s = state(join(root!, site.id, `listing-${which}`));
  const unique = new Map<string, { name: string; url: string }>();
  for (const link of s.links) {
    const name = norm(link.text);
    const eligible = site.id === 'leuze-fiber-optics'
      ? /^(GF|KFX?)-/.test(name) && /\/\d{8}$/.test(link.href)
      : name.startsWith('SPF ') && link.href.startsWith(site.listing_url + '/');
    if (eligible && !unique.has(link.href)) unique.set(link.href, { name, url: link.href });
  }
  const primary = [...unique.values()];
  if (!primary.length) throw new Error(`No independently visible listing rows for ${site.id}`);
  const rows = primary.map(({ name, url }, i): ExpectedListingRow => {
    const start = s.text.indexOf(name);
    const end = i + 1 < primary.length ? s.text.indexOf(primary[i + 1]!.name, start + name.length) : s.text.length;
    if (start < 0 || end < start) throw new Error('Listing name order is ambiguous');
    const segment = s.text.slice(start, end);
    const code = new URL(url).pathname.split('/').at(-1)!;
    if (!segment.includes(`Part no.: ${code}`)) throw new Error(`Primary article code missing for ${name}`);
    const specs: Record<string, string> = {};
    for (const line of segment.split('\n')) {
      if (site.id === 'leuze-fiber-optics') {
        const match = /^(Type of fiber optics|Operating principle|Fiber length|Fiber sheathing material):\s*(.+)$/.exec(line);
        if (match) specs[match[1]!] = norm(match[2]!);
      } else {
        const match = /^(Size|Suction cup material|Material hardness \[Shore A\]|Thread G1)\t(.+)$/.exec(line);
        if (match) specs[match[1]!] = norm(match[2]!);
      }
    }
    return { url, code, name, specs };
  });
  return { rows, url: s.url };
}

const browser = await chromium.launch({ headless: true });
try {
  // Parse captured DOM offline. No site scripts, stylesheets or network requests run.
  const context = await browser.newContext({ javaScriptEnabled: false });
  await context.route('**/*', (route) => route.abort());
  const page = await context.newPage();
  const result: FrozenEvidence = {
    manifest_sha256: digest(manifestText),
    frozen_at: new Date().toISOString(),
    normalization: 'NFC and whitespace folding only. Case, punctuation, units and section labels remain exact.',
    files, sites: [],
  };
  for (const site of manifest.sites) {
    const planned = [...site.teach, ...site.test];
    if (new Set(planned.map((t) => t.url)).size !== planned.length ||
        new Set(planned.map((t) => t.expected_code)).size !== planned.length) {
      throw new Error(`Teaching/test overlap in ${site.id}`);
    }
    const prior = reused?.sites.find((s) => s.id === site.id);
    if (reused && (!prior || JSON.stringify(prior.teach.map((p) => p.target)) !== JSON.stringify(site.teach))) {
      throw new Error(`Teaching targets changed in ${site.id}`);
    }
    const reuseTeaching = prior && !reuseListingsOnly;
    const all = reuseTeaching ? site.test : planned;
    const products: ExpectedProduct[] = reuseTeaching ? [...prior.teach] : [];
    for (const target of all) {
      const dir = join(root, site.id, `detail-${target.expected_code}`);
      const initial = state(join(dir, 'initial'));
      const primaryCode = /Part no\.:\s*([^\s]+)/.exec(initial.text)?.[1];
      if (primaryCode !== target.expected_code || initial.url !== target.url) {
        throw new Error(`Independent primary identity mismatch at ${dir}`);
      }
      const states = site.id === 'leuze-fiber-optics'
        ? ['initial', 'reveal-1-downloads']
        : ['initial', 'reveal-1-technical-data', 'reveal-2-documentation'];
      const fields = new Map<string, ExpectedField>();
      const downloads = new Set<string>();
      const evidence: string[] = [];
      for (const name of states) {
        const capture = join(dir, name);
        const raw = state(capture);
        const rawHtml = read(join(capture, 'page.html'));
        const html = rawHtml.trimStart().startsWith('"') ? JSON.parse(rawHtml) as string : rawHtml;
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.evaluate('globalThis.__name = (fn) => fn');
        const parsed = await page.evaluate(({ siteId, captureName, base }) => {
          const clean = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
          const text = (el: Element) => {
            const copy = el.cloneNode(true) as Element;
            copy.querySelectorAll('br').forEach((br) => br.replaceWith(' '));
            return clean(copy.textContent ?? '');
          };
          const rows: ExpectedField[] = [];
          const links: string[] = [];
          const tables = siteId === 'leuze-fiber-optics' && captureName === 'initial'
            ? [...document.querySelectorAll<HTMLTableElement>('#technicalFeatures-tab-pane table')]
            : siteId === 'schmalz-spf'
              ? [...document.querySelectorAll<HTMLTableElement>('main details[open] table')]
                .filter((table) => ['Design Data', 'Technical Data'].includes(
                  clean(table.closest('details')?.querySelector('summary')?.textContent ?? '')))
              : [];
          for (const table of tables) {
            const section = siteId === 'leuze-fiber-optics'
              ? clean(table.closest('.card')?.querySelector('.card-header button')?.textContent ?? '')
              : clean(table.closest('details')?.querySelector('summary')?.textContent ?? '');
            if (!section) throw new Error('Specification table has no independently observed heading');
            for (const row of table.rows) {
              if (row.cells.length !== 2 || [...row.cells].some((cell) => cell.tagName === 'TH')) continue;
              rows.push({ section, label: text(row.cells[0]!), value: text(row.cells[1]!) });
            }
          }
          const scopes = siteId === 'leuze-fiber-optics' && captureName === 'reveal-1-downloads'
            ? [...document.querySelectorAll('#downloads-tab-pane')]
            : siteId === 'schmalz-spf' && captureName === 'reveal-2-documentation'
              ? [...document.querySelectorAll('main details[open]')].filter((el) =>
                clean(el.querySelector('summary')?.textContent ?? '') === 'Documentation')
              : [];
          for (const scope of scopes) {
            for (const anchor of scope.querySelectorAll<HTMLAnchorElement>('a[href]')) {
              links.push(new URL(anchor.getAttribute('href')!, base).href);
            }
          }
          return { rows, links };
        }, { siteId: site.id, captureName: name, base: raw.url });
        for (const row of parsed.rows) {
          if (!norm(raw.text).includes(norm(row.label)) || !norm(raw.text).includes(norm(row.value))) {
            throw new Error(`DOM row not supported by rendered text: ${dir} ${row.label}`);
          }
          const key = JSON.stringify([row.section, row.label]);
          const prior = fields.get(key);
          if (prior && prior.value !== row.value) throw new Error(`Conflicting independent row ${key}`);
          fields.set(key, row);
        }
        for (const href of parsed.links) {
          if (raw.links.some((link) => link.href === href)) downloads.add(href);
        }
        evidence.push(capture);
      }
      if (!fields.size) throw new Error(`No independent specifications captured for ${target.url}`);
      products.push({ target, fields: [...fields.values()], downloads: [...downloads], evidence });
    }
    const teach = prior ? { rows: prior.listing.teach } : listing(site, 'teach');
    const test = prior ? { rows: prior.listing.test, url: prior.listing.test_url } : listing(site, 'test');
    if (test.rows.some((row) => teach.rows.some((old) => old.url === row.url))) {
      throw new Error(`Listing pages overlap at ${site.id}`);
    }
    result.sites.push({
      id: site.id,
      listing: { teach: teach.rows, test: test.rows, test_url: test.url },
      teach: products.slice(0, site.teach.length),
      test: products.slice(site.teach.length),
    });
  }
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(`Frozen expectations: ${output}`);
} finally {
  await browser.close();
}
