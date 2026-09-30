// Run recon over every bench site and score page kind and main-item kind against bench/labels.json.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createJudge } from '../src/jev.js';
import { recon, type ReconReport } from '../src/recon.js';

// usage: npx tsx bench/recon.ts <suite> [site-id]   (suites live in bench/suites/<suite>.json)
type Label = { page_kind: string; acceptable_alternates: string[]; main_items: string; acceptable_items: string[]; gate?: string };
const [suiteName = 'finders', only] = process.argv.slice(2);
const suitePath = `bench/suites/${suiteName}.json`;
if (!existsSync(suitePath)) throw new Error(`no suite ${suitePath}`);
const { sites } = JSON.parse(readFileSync(suitePath, 'utf8')) as { sites: { id: string; url: string; label?: Label }[] };
const labels: Record<string, Label> = Object.fromEntries(sites.filter((s) => s.label).map((s) => [s.id, s.label!]));
const runDir = `artifacts/bench/${suiteName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
mkdirSync(runDir, { recursive: true });

// The crawl action a human label implies, using the same rule as interpretClassification.
const expectedNexts = (l: Label) => new Set([l.main_items, ...l.acceptable_items].map((items) => expectedNext({ ...l, main_items: items })));
const expectedNext = (l: Label) =>
  l.main_items === 'individual_product' ? 'extract'
  : l.main_items === 'product_family' || l.main_items === 'product_category' ? 'expand_items'
  : ({ product_listing: 'extract', family_listing: 'expand_items', category_hub: 'expand_items', finder_needs_input: 'needs_input', product_detail: 'extract_single' } as Record<string, string>)[l.page_kind] ?? 'stop';

const judge = createJudge();
const rows: Record<string, unknown>[] = [];
for (const site of sites.filter((s) => !only || s.id === only)) {
  let r: ReconReport | undefined;
  let error: string | undefined;
  try {
    r = await recon(site.url, judge, `${runDir}/${site.id}`);
  } catch (e) {
    error = String(e).slice(0, 160);
  }
  const label = labels[site.id];
  const a = r?.judgment;
  const mainItems = r?.main_items ?? 'none';
  const row = {
    id: site.id,
    label_kind: label?.page_kind,
    jev_kind: a?.page_kind.choice,
    kind_conf: a ? Number(a.page_kind.confidence.toFixed(2)) : undefined,
    kind_ok: label && a ? a.page_kind.choice === label.page_kind || label.acceptable_alternates.includes(a.page_kind.choice) : undefined,
    label_items: label?.main_items,
    jev_items: mainItems,
    items_ok: label && a ? mainItems === label.main_items || label.acceptable_items.includes(mainItems) : undefined,
    expected_next: label ? expectedNext(label) : undefined,
    next: r?.next,
    listed_items: r?.listed_items,
    probes: r?.probes.map((p) => p.kind ? `${p.kind} ${p.confidence?.toFixed(2)}` : `err`).join(', '),
    next_ok: label && r ? expectedNexts(label).has(r.next) : undefined,
    gates: r?.gates.map((g) => (g.decision.action === 'click' ? `${g.decision.role} "${g.decision.label}"${g.page_changed ? '' : ' (no change)'}` : g.decision.reason)).join(' > '),
    label_gate: label?.gate,
    calls: r?.jev_calls,
    tokens: r?.jev_input_tokens,
    ms: r?.elapsed_ms,
    error,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const scored = rows.filter((r) => r.kind_ok !== undefined);
const pct = (k: string) => `${scored.filter((r) => r[k]).length}/${scored.length}`;
const md = [
  `# Recon bench ${runDir.split('/').pop()} (${suitePath})`,
  '',
  `Page kind correct: ${pct('kind_ok')} · Main items correct: ${pct('items_ok')} · Next action correct: ${pct('next_ok')} · Jev calls: ${judge.trace.length} · Input tokens: ${judge.trace.reduce((n, t) => n + t.input_tokens, 0)}`,
  '',
  '| site | label kind | jev kind (conf) | ok | label items | listed items | probes | final items | ok | expected next | next | ok | gates | label gate | ms |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.label_kind ?? ''} | ${r.jev_kind ?? r.error ?? ''} (${r.kind_conf ?? ''}) | ${r.kind_ok ? '✓' : '✗'} | ${r.label_items ?? ''} | ${r.listed_items ?? ''} | ${r.probes ?? ''} | ${r.jev_items ?? ''} | ${r.items_ok ? '✓' : '✗'} | ${r.expected_next ?? ''} | ${r.next ?? ''} | ${r.next_ok ? '✓' : '✗'} | ${r.gates ?? ''} | ${r.label_gate ?? ''} | ${r.ms ?? ''} |`),
].join('\n');
writeFileSync(`${runDir}/summary.md`, md + '\n');
writeFileSync(`${runDir}/summary.json`, JSON.stringify(rows, null, 2));
console.log(`\n${md}\n\n${runDir}/summary.md`);
