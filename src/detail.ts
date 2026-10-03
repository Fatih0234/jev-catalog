// Detail pages differ too much for positional guessing: every site hides the spec sheet
// somewhere else. Compilation samples a few product detail pages, asks Jev what the observed
// disclosure controls and labelled blocks contain, and saves the agreement as a recipe.
// Replay re-opens one detail page and follows the recipe's recorded reveals and sections with
// no model calls at all.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { settle } from './browser.js';
import { clearGates, siteKey } from './gate.js';
import type { Judge } from './jev.js';
import {
  DETAIL_ERROR_CONTENT,
  DETAIL_ERROR_TITLE,
  DETAIL_POLICY,
  DETAIL_PRIMARY_LABEL,
  normalizeDetailCode,
  sameDetailDocument,
  verifyDetailIdentity,
  detailFieldKey,
  sampleDetailTargets,
  type DetailTarget,
  type DetailIdentity,
} from './detail-policy.js';
import {
  acceptedDetailRole,
  detailContentRequest,
  detailIdentityRequest,
  detailIdentityRequestV2,
  DETAIL_BLOCK_ROLES,
  DETAIL_CONTROL_ROLES,
  type DetailBlockEvidence,
  type DetailControlEvidence,
} from './detail-questions.js';
import { learnDetailSchema, matchDetailSchema, resolveFieldValue, type SchemaObservationCapture } from './detail-schema.js';

export type { DetailTarget } from './detail-policy.js';

export interface DetailIssue {
  reason: string;
  message?: string;
}

export type DetailStatus =
  | 'ok'
  | 'partial'
  | 'blocked'
  | 'no_content'
  | 'identity_mismatch'
  | 'identity_unverified'
  | 'navigation_changed'
  | 'error';

export interface DetailResult {
  target: DetailTarget;
  final_url?: string;
  identity: DetailIdentity;
  status: DetailStatus;
  values: Record<string, string>;
  field_sources?: Record<string, DetailFieldSourceRecord[]>;
  unmapped_fields?: DetailFieldSourceRecord[];
  warnings?: DetailIssue[];
  recipe_version?: number;
  downloads: { label: string; url: string; section: string[] }[];
  observed_codes: string[];
  issues: DetailIssue[];
  reveals: { label: string; kind: string; before_url: string; after_url: string; changed: boolean }[];
}

export interface DetailRecipeV1 {
  version: 1;
  sample_urls: string[];
  /** Locator shape that produced a verified primary code during compilation. */
  identity?: { source: string; via: string; section?: string[] };
  reveals: {
    label: string;
    kind: 'tab' | 'accordion' | 'summary';
    panel_heading: string;
    role: 'specifications' | 'downloads';
    section?: string[];
    /** Template signatures on which this control was observed; absent means always expected. */
    expected_on?: string[];
  }[];
  sections: {
    section: string[];
    kind: 'table' | 'dl' | 'rows';
    role: 'specifications' | 'ordering' | 'downloads';
    /** Union of row labels observed in accepted blocks of this section+kind. */
    row_labels?: string[];
    /** Union of link labels observed in accepted blocks, product codes stabilized. */
    link_labels?: string[];
  }[];
  fields: { key: string; label: string; section: string[]; sample_coverage: number }[];
  /** Shapes positively judged non-content; replay does not flag these as drift. */
  ignored_sections?: { section: string[]; kind: 'table' | 'dl' | 'rows'; row_labels?: string[]; link_labels?: string[] }[];
  /** Known page templates: identity locator shape plus the initial control set. */
  templates?: string[];
}

export interface DetailFieldSourceRecord {
  sample_url: string;
  phase: string;
  candidate_id: string;
  binding_id: string;
  label: string;
  value: string;
  raw_section: string[];
  section: string[];
  block_kind: 'table' | 'dl' | 'rows';
}

export interface DetailFieldSourceRule {
  id: string;
  label: string;
  block_kind: 'table' | 'dl' | 'rows';
  region: string[];
  region_aliases?: string[][];
  panel_label?: string;
  detail?: boolean;
  structure: { path: ObservedNodeDescriptor[]; row_kind: ObservedRowKind };
}

export interface DetailFieldV2 {
  key: string;
  label: string;
  section: string[];
  aliases: string[];
  sources: DetailFieldSourceRule[];
  coverage: { present: string[]; absent: string[]; unknown: string[] };
  sample_coverage: number;
  observed_all: boolean;
}

export interface DetailRegionRule {
  id?: string;
  section: string[];
  aliases: string[][];
  role: 'specifications' | 'ordering' | 'downloads';
  kind: 'table' | 'dl' | 'rows';
  headings: string[];
  panel_labels: string[];
  links?: string[];
  confirmed_links?: { label: string; pattern: string }[];
  structure?: { path: ObservedNodeDescriptor[] };
  observed_all?: boolean;
}

export interface DetailRecipeV2 {
  version: 2;
  recipe_version: 2;
  sample_urls: string[];
  learning: {
    state: 'ready' | 'partial' | 'unusable';
    attempted: string[];
    verified: string[];
    inspected: string[];
  };
  identity?: { mechanisms: { source: string; via: string }[] };
  regions: DetailRegionRule[];
  fields: DetailFieldV2[];
  reveals: {
    label: string;
    kind: 'tab' | 'accordion' | 'summary';
    panel_heading: string;
    role: 'specifications' | 'downloads';
    section?: string[];
    structure?: { path: ObservedNodeDescriptor[] };
    expected_on?: string[];
  }[];
  ignored: { text: string; role: string }[];
  diagnostics: DetailIssue[];
  templates?: string[];
}

export type DetailRecipe = DetailRecipeV1 | DetailRecipeV2;

export interface DetailCompilation {
  recipe: DetailRecipe;
  samples: DetailResult[];
  issues: DetailIssue[];
}

export interface CompileOptions {
  outDir?: string;
  pauseMs?: number;
  revealTimeoutMs?: number;
  recipeVersion?: 1 | 2;
}

export interface ReadOptions {
  revealTimeoutMs?: number;
}

// ---------- In-page observation ----------

export interface ObservedCandidate { id: string; source: 'metadata' | 'labelled' | 'heading'; via: string; value: string; context: string; section: string[] }
export type ObservedRowKind = 'table_header' | 'table_row' | 'definition_pair' | 'peer_row' | 'grid_pair' | 'colon_pair';
export interface ObservedRowEvidence { id: string; kind: ObservedRowKind; label_tag: string; value_tag: string }
export interface ObservedHeadingEvidence {
  id: string; text: string; tag: string;
  via: 'heading' | 'caption' | 'summary' | 'aria_labelledby' | 'accordion_header' | 'panel_label';
  itemprop: string; relation: 'own' | 'ancestor'; depth: number;
}
export interface ObservedNodeDescriptor { tag: string; role: string; itemprop: string; classes: string[] }
export interface ObservedBlockEvidence { headings: ObservedHeadingEvidence[]; path: ObservedNodeDescriptor[]; panel?: { id: string; label: string; control_id?: string }; excluded?: boolean; truncated?: string[] }
export interface ObservedControlEvidence { headings: ObservedHeadingEvidence[]; path: ObservedNodeDescriptor[]; excluded?: boolean; truncated?: string[] }
export interface ObservedControl { id: string; label: string; kind: 'tab' | 'accordion' | 'summary'; panel_heading: string; expanded: boolean; section: string[]; evidence?: ObservedControlEvidence }
export interface ObservedLink {
  id: string;
  label: string;
  url: string;
  document_title?: string;
  download_attribute?: string;
  has_download?: boolean;
}

export interface ObservedBlock {
  id: string; section: string[]; kind: 'table' | 'dl' | 'rows';
  rows: { label: string; value: string; evidence?: ObservedRowEvidence }[];
  links: ObservedLink[]; total_rows: number;
  evidence?: ObservedBlockEvidence;
}
export interface DetailObservation {
  url: string;
  title: string;
  scope: 'main' | 'product' | 'none';
  candidates: ObservedCandidate[];
  controls: ObservedControl[];
  blocks: ObservedBlock[];
  text: string;
  fingerprint: string;
  truncated: string[];
  evidence_truncated?: string[];
  unsupported_frames: number;
}

const DETAIL_SRC = readFileSync(new URL('./page/detail.js', import.meta.url), 'utf8');

/** Read one bounded observation of the product detail page currently open in `page`. */
export async function observeDetail(page: Page, recipeVersion: 1 | 2 = 1): Promise<DetailObservation> {
  const obs = await page.evaluate(`(${DETAIL_SRC})(${JSON.stringify({ ...DETAIL_POLICY, includeDocumentLinks: recipeVersion === 2 })})`) as Omit<DetailObservation, 'url'>;
  return { ...obs, url: page.url() };
}

// ---------- Page health ----------

/** Code-owned health check: transport errors and error-title/error-only content, never Jev. */
export function pageHealth(status: number | undefined, obs: { scope: string; text: string; title?: string }): 'ok' | 'blocked' | 'no_content' {
  if (status !== undefined && status >= 400) return 'blocked';
  if (obs.title && DETAIL_ERROR_TITLE.test(obs.title)) return 'blocked';
  if (obs.scope === 'none' || !obs.text.trim()) return 'no_content';
  if (DETAIL_ERROR_CONTENT.test(obs.text) && obs.text.trim().length < DETAIL_POLICY.shortErrorPageText) return 'blocked';
  return 'ok';
}

// ---------- Stable keys ----------

/** Recipe-stable control identity: kind, label, wiring heading and full section path. No ids. */
const stableControlKey = (c: { label: string; kind: string; panel_heading: string; section?: string[] }) =>
  `${c.kind}|${c.label}|${c.panel_heading}|${JSON.stringify(c.section ?? [])}`;
const stableSectionKey = (b: { section: string[]; kind: string }) => `${b.kind}|${JSON.stringify(b.section)}`;
/** Link labels carry product codes; stabilize them the same way as section headings. */
const stableLinkLabel = (label: string, expected?: string) => stabilizeSection([label], expected)[0] ?? '';
/** Content shape of a block: section, kind and the observed labels. A changed shape is re-judged. */
const blockContentKey = (b: ObservedBlock, expected?: string) => `${stableSectionKey({ section: stabilizeSection(b.section, expected), kind: b.kind })}|${b.rows.map((r) => r.label).join(',')}|${b.links.map((l) => stableLinkLabel(l.label, expected)).join(',')}`;

/** A heading that carries the product code must not go into the recipe verbatim: "Maße 221-413"
 * becomes "Maße {code}". Only a literal whole-token expected-code match is replaced, so a longer
 * code containing it ("221-4139") is left alone. */
export function stabilizeSection(section: string[], expected: string | undefined): string[] {
  const code = expected ? normalizeDetailCode(expected) : '';
  if (!code) return [...section];
  const esc = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}._/-])${esc}(?=$|[^\\p{L}\\p{N}._/-])`, 'gu');
  return section.map((part) => part.replace(re, `$1{code}`));
}

/** Identity candidates that match the locator shape learnt during compilation. */
function locatedCandidates(obs: DetailObservation, locator: DetailRecipeV1['identity'], expected?: string): ObservedCandidate[] {
  const pool = locator
    ? obs.candidates.filter((c) => c.source === locator.source && c.via === locator.via
      && (!locator.section || JSON.stringify(stabilizeSection(c.section, expected)) === JSON.stringify(locator.section)))
    : obs.candidates;
  return pool;
}

/** Re-verify the primary identity from the current observation using the recorded locator shape. */
function recheckIdentity(obs: DetailObservation, locator: DetailRecipeV1['identity'], expected: string | undefined): DetailIdentity {
  return verifyDetailIdentity(expected, locatedCandidates(obs, locator, expected).map((c) => c.value));
}

/** Template signature: identity locator shape plus the initial control set. No codes or URLs. */
function templateSignature(controls: ObservedControl[], locator: DetailRecipeV1['identity']): string {
  return `${locator ? `${locator.source}|${locator.via}` : 'none'}#${controls.map(stableControlKey).sort().join(';')}`;
}

// ---------- Value collection ----------

interface Collected {
  values: Record<string, string>;
  downloads: Map<string, { label: string; url: string; section: string[] }>;
  issues: DetailIssue[];
  conflicts: Set<string>;
  drift: Set<string>;
}

function collectBlock(block: ObservedBlock, role: 'specifications' | 'ordering' | 'downloads', expected: string | undefined, collected: Collected, knownFields?: Set<string>, knownLinks?: Set<string>) {
  const section = stabilizeSection(block.section, expected);
  if (role === 'specifications' || role === 'ordering') {
    for (const row of block.rows) {
      const label = row.label.replace(/:\s*$/, '');
      if (!label) continue;
      const key = detailFieldKey(section, label);
      // A field the recipe never saw inside a declared section is kept but reported as drift.
      if (knownFields && !knownFields.has(key) && !collected.drift.has(key)) {
        collected.drift.add(key);
        collected.issues.push({ reason: 'schema_drift', message: `unknown field ${key}` });
      }
      if (collected.values[key] === undefined) collected.values[key] = row.value;
      else if (collected.values[key] !== row.value && !collected.conflicts.has(key)) {
        collected.conflicts.add(key);
        collected.issues.push({ reason: 'conflicting_values', message: `${key}: "${collected.values[key]}" vs "${row.value}"` });
      }
    }
  } else {
    for (const link of block.links) {
      if (!/^https?:/i.test(link.url) || !link.label) continue;
      const stable = stableLinkLabel(link.label, expected);
      // A link label the recipe never saw is kept but reported as drift.
      if (knownLinks && !knownLinks.has(stable) && !collected.drift.has(`link:${stable}`)) {
        collected.drift.add(`link:${stable}`);
        collected.issues.push({ reason: 'schema_drift', message: `unknown link "${link.label}"` });
      }
      collected.downloads.set(link.url, { label: link.label, url: link.url, section });
    }
  }
}

/** Remove values and downloads a quarantined block added earlier. */
function clearBlock(block: ObservedBlock, expected: string | undefined, collected: Collected) {
  const section = stabilizeSection(block.section, expected);
  for (const row of block.rows) {
    const label = row.label.replace(/:\s*$/, '');
    if (label) delete collected.values[detailFieldKey(section, label)];
  }
  for (const link of block.links) collected.downloads.delete(link.url);
}

// ---------- Artifacts ----------

interface ObservationEvidence {
  phase: string;
  url: string;
  candidates: ObservedCandidate[];
  controls: (ObservedControl & { role?: string })[];
  blocks: (Omit<ObservedBlock, 'rows' | 'links'> & { role?: string; row_labels: string[]; link_labels: string[] })[];
  truncated: string[];
  unsupported_frames: number;
  fingerprint: string;
}

interface RunArtifacts {
  dir: string;
  index: number;
}

const shot = async (page: Page, artifacts: RunArtifacts | undefined, name: string, issues: DetailIssue[]) => {
  if (!artifacts) return;
  try {
    await page.screenshot({ path: join(artifacts.dir, `sample-${artifacts.index}-${name}.png`) });
  } catch (e) {
    issues.push({ reason: 'artifact_error', message: `screenshot ${name}: ${String(e).slice(0, 120)}` });
  }
};

// ---------- Per-target read ----------

type ControlRole = 'specifications' | 'downloads' | 'other' | 'unverified';
type BlockRole = 'specifications' | 'ordering' | 'downloads' | 'ignored' | 'unverified';

type ContentRole = 'specifications' | 'ordering' | 'downloads';
interface BlockShape { section: string[]; kind: ObservedBlock['kind']; row_labels: string[]; link_labels: string[] }

interface SampleContribution {
  /** Positively accepted content blocks, keyed by exact observed content shape. */
  shapes: Map<string, BlockShape & { role: ContentRole }>;
  /** Positively judged non-content blocks, also keyed by exact observed shape. */
  ignored: Map<string, BlockShape>;
  /** Eligible controls observed at any point in this sample, for per-template expectation. */
  seen: Map<string, { label: string; kind: ObservedControl['kind']; panel_heading: string; section: string[]; role: 'specifications' | 'downloads'; initial?: boolean; structure?: { path: ObservedNodeDescriptor[] } }>;
  signature: string;
  locator?: DetailRecipeV1['identity'];
  captures: SchemaObservationCapture[];
  mechanisms: { source: string; via: string }[];
}

/**
 * Shared per-target pipeline. Compile (judge, no recipe) asks fresh questions for every newly
 * observed control and block shape after each reveal; nothing inherits a role from a parent or
 * from matching text. Replay (recipe, no judge) is deterministic: only the recipe's declared
 * reveals and sections are trusted. A reveal that changes the document or the product discards
 * everything collected for the target.
 */
async function runTarget(
  page: Page,
  target: DetailTarget,
  opts: { revealTimeoutMs: number; judge?: Judge; recipe?: DetailRecipe; v2?: boolean; artifacts?: RunArtifacts },
): Promise<{ result: DetailResult; contribution?: SampleContribution; evidence: ObservationEvidence[] }> {
  const issues: DetailIssue[] = [];
  const reveals: DetailResult['reveals'] = [];
  const evidence: ObservationEvidence[] = [];
  const result: DetailResult = {
    target,
    identity: 'unverified',
    status: 'error',
    values: {},
    downloads: [],
    observed_codes: [],
    issues,
    reveals,
  };
  const fail = (status: DetailStatus, reason: string, message?: string): { result: DetailResult; contribution?: SampleContribution; evidence: ObservationEvidence[] } => {
    result.status = status;
    issues.push({ reason, ...(message ? { message } : {}) });
    return { result, evidence };
  };

  try {
    const u = new URL(target.url);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('unsupported');
  } catch {
    return fail('error', 'invalid_url', target.url);
  }

  let badStatus: number | undefined;
  const onResponse = (r: import('playwright').Response) => {
    if (r.request().resourceType() === 'document' && r.status() >= 400) badStatus = r.status();
  };
  page.on('response', onResponse);
  try {
    const nav = await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: DETAIL_POLICY.navigationTimeoutMs }).catch((e: Error) => e);
    if (nav instanceof Error) return fail('error', 'navigation_failed', nav.message.slice(0, 160));
    const status = nav?.status() ?? badStatus;
    await settle(page).catch(() => undefined);
    result.final_url = page.url();

    // A redirect that leaves the target site or locale is a navigation change, even when the
    // landing page happens to carry the expected code.
    const from = new URL(target.url);
    const landed = new URL(page.url());
    if (landed.origin !== from.origin || siteKey(landed.href) !== siteKey(from.href)) {
      issues.push({ reason: 'navigation_changed', message: `${target.url} -> ${page.url()}` });
      result.status = 'navigation_changed';
      return { result, evidence };
    }

    const v2 = opts.v2 === true || opts.recipe?.version === 2;
    const readObs = async () => observeDetail(page, v2 ? 2 : 1).catch((e) => {
      issues.push({ reason: 'observe_failed', message: String(e).slice(0, 160) });
      result.status = 'partial';
      return undefined;
    });
    // Disclose data-affecting truncation on every observation; page-text clipping is summary only.
    const seenDiag = new Set<string>();
    const markDiagnostics = (o: DetailObservation) => {
      const dataCaps = o.truncated.filter((t) => t !== 'text');
      if (dataCaps.length && !seenDiag.has(dataCaps.join(','))) {
        seenDiag.add(dataCaps.join(','));
        issues.push({ reason: 'truncated', message: dataCaps.join(',') });
        result.status = 'partial';
      }
      if (o.truncated.includes('text') && !seenDiag.has('text')) {
        seenDiag.add('text');
        issues.push({ reason: 'text_clipped' });
      }
      if (o.unsupported_frames && !seenDiag.has('frames')) {
        seenDiag.add('frames');
        issues.push({ reason: 'unsupported_frame', message: `${o.unsupported_frames} content frame(s) not read` });
        result.status = 'partial';
      }
    };

    let obs = await readObs();
    if (!obs) { result.status = 'error'; return { result, evidence }; }
    const initialUrl = obs.url;
    await shot(page, opts.artifacts, 'initial', issues);
    markDiagnostics(obs);
    const health = pageHealth(status, obs);
    if (health === 'blocked') return fail('blocked', 'blocked_page', obs.text.slice(0, 200));
    if (health === 'no_content') return fail('no_content', 'no_main_content');

    // Consent, locale and newsletter prompts are answered on compile only, through the existing
    // gate helper: it owns the model call, presses at most bounded priority controls and reverts
    // site or locale changes itself. Replay never does this; the caller's context is expected to
    // already be cleared. Re-observe and re-check site and health before judging the product.
    if (opts.judge && !opts.recipe) {
      try {
        await clearGates(page, opts.judge);
      } catch (e) {
        issues.push({ reason: 'gate_error', message: String(e).slice(0, 160) });
        result.status = 'partial';
      }
      const after = await readObs();
      if (after) {
        markDiagnostics(after);
        obs = after;
        const landedNow = new URL(obs.url);
        if (landedNow.origin !== from.origin || siteKey(landedNow.href) !== siteKey(from.href)) {
          issues.push({ reason: 'navigation_changed', message: `${target.url} -> ${obs.url}` });
          result.status = 'navigation_changed';
          return { result, evidence };
        }
        const h2 = pageHealth(badStatus, obs);
        if (h2 === 'blocked') return fail('blocked', 'blocked_page', obs.text.slice(0, 200));
        if (h2 === 'no_content') return fail('no_content', 'no_main_content');
      }
    }

    result.observed_codes = [...new Set(obs.candidates.map((c) => normalizeDetailCode(c.value)).filter(Boolean))];

    // ---------- Identity ----------
    const recipeV1 = opts.recipe?.version === 1 ? opts.recipe : undefined;
    const recipeV2 = opts.recipe?.version === 2 ? opts.recipe : undefined;
    const v2CtlKey = (c: { label: string; kind: string }) => `${c.kind}|${c.label}`;
    const ctlKey = (c: { label: string; kind: string; panel_heading: string; section?: string[] }) => (recipeV2 ? v2CtlKey(c) : stableControlKey(c));
    const ctlPathMatch = (rule: ObservedNodeDescriptor[], seen: ObservedNodeDescriptor[]) => {
      if (!rule.length) return true;
      const depth = Math.min(rule.length, seen.length);
      if (depth < Math.min(3, rule.length)) return false;
      const rt = rule.slice(-depth);
      const bt = seen.slice(-depth);
      return rt.every((n, i) => n.tag === bt[i]!.tag && n.role === bt[i]!.role && n.itemprop === bt[i]!.itemprop
        && n.classes.every((c) => bt[i]!.classes.includes(c)));
    };
    const ctlMatch = (want: { key: string; structure?: { path: ObservedNodeDescriptor[] } }, c: ObservedControl) => {
      if (!recipeV2) return stableControlKey(c) === want.key;
      if (c.evidence?.excluded || v2CtlKey(c) !== want.key) return false;
      if (want.structure?.path?.length && !ctlPathMatch(want.structure.path, c.evidence?.path ?? [])) return false;
      return true;
    };
    const ctlStateCls = /^(active|show|showing|open|opened|expanded|collapsed|collapse|hidden|selected|disabled|current|focus|focused|on|off)$/i;
    const ctlStructure = (c: ObservedControl) => ({
      path: (c.evidence?.path ?? []).map((n) => ({
        tag: n.tag, role: n.role, itemprop: n.itemprop,
        classes: n.classes.filter((x) => !ctlStateCls.test(x) && !(target.expected_code && x.includes(target.expected_code))),
      })),
    });
    let locator: DetailRecipeV1['identity'];
    const mechanisms: { source: string; via: string }[] = [];
    const primaryRank = (c: { source?: string; via?: string }) =>
      (c.source === 'metadata' && /^(sku|productid)/i.test(c.via ?? ''))
        || (c.source === 'labelled' && DETAIL_PRIMARY_LABEL.test(c.via ?? '')) ? 0
        : c.source === 'metadata' && /^(mpn|model)/i.test(c.via ?? '') ? 1 : 2;
    const viaKey = (v?: string) => (v ?? '').normalize('NFC').replace(/[\s:：]+$/g, '').toLowerCase();
    const v2Recheck = (o: DetailObservation): DetailIdentity => {
      const mechs = recipeV2?.identity?.mechanisms ?? mechanisms;
      const vals = [...new Set(o.candidates
        .filter((c) => mechs.some((m) => m.source === c.source && viaKey(m.via) === viaKey(c.via)))
        .map((c) => normalizeDetailCode(c.value)).filter(Boolean))];
      if (vals.length > 1) return 'mismatch';
      return verifyDetailIdentity(target.expected_code, vals);
    };
    const checkIdentity = (o: DetailObservation): DetailIdentity =>
      recipeV2 || v2 ? v2Recheck(o) : recheckIdentity(o, locator, target.expected_code);
    if (!target.expected_code) {
      issues.push({ reason: 'missing_expected_code' });
      result.identity = 'unverified';
    } else if (opts.recipe) {
      locator = recipeV1?.identity;
      result.identity = checkIdentity(obs);
    } else if (obs.candidates.length && opts.judge) {
      if (v2) {
        const req = detailIdentityRequestV2({ url: obs.url, title: obs.title }, obs.candidates);
        const answers = await opts.judge.ask('detail-identity', req.state, req.questions);
        const primary = req.offered.filter(
          (c) => acceptedDetailRole(answers[`identity_${c.id}`], ['primary_code', 'descriptive_model', 'other']) === 'primary_code',
        );
        const bestRank = Math.min(...primary.map(primaryRank));
        const best = primary.filter((c) => primaryRank(c) === bestRank);
        const vals = [...new Set(best.map((c) => normalizeDetailCode(c.value)).filter(Boolean))];
        result.identity = vals.length > 1 ? 'mismatch' : verifyDetailIdentity(target.expected_code, best.map((c) => c.value));
        if (result.identity === 'matched') {
          for (const c of best) mechanisms.push({ source: c.source ?? '', via: c.via ?? '' });
        }
      } else {
        const req = detailIdentityRequest({ url: obs.url, title: obs.title }, obs.candidates);
        const answers = await opts.judge.ask('detail-identity', req.state, req.questions);
        const accepted = req.offered.filter(
          (c) => acceptedDetailRole(answers[`identity_${c.id}`], ['primary_code', 'other']) === 'primary_code',
        );
        result.identity = verifyDetailIdentity(target.expected_code, accepted.map((c) => c.value));
        const first = obs.candidates.find((c) => c.id === accepted[0]?.id);
        if (result.identity === 'matched' && first) {
          // Candidates already come from the primary header. Do not bind new locators to a
          // product-specific heading. Existing recipes retain their section filter.
          locator = { source: first.source, via: first.via };
        }
      }
    }
    if (result.identity === 'mismatch') {
      return fail('identity_mismatch', 'wrong_product', `expected "${target.expected_code}", saw ${result.observed_codes.join(', ') || '(no codes)'}`);
    }
    if (result.identity !== 'matched') {
      return fail('identity_unverified', target.expected_code ? 'identity_unverified' : 'missing_expected_code');
    }

    // ---------- Roles ----------
    // Control roles are keyed by the stable control key; block roles by the exact observed
    // content shape, so two differently-labelled blocks in one section never share a role.
    const controlRoles = new Map<string, ControlRole>();
    const blockRoles = new Map<string, BlockRole>(); // exact content shape -> role
    const quarantined = new Set<string>(); // shapes whose role changed under our feet
    const shapeOf = (b: ObservedBlock): BlockShape => ({
      section: stabilizeSection(b.section, target.expected_code),
      kind: b.kind,
      row_labels: b.rows.map((r) => r.label),
      link_labels: b.links.map((l) => stableLinkLabel(l.label, target.expected_code)),
    });
    const contribution: SampleContribution = {
      shapes: new Map(), ignored: new Map(), seen: new Map(), captures: [], mechanisms,
      signature: templateSignature(obs.controls, locator), locator,
    };
    const knownFields = recipeV1 ? new Set(recipeV1.fields.map((f) => f.key)) : undefined;
    // Replay trust maps, declared per section+kind with the accepted label evidence.
    const declRoles = new Map<string, { role: ContentRole; rows: Set<string>; links: Set<string> }>();
    const ignRoles = new Map<string, { rows: Set<string>; links: Set<string> }>();
    if (recipeV1) {
      for (const s of recipeV1.sections) {
        const k = stableSectionKey(s);
        const d = declRoles.get(k) ?? { role: s.role, rows: new Set(), links: new Set() };
        d.role = s.role;
        for (const l of s.row_labels ?? []) d.rows.add(l);
        for (const l of s.link_labels ?? []) d.links.add(l);
        declRoles.set(k, d);
      }
      for (const s of recipeV1.ignored_sections ?? []) {
        const k = stableSectionKey(s);
        const d = ignRoles.get(k) ?? { rows: new Set(), links: new Set() };
        for (const l of s.row_labels ?? []) d.rows.add(l);
        for (const l of s.link_labels ?? []) d.links.add(l);
        ignRoles.set(k, d);
      }
    }
    const knownLinks = recipeV1
      ? new Set(recipeV1.sections.filter((s) => s.role === 'downloads').flatMap((s) => s.link_labels ?? []))
      : undefined;

    const roleForControl = (c: ObservedControl): ControlRole | undefined => controlRoles.get(stableControlKey(c));
    const roleForBlock = (b: ObservedBlock): BlockRole | undefined => {
      if (!opts.recipe) {
        const key = blockContentKey(b, target.expected_code);
        return quarantined.has(key) ? 'unverified' : blockRoles.get(key);
      }
      const sec = stabilizeSection(b.section, target.expected_code);
      const k = stableSectionKey({ section: sec, kind: b.kind });
      const shape = shapeOf(b);
      const overlaps = (r: Set<string>, l: Set<string>) =>
        shape.row_labels.some((x) => r.has(x)) || shape.link_labels.some((x) => l.has(x));
      const decl = declRoles.get(k);
      if (decl && overlaps(decl.rows, decl.links)) return decl.role;
      const ign = ignRoles.get(k);
      if (ign && overlaps(ign.rows, ign.links)) return 'ignored';
      return undefined;
    };

    /** Ask Jev once per newly observed control or block shape within this sample. */
    const contentAsk = async (o: DetailObservation) => {
      if (!opts.judge || opts.recipe) return;
      const freshControls = o.controls.filter((c) => !controlRoles.has(stableControlKey(c)));
      const freshBlocks = o.blocks.filter((b) => !blockRoles.has(blockContentKey(b, target.expected_code)) && !quarantined.has(blockContentKey(b, target.expected_code)));
      if (!freshControls.length && !freshBlocks.length) return;
      const req = detailContentRequest({ url: o.url, title: o.title },
        freshControls as DetailControlEvidence[], freshBlocks as DetailBlockEvidence[]);
      const answers = await opts.judge.ask('detail-content', req.state, req.questions);
      for (const c of req.offeredControls) {
        const full = freshControls.find((x) => x.id === c.id)!;
        const role = acceptedDetailRole(answers[`control_${c.id}`], Object.keys(DETAIL_CONTROL_ROLES));
        if (role === 'specifications' || role === 'downloads') controlRoles.set(stableControlKey(full), role);
        else if (role === 'other') controlRoles.set(stableControlKey(full), 'other');
        else {
          controlRoles.set(stableControlKey(full), 'unverified');
          issues.push({ reason: 'role_unverified', message: `control "${full.label}" (${full.kind})` });
          result.status = 'partial';
        }
      }
      for (const b of req.offeredBlocks) {
        const full = freshBlocks.find((x) => x.id === b.id)!;
        const cKey = blockContentKey(full, target.expected_code);
        const shape = shapeOf(full);
        const role = acceptedDetailRole(answers[`block_${b.id}`], Object.keys(DETAIL_BLOCK_ROLES));
        let next: BlockRole;
        if (role === 'specifications' || role === 'ordering' || role === 'downloads') next = role;
        else if (role) next = 'ignored';
        else next = 'unverified';
        const prior = blockRoles.get(cKey);
        if (prior && prior !== next && prior !== 'unverified') {
          // A re-judged shape flipped role: quarantine it and drop anything it contributed.
          quarantined.add(cKey);
          blockRoles.delete(cKey);
          contribution.shapes.delete(cKey);
          contribution.ignored.delete(cKey);
          clearBlock(full, target.expected_code, collected);
          issues.push({ reason: 'role_changed', message: `block in ${JSON.stringify(shape.section)} (${full.kind}): ${prior} -> ${next}` });
          result.status = 'partial';
          continue;
        }
        blockRoles.set(cKey, next);
        if (next === 'specifications' || next === 'ordering' || next === 'downloads') {
          contribution.shapes.set(cKey, { ...shape, role: next });
          contribution.ignored.delete(cKey);
        } else if (next === 'ignored') {
          if (!contribution.shapes.has(cKey)) contribution.ignored.set(cKey, shape);
        } else {
          issues.push({ reason: 'role_unverified', message: `block in ${JSON.stringify(shape.section)} (${full.kind})` });
          result.status = 'partial';
        }
      }
    };

    const collected: Collected = { values: {}, downloads: new Map(), issues, conflicts: new Set(), drift: new Set() };
    const collected2 = {
      sources: new Map<string, NonNullable<DetailResult['field_sources']>[string]>(),
      unmapped: [] as NonNullable<DetailResult['unmapped_fields']>,
      warnings: [] as DetailIssue[],
      inspected: new Set<string>(),
      bindings: new Set<string>(),
      ambiguous: new Set<string>(),
      expectedReveals: [] as NonNullable<NonNullable<DetailRecipe['reveals']>>,
    };
    const collectPhase = (o: DetailObservation, phase: string) => {
      if (recipeV2) {
        const m = matchDetailSchema(recipeV2, o, phase, target.url, target.expected_code);
        for (const k of m.inspected_regions) collected2.inspected.add(k);
        for (const k of m.inspected_bindings) collected2.bindings.add(k);
        for (const k of m.ambiguous) collected2.ambiguous.add(k);
        for (const [k, recs] of Object.entries(m.field_sources)) {
          const cur = collected2.sources.get(k) ?? [];
          for (const r of recs) if (!cur.some((x) => x.binding_id === r.binding_id && x.label === r.label && x.value === r.value && x.section.join('>') === r.section.join('>'))) cur.push(r);
          collected2.sources.set(k, cur);
        }
        collected2.unmapped.push(...m.unmapped_fields);
        collected2.warnings.push(...m.warnings);
        for (const i of m.issues) {
          issues.push(i);
          result.status = 'partial';
        }
        for (const d of m.downloads) {
          if (!collected.downloads.has(d.url)) collected.downloads.set(d.url, d);
        }
        return;
      }
      if (v2) {
        contribution.captures.push({
          phase, url: o.url, obs: o,
          control_roles: Object.fromEntries(o.controls.map((c) => [c.id, controlRoles.get(stableControlKey(c)) ?? 'unverified'])),
          block_roles: Object.fromEntries(o.blocks.map((b) => [b.id, blockRoles.get(blockContentKey(b, target.expected_code)) ?? 'unverified'])),
        });
        return;
      }
      collect(o);
    };
    const collect = (o: DetailObservation) => {
      for (const block of o.blocks) {
        const role = roleForBlock(block);
        if (role === 'specifications' || role === 'ordering' || role === 'downloads') {
          const had = collected.issues.length;
          collectBlock(block, role, target.expected_code, collected, knownFields, knownLinks);
          if (collected.issues.length > had) result.status = 'partial';
        } else if (role === undefined) {
          // On replay an undeclared or disjoint block is drift; on compile it only happens when
          // the observation changed between ask and collect.
          const dk = `block:${stableSectionKey({ section: stabilizeSection(block.section, target.expected_code), kind: block.kind })}`;
          if (!collected.drift.has(dk)) {
            collected.drift.add(dk);
            issues.push({
              reason: opts.recipe ? 'schema_drift' : 'unjudged_block',
              message: `block in ${JSON.stringify(stabilizeSection(block.section, target.expected_code))} (${block.kind})`,
            });
            result.status = 'partial';
          }
        }
      }
    };

    const recordEvidence = (phase: string, o: DetailObservation) => {
      evidence.push({
        phase,
        url: o.url,
        candidates: o.candidates.slice(0, DETAIL_POLICY.maxIdentityCandidates),
        controls: o.controls.slice(0, DETAIL_POLICY.maxControls).map((c) => ({ ...c, role: roleForControl(c) })),
        blocks: o.blocks.slice(0, DETAIL_POLICY.maxBlocks).map((b) => ({
          id: b.id, section: b.section, kind: b.kind, total_rows: b.total_rows,
          role: roleForBlock(b), row_labels: b.rows.map((r) => r.label).slice(0, 8), link_labels: b.links.map((l) => l.label).slice(0, 8),
        })),
        truncated: [...o.truncated],
        unsupported_frames: o.unsupported_frames,
        fingerprint: o.fingerprint,
      });
    };

    // ---------- Reveals ----------
    // Re-observe inside each reveal so the clicked element is always a fresh, exactly-matched id.
    const visited = new Set<string>();
    const navigationFailed = { v: false };
    let revealCount = 0;

    // Page-health after any observation that feeds asks or collection: an error page or lost
    // main content discards everything collected so far and ends the sample.
    const healthFailed = { v: false };
    const healthCheck = (o: DetailObservation): boolean => {
      const h = pageHealth(badStatus, o);
      if (h === 'ok') return false;
      collected.values = {};
      collected.downloads.clear();
      collected2.sources.clear();
      collected2.unmapped = [];
      collected2.warnings = [];
      issues.push({ reason: h === 'blocked' ? 'blocked_page' : 'no_main_content', message: o.text.slice(0, 200) });
      result.status = h;
      healthFailed.v = true;
      return true;
    };

    /** Observe fresh, require exactly one unexpanded match for the stable key, click its fresh id. */
    const revealOne = async (
      want: { key: string; label: string; kind: string; structure?: { path: ObservedNodeDescriptor[] } },
      onOutcome: (outcome: 'clicked' | 'missing' | 'ambiguous' | 'expanded' | 'failed' | 'navigated', o?: DetailObservation) => void,
    ) => {
      const before = await readObs();
      if (!before) { onOutcome('failed'); return; }
      if (healthCheck(before)) { onOutcome('failed'); return; }
      // The document and the verified product must still be the ones we started on.
      if (!sameDetailDocument(initialUrl, before.url)) {
        issues.push({ reason: 'navigation_changed', message: `${initialUrl} -> ${before.url}` });
        navigationFailed.v = true;
        onOutcome('navigated');
        return;
      }
      const preIdentity = checkIdentity(before);
      if (preIdentity !== 'matched') {
        issues.push({ reason: 'product_changed', message: `identity before "${want.label}": ${preIdentity}` });
        result.identity = preIdentity;
        navigationFailed.v = true;
        onOutcome('navigated');
        return;
      }
      const all = before.controls.filter((c) => ctlMatch(want, c));
      const matches = all.filter((c) => !c.expanded);
      if (all.length !== 1 || matches.length !== 1) {
        reveals.push({ label: want.label, kind: want.kind, before_url: before.url, after_url: before.url, changed: false });
        onOutcome(!all.length ? 'missing' : all.length === 1 && !matches.length ? 'expanded' : 'ambiguous');
        return;
      }
      const control = matches[0]!;
      const beforeFp = before.fingerprint;
      const ctl = page.locator(`[data-jc-detail-control="${control.id}"]`);
      let error: string | undefined;
      try {
        if ((await ctl.count()) !== 1) throw new Error(`control id ${control.id} resolved ${await ctl.count()} elements`);
        // The click's actionability budget is bounded on its own; the reveal timeout governs
        // how long we watch the page afterwards, not how long Playwright may take to click.
        await ctl.click({ timeout: Math.min(5_000, opts.revealTimeoutMs + 2_000) });
      } catch (e) {
        error = e instanceof Error ? e.message.split('\n')[0]!.slice(0, 160) : String(e);
      }
      result.final_url = page.url();
      // The observation budget starts when the click returns, so a delayed navigation gets the
      // full revealTimeoutMs regardless of how long actionability took.
      const clickDeadline = Date.now() + opts.revealTimeoutMs;
      while (Date.now() < clickDeadline) await page.waitForTimeout(Math.min(100, clickDeadline - Date.now()));
      const after_url = page.url();
      result.final_url = after_url;
      reveals.push({ label: control.label, kind: control.kind, before_url: before.url, after_url, changed: false });
      if (!sameDetailDocument(before.url, after_url)) {
        issues.push({ reason: 'navigation_changed', message: `${before.url} -> ${after_url}` });
        navigationFailed.v = true;
        onOutcome('navigated');
        return;
      }
      if (error) {
        issues.push({ reason: 'click_failed', message: `"${control.label}": ${error}` });
        result.status = 'partial';
        onOutcome('failed');
        return;
      }
      const next = await readObs();
      if (!next) { onOutcome('failed'); return; }
      reveals[reveals.length - 1]!.changed = next.fingerprint !== beforeFp;
      markDiagnostics(next);
      result.final_url = next.url;
      result.observed_codes = [...new Set(next.candidates.map((c) => normalizeDetailCode(c.value)).filter(Boolean))];
      // Navigation already checked above; next the page health, then identity.
      if (healthCheck(next)) { onOutcome('failed'); return; }
      const identity = checkIdentity(next);
      if (identity !== 'matched') {
        issues.push({ reason: 'product_changed', message: `identity after "${control.label}": ${identity}` });
        result.identity = identity;
        navigationFailed.v = true;
        onOutcome('navigated');
        return;
      }
      await contentAsk(next);
      collectPhase(next, `reveal:${control.label}`);
      recordEvidence(`reveal:${control.label}`, next);
      revealCount += 1;
      if (opts.artifacts) await shot(page, opts.artifacts, `reveal-${revealCount}`, issues);
      onOutcome('clicked', next);
    };

    if (opts.recipe) {
      // Replay: only the recipe's declared reveals are clicked, deepest section first so a
      // sibling tab never hides a panel that still owes a reveal. Each is re-matched on a fresh
      // observation; a missing required control or ambiguous match is reported, never guessed.
      const sig = recipeV2
        ? 'v2#' + [...new Set(obs.controls.map(v2CtlKey).filter((k) => new Set((recipeV2.reveals ?? []).map(v2CtlKey)).has(k)))].sort().join(';')
        : templateSignature(obs.controls, locator);
      const knownTemplate = !!opts.recipe.templates?.includes(sig);
      if (!knownTemplate) {
        issues.push({ reason: 'template_drift', message: `signature ${sig.slice(0, 160)}` });
        result.status = 'partial';
      }
      collectPhase(obs, 'initial');
      recordEvidence('initial', obs);
      const todo = opts.recipe.reveals.map((w) => ({
        want: w,
        key: ctlKey(w),
        required: !w.expected_on || w.expected_on.includes(sig),
        done: false,
      }));
      if (recipeV2) collected2.expectedReveals = todo.filter((t) => t.required).map((t) => t.want);
      for (let pass = 0; pass < DETAIL_POLICY.maxReveals && !navigationFailed.v && !healthFailed.v; pass++) {
        const o = await readObs();
        if (!o) break;
        const open = todo.filter((t) => !t.done).map((t) => ({
          t, found: o.controls.filter((c) => ctlMatch({ key: t.key, structure: (t.want as { structure?: { path: ObservedNodeDescriptor[] } }).structure }, c)),
        }));
        const clickable = open.filter((x) => x.found.length === 1 && !x.found[0]!.expanded)
          .sort((a, b) => (b.t.want.section?.length ?? 0) - (a.t.want.section?.length ?? 0));
        const next = clickable[0];
        if (!next) break;
        next.t.done = true;
        await revealOne({ key: next.t.key, label: next.t.want.label, kind: next.t.want.kind, structure: (next.t.want as { structure?: { path: ObservedNodeDescriptor[] } }).structure }, () => undefined);
      }
      if (!navigationFailed.v && !healthFailed.v) {
        const last = await readObs();
        for (const t of todo) {
          if (t.done || !t.required || !knownTemplate) continue;
          const found = last ? last.controls.filter((c) => ctlMatch({ key: t.key, structure: (t.want as { structure?: { path: ObservedNodeDescriptor[] } }).structure }, c)) : [];
          if (found.length > 1) {
            issues.push({ reason: 'reveal_ambiguous', message: `${t.want.kind} "${t.want.label}"` });
            result.status = 'partial';
          } else if (!found.length) {
            issues.push({ reason: 'reveal_missing', message: `${t.want.kind} "${t.want.label}"` });
            result.status = 'partial';
          }
        }
        if (recipeV2 && last) {
          const auxTexts = new Set(recipeV2.ignored.map((i) => i.text));
          const auxControl = /accessor|related|similar|spare|recommend|compare|compatible|alternative/i;
          for (const c of last.controls) {
            if (c.expanded || c.evidence?.excluded || todo.some((t) => ctlMatch({ key: t.key, structure: (t.want as { structure?: { path: ObservedNodeDescriptor[] } }).structure }, c))) continue;
            if ((c.section ?? []).some((t) => auxTexts.has(t) || auxControl.test(t)) || auxControl.test(c.label)) {
              collected2.warnings.push({ reason: 'auxiliary_change', message: `${c.kind} "${c.label}"` });
            } else {
              issues.push({ reason: 'unknown_control', message: `${c.kind} "${c.label}"` });
              result.status = 'partial';
            }
          }
        }
      }
    } else {
      await contentAsk(obs);
      collectPhase(obs, 'initial');
      recordEvidence('initial', obs);
      for (let n = 0; n < DETAIL_POLICY.maxReveals && !navigationFailed.v && !healthFailed.v; n++) {
        const current = await readObs();
        if (!current) break;
        markDiagnostics(current);
        if (healthCheck(current)) break;
        await contentAsk(current);
        const eligible = current.controls.filter((c) => {
          if (c.expanded || visited.has(stableControlKey(c)) || (v2 && c.evidence?.excluded)) return false;
          const role = roleForControl(c);
          return role === 'specifications' || role === 'downloads';
        });
        // Duplicate stable keys are never guessed at; they are reported, skipped and kept out
        // of the recipe so replay is never asked to resolve them.
        const counts = new Map<string, number>();
        for (const c of eligible) counts.set(stableControlKey(c), (counts.get(stableControlKey(c)) ?? 0) + 1);
        const dupes = new Set<string>();
        for (const [k, n] of counts) {
          if (n > 1 && !visited.has(k)) {
            dupes.add(k);
            visited.add(k);
            issues.push({ reason: 'reveal_ambiguous', message: `${k.split('|')[0]} "${k.split('|')[1]}" x${n}` });
            result.status = 'partial';
          }
        }
        for (const c of eligible) {
          if (dupes.has(stableControlKey(c))) continue;
          const role = roleForControl(c) as 'specifications' | 'downloads';
          const key = v2 ? v2CtlKey(c) : stableControlKey(c);
          const prior = contribution.seen.get(key);
          contribution.seen.set(key, {
            label: c.label, kind: c.kind, panel_heading: c.panel_heading, section: c.section, role,
            initial: prior?.initial ?? (n === 0),
            ...(v2 ? { structure: prior?.structure ?? ctlStructure(c) } : {}),
          });
        }
        // Depth first: a sibling tab can hide the panel a nested control lives in, so controls
        // deeper in the section path go before siblings.
        const control = [...eligible].filter((c) => !dupes.has(stableControlKey(c)))
          .sort((a, b) => b.section.length - a.section.length)[0];
        if (!control) break;
        visited.add(stableControlKey(control));
        await revealOne({ key: stableControlKey(control), label: control.label, kind: control.kind }, (outcome) => {
          if (outcome === 'missing' || outcome === 'ambiguous') {
            issues.push({ reason: outcome === 'ambiguous' ? 'reveal_ambiguous' : 'control_vanished', message: `${control.kind} "${control.label}"` });
            result.status = 'partial';
          }
        });
      }
      if (!navigationFailed.v && !healthFailed.v) {
        // If the cap stopped the loop while eligible work remained, disclose it.
        const last = await readObs();
        if (last) {
          await contentAsk(last);
          const remaining = last.controls.filter((c) => {
            if (c.expanded || visited.has(stableControlKey(c))) return false;
            const role = roleForControl(c);
            return role === 'specifications' || role === 'downloads';
          });
          for (const c of remaining) {
            const role = roleForControl(c) as 'specifications' | 'downloads';
            const key = v2 ? v2CtlKey(c) : stableControlKey(c);
            const prior = contribution.seen.get(key);
            if (!prior?.initial) {
              contribution.seen.set(key, {
                label: c.label, kind: c.kind, panel_heading: c.panel_heading, section: c.section, role,
                initial: prior?.initial ?? false,
                ...(v2 ? { structure: prior?.structure ?? ctlStructure(c) } : {}),
              });
            }
          }
          if (remaining.length && revealCount >= DETAIL_POLICY.maxReveals) {
            issues.push({ reason: 'reveal_limit', message: `${remaining.length} eligible control(s) left after ${DETAIL_POLICY.maxReveals} reveals` });
            result.status = 'partial';
          }
        }
      }
    }

    if (navigationFailed.v || healthFailed.v) {
      if (navigationFailed.v) result.status = 'navigation_changed';
      result.values = {};
      result.downloads = [];
      delete result.field_sources;
      delete result.unmapped_fields;
      return { result, evidence };
    }

    result.values = collected.values;
    result.downloads = [...collected.downloads.values()];
    if (recipeV2) {
      for (const field of recipeV2.fields) {
        const recs = collected2.sources.get(field.key) ?? [];
        if (!recs.length) {
          if (field.observed_all && field.sources.some((r) => collected2.bindings.has(r.id))) {
            issues.push({ reason: 'field_missing', message: field.label });
            result.status = 'partial';
          }
          continue;
        }
        const resolved = resolveFieldValue(recs);
        if (resolved.value !== undefined && !collected2.ambiguous.has(field.key)) result.values[field.key] = resolved.value;
        else if (resolved.conflicts?.length) {
          issues.push({ reason: 'value_conflict', message: `${field.label}: ${(resolved.conflicts ?? []).join(' | ')}` });
          result.status = 'partial';
        }
      }
      for (const region of recipeV2.regions) {
        if (region.role === 'downloads') continue;
        const required = region.observed_all === true
          || collected2.expectedReveals.some((w) => region.section.includes(w.label) || region.headings.includes(w.label) || region.panel_labels.includes(w.label));
        if (!required) continue;
        if (!collected2.inspected.has(region.id ?? region.section.join('>'))) {
          issues.push({ reason: 'region_missing', message: region.section.join('>') || '(structural)' });
          result.status = 'partial';
        }
      }
      result.field_sources = Object.fromEntries(collected2.sources);
      if (collected2.unmapped.length) result.unmapped_fields = collected2.unmapped;
      if (collected2.warnings.length) result.warnings = collected2.warnings;
      result.recipe_version = 2;
    }
    if (collected.conflicts.size) result.status = 'partial';
    if (!Object.keys(result.values).length && !result.downloads.length && result.status === 'error' && !(v2 && !opts.recipe)) {
      issues.push({ reason: 'empty_content' });
      result.status = 'partial';
    }
    if (issues.some((i) => i.reason === 'artifact_error')) result.status = 'partial';
    if (result.status === 'error') result.status = 'ok';
    return { result, contribution: opts.recipe ? undefined : contribution, evidence };
  } catch (e) {
    result.status = 'error';
    issues.push({ reason: 'error', message: e instanceof Error ? e.message.slice(0, 160) : String(e) });
    return { result, evidence };
  } finally {
    page.off('response', onResponse);
  }
}

// ---------- Compilation ----------

/**
 * Compile a detail recipe from a few sampled product detail pages. Opens and closes one page per
 * target on the caller's context; never touches the caller's own pages.
 */
export interface DetailCompilationV1 extends Omit<DetailCompilation, 'recipe'> {
  recipe: DetailRecipeV1;
}

export async function compileDetailRecipe(
  context: BrowserContext,
  judge: Judge,
  targets: DetailTarget[],
  options: CompileOptions & { recipeVersion: 1 },
): Promise<DetailCompilationV1>;
export async function compileDetailRecipe(
  context: BrowserContext,
  judge: Judge,
  targets: DetailTarget[],
  options?: CompileOptions,
): Promise<DetailCompilation>;
export async function compileDetailRecipe(
  context: BrowserContext,
  judge: Judge,
  targets: DetailTarget[],
  options: CompileOptions = {},
): Promise<DetailCompilation> {
  const recipeVersion = options.recipeVersion ?? 2;
  const emptyRecipe = (): DetailRecipe => recipeVersion === 2
    ? {
      version: 2, recipe_version: 2, sample_urls: [],
      learning: { state: 'unusable', attempted: [], verified: [], inspected: [] },
      regions: [], fields: [], reveals: [], ignored: [], diagnostics: [],
    }
    : { version: 1, sample_urls: [], reveals: [], sections: [], fields: [] };
  const outDir = options.outDir;
  if (outDir) mkdirSync(outDir, { recursive: true });
  // Validate every input before any page is opened or question asked: invalid URLs are
  // reported, a URL carrying conflicting expected codes is reported and dropped, and a
  // multi-origin batch is refused outright because a recipe must describe one site.
  const issues: DetailIssue[] = [];
  const byUrl = new Map<string, DetailTarget[]>();
  for (const t of targets) {
    try {
      const u = new URL(t.url);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('unsupported');
      u.hash = '';
      const k = u.href;
      byUrl.set(k, [...(byUrl.get(k) ?? []), t]);
    } catch {
      issues.push({ reason: 'invalid_target', message: t.url.slice(0, 160) });
    }
  }
  const valid: DetailTarget[] = [];
  for (const [k, group] of byUrl) {
    if (new Set(group.map((g) => g.expected_code ?? '')).size > 1) {
      issues.push({ reason: 'shared_url', message: `${k} carries ${new Set(group.map((g) => g.expected_code)).size} conflicting codes` });
      continue;
    }
    valid.push(group[0]!);
  }
  const origins = new Set(valid.map((t) => new URL(t.url).origin));
  if (origins.size > 1) {
    return { recipe: emptyRecipe(), samples: [], issues: [...issues, { reason: 'multi_origin', message: [...origins].join(', ') }] };
  }
  const sampled = sampleDetailTargets(valid);
  const samples: DetailResult[] = [];
  const contributions: (SampleContribution | undefined)[] = [];
  const evidenceOf: ObservationEvidence[][] = [];
  const callsBefore = judge.trace.length;
  const pause = options.pauseMs ?? DETAIL_POLICY.pauseMs;

  for (const [i, target] of sampled.entries()) {
    if (i > 0 && pause > 0) await new Promise((r) => setTimeout(r, pause));
    const page = await context.newPage();
    let out: Awaited<ReturnType<typeof runTarget>>;
    try {
      out = await runTarget(page, target, {
        revealTimeoutMs: options.revealTimeoutMs ?? DETAIL_POLICY.revealTimeoutMs,
        judge,
        v2: recipeVersion === 2,
        artifacts: outDir ? { dir: outDir, index: i } : undefined,
      });
    } catch (e) {
      out = {
        result: {
          target, identity: 'unverified', status: 'error', values: {}, downloads: [],
          observed_codes: [], issues: [{ reason: 'error', message: e instanceof Error ? e.message.slice(0, 160) : String(e) }], reveals: [],
        },
        evidence: [],
      };
    } finally {
      await page.close().catch(() => undefined);
    }
    samples.push(out.result);
    contributions.push(out.contribution);
    evidenceOf.push(out.evidence);
    if (outDir && recipeVersion === 1) {
      try {
        writeFileSync(join(outDir, `sample-${i}.json`), JSON.stringify(out.result, null, 2));
        writeFileSync(join(outDir, `sample-${i}-evidence.json`), JSON.stringify(out.evidence, null, 2));
      } catch (e) {
        issues.push({ reason: 'artifact_error', message: `sample-${i}: ${String(e).slice(0, 120)}` });
      }
    }
  }

  if (recipeVersion === 2) {
    const all2 = samples.map((s, i) => ({ s, c: contributions[i], i, ev: evidenceOf[i] }));
    const usable2 = all2
      .filter((x): x is typeof x & { c: SampleContribution } => !!x.c && x.s.identity === 'matched' && ['ok', 'partial'].includes(x.s.status));
    const learned = await learnDetailSchema(all2.map(({ s, c }) => ({
      url: s.target.url, expected_code: s.target.expected_code,
      identity: s.identity, status: s.status, issues: s.issues,
      mechanisms: c?.mechanisms ?? [], captures: c?.captures ?? [], signature: c?.signature ?? '',
      seen: c ? [...c.seen.entries()].map(([key, v]) => ({ key, ...v })) : [],
    })), judge);
    issues.push(...learned.recipe.diagnostics.filter((d) => !issues.some((x) => x.reason === d.reason && x.message === d.message)));
    for (const { s, c } of usable2) {
      const merged = new Map<string, NonNullable<DetailResult['field_sources']>[string]>();
      const unmapped: NonNullable<DetailResult['unmapped_fields']> = [];
      const warnings: DetailIssue[] = [];
      const docs: { label: string; url: string; section: string[] }[] = [];
      for (const cap of c.captures) {
        const m = matchDetailSchema(learned.recipe, cap.obs, cap.phase, s.target.url, s.target.expected_code);
        for (const [k, recs] of Object.entries(m.field_sources)) {
          const cur = merged.get(k) ?? [];
          for (const r of recs) if (!cur.some((x) => x.binding_id === r.binding_id && x.label === r.label && x.value === r.value && x.section.join('>') === r.section.join('>'))) cur.push(r);
          merged.set(k, cur);
        }
        unmapped.push(...m.unmapped_fields);
        warnings.push(...m.warnings);
        docs.push(...m.downloads);
        for (const i of m.issues) if (!s.issues.some((x) => x.reason === i.reason && x.message === i.message)) s.issues.push(i);
      }
      const values: Record<string, string> = {};
      const ambiguousKeys = new Set<string>();
      for (const cap of c.captures) {
        for (const k of matchDetailSchema(learned.recipe, cap.obs, cap.phase, s.target.url, s.target.expected_code).ambiguous) ambiguousKeys.add(k);
      }
      for (const field of learned.recipe.fields) {
        const recs = merged.get(field.key) ?? [];
        if (!recs.length || ambiguousKeys.has(field.key)) continue;
        const resolved = resolveFieldValue(recs);
        if (resolved.value !== undefined) values[field.key] = resolved.value;
        else s.issues.push({ reason: 'value_conflict', message: `${field.label}: ${(resolved.conflicts ?? []).join(' | ')}` });
      }
      s.values = values;
      s.field_sources = Object.fromEntries(merged);
      if (unmapped.length) s.unmapped_fields = unmapped;
      if (warnings.length) s.warnings = warnings;
      s.recipe_version = 2;
      const docSeen = new Set<string>();
      s.downloads = docs.filter((d) => !docSeen.has(d.url) && !!docSeen.add(d.url));
      if (s.issues.some((i) => ['source_conflict', 'value_conflict', 'schema_unmapped', 'source_ambiguous', 'region_ambiguous'].includes(i.reason)) && s.status === 'ok') s.status = 'partial';
      if (s.status === 'error' && (Object.keys(s.values).length || s.downloads.length)) s.status = 'partial';
    }
    if (outDir) {
      try {
        for (const [i, s] of samples.entries()) {
          writeFileSync(join(outDir, `sample-${i}.json`), JSON.stringify(s, null, 2));
          writeFileSync(join(outDir, `sample-${i}-evidence.json`), JSON.stringify(evidenceOf[i] ?? [], null, 2));
        }
        writeFileSync(join(outDir, 'recipe.json'), JSON.stringify(learned.recipe, null, 2));
        writeFileSync(join(outDir, 'schema.json'), JSON.stringify(learned.learned, null, 2));
        writeFileSync(join(outDir, 'samples.json'), JSON.stringify(samples.map((s) => ({
          url: s.target.url, identity: s.identity, status: s.status, final_url: s.final_url,
          observed_codes: s.observed_codes, values: s.values, field_sources: s.field_sources,
          unmapped_fields: s.unmapped_fields, downloads: s.downloads, issues: s.issues, reveals: s.reveals,
        })), null, 2));
        writeFileSync(join(outDir, 'trace.json'), JSON.stringify(judge.trace.slice(callsBefore), null, 2));
      } catch (e) {
        issues.push({ reason: 'artifact_error', message: `recipe: ${String(e).slice(0, 120)}` });
      }
    }
    return { recipe: learned.recipe, samples, issues };
  }

  // Union over identity-matched, content-bearing samples only.
  const usable = samples.map((s, i) => ({ s, c: contributions[i] })).filter((x): x is { s: DetailResult; c: SampleContribution } => !!x.c && x.s.identity === 'matched' && ['ok', 'partial'].includes(x.s.status));
  const denom = usable.length || 1;
  const fields = new Map<string, { label: string; section: string[]; count: number }>();
  // Accepted and ignored blocks merge by exact observed shape, then union into section
  // declarations with the label evidence kept for replay matching.
  const shapes = new Map<string, BlockShape & { role: ContentRole }>();
  const ignored = new Map<string, BlockShape>();
  // A shape that ever produced a contradictory judgment is tombstoned: later samples can never
  // reintroduce it as an accepted or ignored declaration.
  const tombstoned = new Set<string>();
  const reveals = new Map<string, { label: string; kind: ObservedControl['kind']; panel_heading: string; role: 'specifications' | 'downloads'; section?: string[]; expected_on: string[] }>();
  const templates = new Set<string>();
  for (const { s, c } of usable) {
    templates.add(c.signature);
    for (const [k, v] of Object.entries(s.values)) {
      const parsed = JSON.parse(k) as string[];
      const label = parsed[parsed.length - 1]!;
      const section = parsed.slice(0, -1);
      const f = fields.get(k) ?? { label, section, count: 0 };
      f.count += 1;
      fields.set(k, f);
    }
    for (const [k, v] of c.shapes) {
      if (tombstoned.has(k)) continue;
      const prior = shapes.get(k);
      // Contradictory roles for one observed shape, or a shape another sample positively
      // ignored: drop both sides, tombstone it and report the conflict.
      if ((prior && prior.role !== v.role) || ignored.has(k)) {
        const other = prior ? prior.role : 'ignored';
        shapes.delete(k);
        ignored.delete(k);
        tombstoned.add(k);
        issues.push({ reason: 'role_conflict', message: `${k.slice(0, 120)}: ${other} vs ${v.role}` });
        continue;
      }
      if (prior) {
        prior.row_labels = [...new Set([...prior.row_labels, ...v.row_labels])];
        prior.link_labels = [...new Set([...prior.link_labels, ...v.link_labels])];
      } else shapes.set(k, { ...v });
    }
    for (const [k, v] of c.ignored) {
      if (tombstoned.has(k)) continue;
      if (shapes.has(k)) {
        // A shape another sample accepted was positively judged non-content here: conflict.
        shapes.delete(k);
        tombstoned.add(k);
        issues.push({ reason: 'role_conflict', message: `${k.slice(0, 120)}: accepted vs ignored` });
        continue;
      }
      const prior = ignored.get(k);
      if (prior) {
        prior.row_labels = [...new Set([...prior.row_labels, ...v.row_labels])];
        prior.link_labels = [...new Set([...prior.link_labels, ...v.link_labels])];
      } else ignored.set(k, { ...v });
    }
    for (const [k, v] of c.seen) {
      const prior = reveals.get(k);
      if (prior) {
        if (!prior.expected_on.includes(c.signature)) prior.expected_on.push(c.signature);
      } else {
        reveals.set(k, { ...v, expected_on: [c.signature] });
      }
    }
  }
  const bySection = new Map<string, { section: string[]; kind: ObservedBlock['kind']; role: ContentRole; row_labels: Set<string>; link_labels: Set<string> }>();
  for (const v of shapes.values()) {
    const k = stableSectionKey(v);
    const d = bySection.get(k);
    if (d && d.role !== v.role) {
      issues.push({ reason: 'role_conflict', message: `${k}: ${d.role} vs ${v.role}` });
      continue;
    }
    const e = d ?? { section: v.section, kind: v.kind, role: v.role, row_labels: new Set(), link_labels: new Set() };
    for (const l of v.row_labels) e.row_labels.add(l);
    for (const l of v.link_labels) e.link_labels.add(l);
    bySection.set(k, e);
  }
  const ignBySection = new Map<string, { section: string[]; kind: ObservedBlock['kind']; row_labels: Set<string>; link_labels: Set<string> }>();
  for (const v of ignored.values()) {
    const k = stableSectionKey(v);
    // Ignored evidence coexists with accepted shapes of the same section+kind: replay checks the
    // accepted labels first, then this disjoint set, so neither overrides the other.
    const d = ignBySection.get(k) ?? { section: v.section, kind: v.kind, row_labels: new Set(), link_labels: new Set() };
    for (const l of v.row_labels) d.row_labels.add(l);
    for (const l of v.link_labels) d.link_labels.add(l);
    ignBySection.set(k, d);
  }
  // Fields unsupported by any surviving accepted declaration are dropped from the recipe.
  const declaredKeys = new Set<string>();
  for (const d of bySection.values()) {
    if (d.role === 'downloads') continue;
    for (const l of d.row_labels) declaredKeys.add(detailFieldKey(d.section, l.replace(/:\s*$/, '')));
  }
  for (const k of fields.keys()) if (!declaredKeys.has(k)) fields.delete(k);

  const firstLocator = usable.map(({ c }) => c.locator).find((l) => l);
  const recipe: DetailRecipe = {
    version: 1,
    sample_urls: usable.map(({ s }) => s.target.url),
    ...(firstLocator ? { identity: firstLocator } : {}),
    sections: [...bySection.values()].map((s) => ({ section: s.section, kind: s.kind, role: s.role, row_labels: [...s.row_labels], link_labels: [...s.link_labels] })),
    fields: [...fields.entries()].map(([key, f]) => ({
      key, label: f.label, section: f.section, sample_coverage: Math.round((f.count / denom) * 100) / 100,
    })),
    reveals: [...reveals.values()].map((r) => ({ label: r.label, kind: r.kind, panel_heading: r.panel_heading, role: r.role, section: r.section, expected_on: r.expected_on })),
    ...(ignBySection.size ? { ignored_sections: [...ignBySection.values()].map((s) => ({ section: s.section, kind: s.kind, row_labels: [...s.row_labels], link_labels: [...s.link_labels] })) } : {}),
    ...(templates.size ? { templates: [...templates] } : {}),
  };
  if (outDir) {
    try {
      writeFileSync(join(outDir, 'recipe.json'), JSON.stringify(recipe, null, 2));
      writeFileSync(join(outDir, 'samples.json'), JSON.stringify(samples.map((s) => ({
        url: s.target.url, identity: s.identity, status: s.status, final_url: s.final_url,
        observed_codes: s.observed_codes, values: s.values, downloads: s.downloads, issues: s.issues, reveals: s.reveals,
      })), null, 2));
      writeFileSync(join(outDir, 'trace.json'), JSON.stringify(judge.trace.slice(callsBefore), null, 2));
    } catch (e) {
      issues.push({ reason: 'artifact_error', message: `recipe: ${String(e).slice(0, 120)}` });
    }
  }
  return { recipe, samples, issues };
}

// ---------- Replay ----------

/**
 * Read one detail page with a compiled recipe. Deterministic: no Judge or SDK calls. Navigation
 * or identity changes discard everything collected.
 */
export async function readDetail(page: Page, recipe: DetailRecipe, target: DetailTarget, options: ReadOptions = {}): Promise<DetailResult> {
  const recipeVersion = (recipe as { version?: number }).version;
  if (recipeVersion !== 1 && recipeVersion !== 2) {
    return {
      target,
      identity: 'unverified',
      status: 'error',
      values: {},
      downloads: [],
      observed_codes: [],
      issues: [{ reason: 'unsupported_recipe_version', message: `recipe version ${String(recipeVersion)}` }],
      reveals: [],
    };
  }
  const { result } = await runTarget(page, target, {
    revealTimeoutMs: options.revealTimeoutMs ?? DETAIL_POLICY.revealTimeoutMs,
    recipe,
  });
  return result;
}
