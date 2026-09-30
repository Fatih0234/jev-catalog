import { choice, noul } from '@typesafe-ai/sdk';
import type { Page } from 'playwright';
import { clickControl, settle, snapshot } from './browser.js';
import type { Judge } from './jev.js';
import type { Snapshot } from './types.js';

/** A gate is anything that asks the visitor to respond before browsing: consent, locale, newsletter. */
export const GATE_MIN_PROBABILITY = 0.6;
export const ROLE_MIN_PROBABILITY = 0.6;
const MAX_OFFERED = 25;

/**
 * Jev says what each control does; code decides which one to press.
 * Ranking inside one instruction ("prefer reject, otherwise accept") was read too literally in the
 * first bench (it chose "Manage preferences"), so the preference order lives here instead.
 */
export const CONTROL_ROLES = {
  reject_optional: 'Rejects or declines optional cookies, or saves only necessary or essential cookies, and closes the prompt.',
  accept_all: 'Accepts or allows all cookies and closes the prompt.',
  open_settings: 'Opens cookie settings, preferences, customization or more details, without closing the prompt.',
  stay_region: 'Keeps the visitor on the website described in `current_site`, for example by confirming it or choosing to stay.',
  switch_region: 'Moves the visitor to a website for a different country or language than `current_site`, even if the prompt suggests it.',
  close: 'Closes or dismisses the prompt without answering it, for example X, close, not now or no thanks.',
  other: 'Anything else, such as a policy link, navigation or a product link.',
} as const;
export type ControlRole = keyof typeof CONTROL_ROLES;
/** Press order. Roles not listed are never pressed. */
export const ROLE_PRIORITY: ControlRole[] = ['reject_optional', 'stay_region', 'close', 'accept_all'];

/** Host plus locale-looking first path segment, e.g. hager.com/de. Answering a prompt must not change it. */
export function siteKey(url: string): string {
  const u = new URL(url);
  const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
  return /^[a-z]{2}([-_][a-z]{2})?$/i.test(first) ? `${u.host}/${first.toLowerCase()}` : u.host;
}

function currentSite(snap: Snapshot) {
  const u = new URL(snap.url);
  return { host: u.host, path: u.pathname, page_language: snap.lang || 'unknown' };
}

export function gateRequest(snap: Snapshot) {
  const overlayControls = snap.controls.filter((c) => c.in_overlay);
  // Inline banners are not fixed layers; fall back to the first short-labelled controls on the page.
  const pool = overlayControls.length ? overlayControls : snap.controls.filter((c) => c.label.length <= 40);
  const offered = pool.slice(0, MAX_OFFERED);
  const state = {
    current_site: currentSite(snap),
    page: { url: snap.url, title: snap.title },
    overlays: snap.overlays,
    page_text_start: snap.text.slice(0, 1200),
  };
  const questions: Record<string, ReturnType<typeof noul> | ReturnType<typeof choice>> = {
    gate_present: noul(
      'Is the visitor currently being asked to respond to a prompt before browsing, such as a cookie consent banner, a country or language selector, a newsletter or signup popup, or a login prompt?',
    ),
  };
  for (const c of offered) {
    questions[`role_${c.id}`] = choice(
      { control: { label: c.label, kind: c.role, inside_overlay: Boolean(c.in_overlay) }, question: 'What happens when the visitor clicks `control`?' },
      CONTROL_ROLES as any,
    );
  }
  return { state, questions, offered: offered.map((c) => c.id) };
}

export type GateDecision =
  | { action: 'click'; id: string; label: string; role: ControlRole; role_probability: number; gate_probability: number }
  | { action: 'stop'; reason: 'no-gate' | 'no-target'; gate_probability: number };

export function decideGate(snap: Snapshot, answers: any): GateDecision {
  const p = Number(answers.gate_present?.noul ?? 0);
  if (p < GATE_MIN_PROBABILITY) return { action: 'stop', reason: 'no-gate', gate_probability: p };
  for (const role of ROLE_PRIORITY) {
    let best: { id: string; prob: number } | undefined;
    for (const c of snap.controls) {
      const prob = Number(answers[`role_${c.id}`]?.probabilities?.[role] ?? 0);
      if (prob >= ROLE_MIN_PROBABILITY && (!best || prob > best.prob)) best = { id: c.id, prob };
    }
    if (best) {
      const control = snap.controls.find((c) => c.id === best.id)!;
      return { action: 'click', id: control.id, label: control.label, role, role_probability: best.prob, gate_probability: p };
    }
  }
  return { action: 'stop', reason: 'no-target', gate_probability: p };
}

export interface GateStep {
  decision: GateDecision;
  clicked?: boolean;
  page_changed?: boolean;
  /** The click moved to another site or locale, so the original URL was restored. */
  reverted_from?: string;
}

/** Answer blocking prompts, bounded. Stops when Jev sees no gate or the page stops changing. */
export async function clearGates(page: Page, judge: Judge, maxRounds = 3): Promise<{ steps: GateStep[]; snap: Snapshot }> {
  const steps: GateStep[] = [];
  let snap = await snapshot(page);
  for (let round = 0; round < maxRounds; round++) {
    const { state, questions } = gateRequest(snap);
    const decision = decideGate(snap, await judge.ask('gate', state, questions));
    const step: GateStep = { decision };
    steps.push(step);
    if (decision.action === 'stop') break;
    const before = page.url();
    step.clicked = await clickControl(page, decision.id, snap.controls.find((c) => c.id === decision.id)?.frame_url);
    if (siteKey(page.url()) !== siteKey(before)) {
      step.reverted_from = page.url();
      await page.goto(before, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await settle(page);
    }
    const next = await snapshot(page);
    step.page_changed = next.fingerprint !== snap.fingerprint;
    snap = next;
    if (!step.clicked || !step.page_changed) break;
  }
  return { steps, snap };
}
