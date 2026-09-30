// Jev-free screenshot + basic facts for any URL: npx tsx bench/shoot-url.ts <url> <out.png>
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { open } from '../src/browser.js';

const [url, out] = process.argv.slice(2);
if (!url || !out) { console.error('usage: npx tsx bench/shoot-url.ts <url> <out.png>'); process.exit(2); }
mkdirSync(dirname(out), { recursive: true });
const s = await open(url);
try {
  await s.page.screenshot({ path: out, fullPage: true, clip: { x: 0, y: 0, width: 1366, height: 2400 } });
  const facts = await s.page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    text_start: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
  }));
  console.log(JSON.stringify({ final_url: s.page.url(), ...facts, screenshot: out }, null, 2));
} finally {
  await s.browser.close();
}
