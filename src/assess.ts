import type { BrowserContext, Page } from 'playwright';
import { settle, snapshot } from './browser.js';
import { classifyRequest, decideNext, interpretClassification, listedMainItems, THRESHOLDS, type NextAction, type PageAssessment } from './classify.js';
import { clearGates, type GateStep } from './gate.js';
import type { Judge } from './jev.js';
import { itemsFromProbes, probeItems, type ProbeResult } from './probe.js';
import type { Group, Snapshot } from './types.js';

export interface Assessment {
  url: string;
  title: string;
  gates: GateStep[];
  judgment: PageAssessment;
  main_group?: Group;
  listed_items?: string;
  probes: ProbeResult[];
  probes_skipped_by_memo?: boolean;
  main_items?: string;
  next: NextAction;
  view_all?: { label: string; href: string; confidence: number };
  snap: Snapshot;
}

/**
 * Remembers what probing found for pages under the same parent, so siblings rendered from one
 * template are not all probed. Key: parent URL + listed item kind.
 */
export class ProbeMemo {
  private seen = new Map<string, string[]>();
  constructor(private readonly agreeAfter = 2) {}
  known(key: string): string | undefined {
    const v = this.seen.get(key);
    return v && v.length >= this.agreeAfter && v.every((x) => x === v[0]) ? v[0] : undefined;
  }
  record(key: string, finalItems: string | undefined) {
    if (!finalItems) return;
    this.seen.set(key, [...(this.seen.get(key) ?? []), finalItems]);
  }
}

export interface AssessOptions {
  /** Always run the gate check (first page of a session). Otherwise only when overlays are present. */
  gates?: boolean;
  memo?: ProbeMemo;
  parentUrl?: string;
}

/** Judge one loaded page: answer prompts, classify, probe items, and decide the crawl action. */
export async function assessPage(page: Page, context: BrowserContext, judge: Judge, opts: AssessOptions = {}): Promise<Assessment> {
  let snap = await snapshot(page);
  let gates: GateStep[] = [];
  if (opts.gates || snap.controls.some((c) => c.in_overlay)) {
    ({ steps: gates, snap } = await clearGates(page, judge));
  }
  let req = classifyRequest(snap);
  let judgment = interpretClassification(req.groups, await judge.ask('classify', req.state, req.questions));
  // Bot checks often clear by themselves in a real browser. Waiting is code's job; Jev only says "blocked".
  if (judgment.page_kind.choice === 'error_or_blocked') {
    await page.waitForTimeout(15_000);
    await settle(page);
    snap = await snapshot(page);
    req = classifyRequest(snap);
    judgment = interpretClassification(req.groups, await judge.ask('classify-retry', req.state, req.questions));
  }

  const main = snap.groups.find((g) => g.id === judgment.main_group.choice);
  const listed = listedMainItems(judgment);
  let probes: ProbeResult[] = [];
  let mainItems: string | undefined = listed;
  let skipped = false;
  if (main && (listed === 'individual_product' || listed === 'product_family')) {
    const key = `${opts.parentUrl ?? ''}|${listed}`;
    const known = opts.memo?.known(key);
    if (known) {
      mainItems = known;
      skipped = true;
    } else {
      probes = await probeItems(context, judge, main, snap.url);
      mainItems = itemsFromProbes(probes) ?? listed;
      opts.memo?.record(key, mainItems);
    }
  }
  const next = decideNext(judgment, mainItems);

  let view_all: Assessment['view_all'];
  const va = snap.controls.find((c) => c.id === judgment.view_all.choice);
  if (va?.href && judgment.view_all.confidence >= THRESHOLDS.viewAll) {
    view_all = { label: va.label, href: new URL(va.href, snap.url).href, confidence: judgment.view_all.confidence };
  }

  return {
    url: snap.url,
    title: snap.title,
    gates,
    judgment,
    main_group: main,
    listed_items: listed,
    probes,
    probes_skipped_by_memo: skipped || undefined,
    main_items: mainItems,
    next,
    view_all,
    snap,
  };
}
