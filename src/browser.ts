import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Frame, type Page } from 'playwright';
import type { Snapshot } from './types.js';

const SNAPSHOT_SRC = readFileSync(new URL('./page/snapshot.js', import.meta.url), 'utf8');

export interface Session {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Bot protection on several catalogues (Akamai-style "Access Denied") rejects headless Chromium,
 * so run headed whenever a display exists. The window is pushed off-screen. JC_HEADLESS=1 forces headless.
 */
export const defaultHeadless = () => process.env.JC_HEADLESS === '1' || !process.env.DISPLAY;

export async function open(url: string, { headless = defaultHeadless() } = {}): Promise<Session> {
  const browser = await chromium.launch({
    headless,
    args: headless ? [] : ['--window-position=-2400,-2400'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await settle(page);
  return { browser, context, page };
}

/** Wait for the page to go quiet, bounded. Timing is code's job, not the model's. */
export async function settle(page: Page, ms = 6_000): Promise<void> {
  await page.waitForLoadState('load', { timeout: ms }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: ms }).catch(() => {});
  await page.waitForTimeout(400);
}

const evalSnapshot = (frame: Frame, opts: Record<string, number>) =>
  frame.evaluate(`(${SNAPSHOT_SRC})(${JSON.stringify(opts)})`) as Promise<Snapshot>;

/**
 * Snapshot the page plus every content-bearing child frame (finders such as Endress+Hauser's
 * Product Guide are cross-origin iframes). Frame ids are prefixed "f<n>-" so a choice maps back.
 */
export async function snapshot(page: Page, opts: Record<string, number> = {}): Promise<Snapshot> {
  const main = await evalSnapshot(page.mainFrame(), opts);
  main.frames = [];
  let n = 0;
  for (const frame of page.frames()) {
    if (frame === page.mainFrame() || frame.url() === 'about:blank' || frame.isDetached()) continue;
    const box = await (await frame.frameElement().catch(() => null))?.boundingBox().catch(() => null);
    if (!box || box.width < 200 || box.height < 150) continue;
    const sub = await evalSnapshot(frame, opts).catch(() => null);
    if (!sub || sub.text.length < 40) continue;
    const prefix = `f${++n}-`;
    main.frames.push({ id: `f${n}`, url: sub.url, text: sub.text.slice(0, 2000) });
    main.controls.push(...sub.controls.map((c) => ({ ...c, id: prefix + c.id, frame_url: frame.url() })));
    main.groups.push(...sub.groups.map((g) => ({ ...g, id: prefix + g.id })));
    main.headings.push(...sub.headings);
    main.overlays.push(...sub.overlays.map((o) => ({ ...o, id: prefix + o.id })));
    main.fingerprint += `#${prefix}${sub.fingerprint}`;
  }
  return main;
}

/** Click a control observed in the latest snapshot. Returns false if it vanished. */
export async function clickControl(page: Page, id: string, frameUrl?: string): Promise<boolean> {
  const m = /^f\d+-(.+)$/.exec(id);
  const frame = frameUrl ? page.frames().find((f) => f.url() === frameUrl) : page.mainFrame();
  if (!frame) return false;
  const target = frame.locator(`[data-jc-id="${m ? m[1] : id}"]`).first();
  if ((await target.count()) === 0) return false;
  await target.click({ timeout: 5_000 }).catch(async () => {
    await target.dispatchEvent('click');
  });
  await settle(page, 4_000);
  return true;
}
