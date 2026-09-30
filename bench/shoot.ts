// Capture Jev-free screenshots of every bench site so labels can be written without seeing model output.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { open } from '../src/browser.js';

const { sites } = JSON.parse(readFileSync("bench/suites/hubs.json", "utf8")) as { sites: { id: string; url: string }[] };
const only = process.argv[2];
mkdirSync('artifacts/shots', { recursive: true });
const log: Record<string, unknown> = {};
for (const site of sites.filter((s) => !only || s.id === only)) {
  try {
    const s = await open(site.url);
    await s.page.screenshot({ path: `artifacts/shots/${site.id}.png`, fullPage: true, clip: { x: 0, y: 0, width: 1366, height: 2400 } });
    log[site.id] = { final_url: s.page.url(), title: await s.page.title() };
    await s.browser.close();
    console.log('ok', site.id);
  } catch (e) {
    log[site.id] = { error: String(e).slice(0, 200) };
    console.log('fail', site.id, String(e).slice(0, 120));
  }
}
writeFileSync('artifacts/shots/log.json', JSON.stringify(log, null, 2));
