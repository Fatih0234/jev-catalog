import type { Judge } from './jev.js';
import {
  DETAIL_COMPOSITE_LABEL,
  DETAIL_DOCUMENT_PATH,
  DETAIL_POLICY,
  DETAIL_UNIT_SUFFIX,
  detailFieldKey,
  detailObservedUrlKey,
} from './detail-policy.js';
import {
  acceptedDetailRole,
  detailDownloadRequests,
  detailFieldRequests,
  detailHeadingRequests,
  detailRelationRequests,
  type DetailDownloadCandidate,
  type DetailFieldCandidate,
  type DetailHeadingCandidate,
} from './detail-questions.js';
import type {
  DetailFieldSourceRecord,
  DetailFieldV2,
  DetailIssue,
  DetailObservation,
  DetailRecipeV2,
  ObservedBlock,
  ObservedNodeDescriptor,
  ObservedRowKind,
} from './detail.js';

export interface SchemaObservationCapture {
  phase: string;
  url: string;
  obs: DetailObservation;
  control_roles: Record<string, string>;
  block_roles: Record<string, string>;
}

export interface SchemaSampleInput {
  url: string;
  expected_code?: string;
  identity: string;
  status: string;
  issues: DetailIssue[];
  mechanisms: { source: string; via: string }[];
  captures: SchemaObservationCapture[];
  signature: string;
  seen: { key: string; label: string; kind: 'tab' | 'accordion' | 'summary'; panel_heading: string; section?: string[]; role: 'specifications' | 'downloads'; initial?: boolean; structure?: { path: ObservedNodeDescriptor[] } }[];
}

export interface SchemaLearnResult {
  recipe: DetailRecipeV2;
  learned: {
    headings: { id: string; text: string; tag: string; via: string; role: string; samples: string[] }[];
    candidates: { id: string; label: string; region: string[]; role: string; examples: number }[];
    relations: { id: string; kind: string; left: string; right: string; accepted: boolean }[];
    unresolved: { reason: string; message: string }[];
  };
}

const HEADING_ROLES = ['specification_section', 'document_section', 'product_description', 'navigation', 'disclosure_ui', 'other'];
const FIELD_ROLES = ['product_attribute', 'ordering_attribute', 'table_heading', 'ui_navigation', 'marketing', 'other'];
const ACCEPTED_HEADINGS = new Set(['specification_section', 'document_section']);
const ACCEPTED_FIELDS = new Set(['product_attribute', 'ordering_attribute']);
const STATE_CLASSES = /^(active|show|showing|open|opened|expanded|collapsed|collapse|hidden|selected|disabled|current|focus|focused|on|off)$/i;

const nfc = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const regionKey = (section: string[]) => section.join('>');
const structureClasses = (classes: string[], code?: string) =>
  classes.filter((c) => !STATE_CLASSES.test(c) && !(code && c.includes(code)));
const structurePath = (block: ObservedBlock, code?: string): ObservedNodeDescriptor[] =>
  (block.evidence?.path ?? []).map((n) => ({ tag: n.tag, role: n.role, itemprop: n.itemprop, classes: structureClasses(n.classes, code) }));
const structureOf = (block: ObservedBlock, code?: string): DetailRecipeV2['fields'][number]['sources'][number]['structure'] => ({
  path: structurePath(block, code),
  row_kind: (block.rows.find((r) => r.evidence?.kind !== 'table_header')?.evidence?.kind ?? 'table_row') as ObservedRowKind,
});
const pathMatch = (rule: ObservedNodeDescriptor[], seen: ObservedNodeDescriptor[]): boolean => {
  if (!rule.length) return true;
  const depth = Math.min(rule.length, seen.length);
  if (depth < Math.min(3, rule.length)) return false;
  const rt = rule.slice(-depth);
  const bt = seen.slice(-depth);
  return rt.every((n, i) => n.tag === bt[i]!.tag && n.role === bt[i]!.role && n.itemprop === bt[i]!.itemprop
    && n.classes.every((c) => bt[i]!.classes.includes(c)));
};

const headingText = (block: ObservedBlock, headingRole: (text: string) => string | undefined): string[] | undefined => {
  const trail = block.evidence?.headings ?? [];
  const ordered = [...trail].sort((a, b) => (b.depth - a.depth) || ((a.relation === 'own' ? 1 : 0) - (b.relation === 'own' ? 1 : 0)));
  const out: string[] = [];
  for (const h of ordered) {
    const role = headingRole(h.text);
    if (role && ACCEPTED_HEADINGS.has(role) && !out.includes(h.text)) out.push(h.text);
  }
  const panel = block.evidence?.panel?.label;
  if (!out.length && panel && ACCEPTED_HEADINGS.has(headingRole(panel) ?? '')) out.push(panel);
  return out.length ? out : undefined;
};
const meaningfulSection = (block: ObservedBlock, headingRole: (text: string) => string | undefined): string[] | undefined => {
  const named = headingText(block, headingRole);
  if (named) return named;
  if (block.rows.length && !block.evidence?.excluded && structurePath(block).length) return [];
  return undefined;
};

interface RawRow { sample: SchemaSampleInput; capture: SchemaObservationCapture; block: ObservedBlock; label: string; value: string; kind: string }
interface Group {
  id: string;
  key: string;
  label: string;
  section: string[];
  kind: string;
  rows: RawRow[];
  slots: Map<string, { id: string; block_kind: ObservedBlock['kind']; panel_label?: string; structure: DetailRecipeV2['fields'][number]['sources'][number]['structure'] }>;
  slotSamples: Map<string, Set<string>>;
  regionAliases: string[][];
  fieldAliases: string[];
  accepted: boolean;
  mergedRegion?: boolean;
  dupSource?: boolean;
}

export async function learnDetailSchema(samples: SchemaSampleInput[], judge: Judge): Promise<SchemaLearnResult> {
  const issues: DetailIssue[] = [];
  const attempted = samples.map((s) => s.url);
  const usable = samples.filter((s) => s.identity === 'matched' && ['ok', 'partial'].includes(s.status) && s.captures.length);
  const verified = usable.map((s) => s.url);
  const inspectedUrls = new Set(verified);
  const page = { sample_urls: verified };
  const learned: SchemaLearnResult['learned'] = { headings: [], candidates: [], relations: [], unresolved: [] };

  const headingIndex = new Map<string, { text: string; tag: string; via: string; itemprop: string; section: string[]; sample_labels: string[]; panel_label?: string; samples: Set<string> }>();
  const blocksOf = (s: SchemaSampleInput) => s.captures.flatMap((c) => c.obs.blocks.filter((b) => !b.evidence?.excluded).map((b) => ({ block: b, capture: c })));
  for (const s of usable) {
    for (const { block } of blocksOf(s)) {
      for (const h of block.evidence?.headings ?? []) {
        const cur = headingIndex.get(h.text) ?? {
          text: h.text, tag: h.tag, via: h.via, itemprop: h.itemprop,
          section: block.section, sample_labels: block.rows.map((r) => r.label).slice(0, 4),
          panel_label: block.evidence?.panel?.label, samples: new Set<string>(),
        };
        cur.samples.add(s.url);
        headingIndex.set(h.text, cur);
      }
      const panel = block.evidence?.panel?.label;
      if (panel && !headingIndex.has(panel)) {
        headingIndex.set(panel, {
          text: panel, tag: 'div', via: 'panel_label', itemprop: '',
          section: block.section, sample_labels: block.rows.map((r) => r.label).slice(0, 4),
          panel_label: panel, samples: new Set([s.url]),
        });
      }
    }
  }
  const headingRoleByText = new Map<string, string>();
  {
    const candidates: DetailHeadingCandidate[] = [...headingIndex.values()].map((h, i) => ({
      id: `h${i + 1}`, text: h.text, tag: h.tag, via: h.via, itemprop: h.itemprop,
      section: h.section, sample_labels: h.sample_labels, panel_label: h.panel_label,
    }));
    const back = new Map(candidates.map((c) => [c.id, c.text]));
    const { requests, unoffered } = detailHeadingRequests(page, candidates);
    for (const id of unoffered) {
      const text = back.get(id) ?? id;
      issues.push({ reason: 'heading_unoffered', message: text });
      learned.unresolved.push({ reason: 'heading_unoffered', message: text });
    }
    for (const req of requests) {
      const answers = await judge.ask(req.step, req.state, req.questions);
      for (const id of req.offered) {
        const role = acceptedDetailRole(answers[`${req.step}_${id}`], HEADING_ROLES);
        const text = back.get(id)!;
        if (role) headingRoleByText.set(text, role);
        else {
          issues.push({ reason: 'heading_unverified', message: text });
          learned.unresolved.push({ reason: 'heading_unverified', message: text });
        }
      }
    }
    learned.headings = candidates.map((c) => {
      const h = headingIndex.get(c.text)!;
      return { id: c.id, text: c.text, tag: c.tag, via: c.via, role: headingRoleByText.get(c.text) ?? 'unverified', samples: [...h.samples] };
    });
  }
  const headingRole = (text: string) => headingRoleByText.get(text);

  const groups = new Map<string, Group>();
  const inspectedRegions = new Map<string, Set<string>>();
  let sourceSeq = 0;
  let groupSeq = 0;
  const structSig = (path: ObservedNodeDescriptor[]) =>
    JSON.stringify(path.map((n) => ({ tag: n.tag, role: n.role, itemprop: n.itemprop, classes: [...n.classes].sort() })));
  const slotOf = (block: ObservedBlock, code?: string) => JSON.stringify([
    block.kind,
    block.evidence?.panel?.label ?? '',
    structSig(structurePath(block, code)),
    block.rows.find((r) => r.evidence?.kind !== 'table_header')?.evidence?.kind ?? 'table_row',
  ]);
  const ctxByUrl = new Map<string, Set<string>>();
  for (const s of usable) {
    const inspected = inspectedRegions.get(s.url) ?? new Set<string>();
    inspectedRegions.set(s.url, inspected);
    const ctxs = ctxByUrl.get(s.url) ?? new Set<string>();
    ctxByUrl.set(s.url, ctxs);
    for (const { block, capture } of blocksOf(s)) {
      const role = capture.block_roles[block.id];
      if (role !== 'specifications' && role !== 'ordering') continue;
      const region = meaningfulSection(block, headingRole);
      if (region === undefined) {
        if (block.rows.length) issues.push({ reason: 'unresolved_scope', message: `${block.id}: ${block.section.join('>') || '(no section)'}` });
        continue;
      }
      inspected.add(regionKey(region));
      for (const row of block.rows) {
        if (row.evidence?.kind === 'table_header') continue;
        const key = JSON.stringify([region, row.label]);
        const g: Group = groups.get(key) ?? {
          id: `g${++groupSeq}`, key, label: row.label, section: region, kind: block.kind, rows: [],
          slots: new Map(), slotSamples: new Map(), regionAliases: [], fieldAliases: [], accepted: false,
        };
        const slot = slotOf(block, s.expected_code);
        if (!g.slots.has(slot)) {
          g.slots.set(slot, {
            id: `src${++sourceSeq}`, block_kind: block.kind,
            panel_label: block.evidence?.panel?.label,
            structure: structureOf(block, s.expected_code),
          });
          g.slotSamples.set(slot, new Set());
        }
        g.slotSamples.get(slot)!.add(s.url);
        ctxs.add(`${regionKey(region)}|${slot}`);
        g.rows.push({ sample: s, capture, block, label: row.label, value: row.value, kind: row.evidence?.kind ?? 'table_row' });
        groups.set(key, g);
      }
    }
  }

  const groupList = [...groups.values()];
  const detailRank = (r: RawRow) => (r.block.evidence?.panel ? 1 : 0) + (r.block.kind === 'table' ? 1 : 0);
  const exampleRows = (rows: RawRow[]) => {
    const bySample = new Map<string, RawRow>();
    for (const r of rows) {
      const cur = bySample.get(r.sample.url);
      if (!cur || detailRank(r) > detailRank(cur)) bySample.set(r.sample.url, r);
    }
    return [...bySample.values()].slice(0, DETAIL_POLICY.sampleCount);
  };
  const exampleOf = (g: Group) => (r: RawRow): DetailFieldCandidate['examples'][number] => {
    const slot = g.slots.get(slotOf(r.block, r.sample.expected_code));
    return {
      sample_url: r.sample.url, value: r.value, kind: r.kind, section: r.block.section,
      region: regionKey(g.section),
      ...(slot ? {
        source: {
          id: slot.id, block_kind: r.block.kind,
          panel_label: r.block.evidence?.panel?.label ?? '',
          path: slot.structure.path.map((n) => ({ tag: n.tag, role: n.role, itemprop: n.itemprop, classes: n.classes })),
        },
      } : {}),
    };
  };
  const fieldCandidates: DetailFieldCandidate[] = groupList.map((g, i) => ({
    id: `f${i + 1}`,
    label: g.label,
    examples: exampleRows(g.rows).map(exampleOf(g)),
  }));
  {
    const { requests, unoffered } = detailFieldRequests(page, fieldCandidates);
    for (const id of unoffered) {
      issues.push({ reason: 'field_unoffered', message: id });
      learned.unresolved.push({ reason: 'field_unoffered', message: id });
    }
    for (const req of requests) {
      const answers = await judge.ask(req.step, req.state, req.questions);
      for (const id of req.offered) {
        const role = acceptedDetailRole(answers[`${req.step}_${id}`], FIELD_ROLES);
        const g = groupList[Number(id.slice(1)) - 1]!;
        if (role && ACCEPTED_FIELDS.has(role)) g.accepted = true;
        else if (!role) {
          issues.push({ reason: 'field_unverified', message: g.label });
          learned.unresolved.push({ reason: 'field_unverified', message: g.label });
        }
      }
    }
    learned.candidates = fieldCandidates.map((c, i) => ({
      id: c.id, label: c.label, region: groupList[i]!.section,
      role: groupList[i]!.accepted ? 'accepted' : 'not_accepted', examples: c.examples.length,
    }));
  }
  const candOf = (g: Group) => fieldCandidates[groupList.indexOf(g)]!;
  const slotCandOf = (g: Group, slot: string): DetailFieldCandidate => ({
    id: `${g.id}@${g.slots.get(slot)?.id ?? slot}`,
    label: g.label,
    examples: exampleRows(g.rows.filter((r) => slotOf(r.block, r.sample.expected_code) === slot)).map(exampleOf(g)),
  });

  let budgetLeft = DETAIL_POLICY.maxFieldRelations;
  const relationAsk = async (kind: 'section' | 'field' | 'duplicate', pairs: { a: DetailFieldCandidate; b: DetailFieldCandidate; tag: string }[]) => {
    const approved = new Set<string>();
    const rejected = new Set<string>();
    const slice = pairs.slice(0, Math.max(0, budgetLeft));
    budgetLeft -= slice.length;
    if (pairs.length > slice.length) {
      issues.push({ reason: 'relation_cap', message: `${pairs.length - slice.length} ${kind} proposal(s) unasked` });
      learned.unresolved.push({ reason: 'relation_cap', message: kind });
    }
    const verdicts = new Map<string, 'yes' | 'no' | 'unknown'>();
    const candidates = slice.map((p, i) => ({ id: `r${i + 1}`, left: p.a, right: p.b }));
    const { requests, unoffered } = detailRelationRequests(kind, page, candidates);
    for (const id of unoffered) learned.unresolved.push({ reason: 'relation_unoffered', message: kind });
    for (const req of requests) {
      const answers = await judge.ask(req.step, req.state, req.questions);
      for (const id of req.offered) {
        const answer = answers[`${req.step}_${id}`] as { noul?: number } | undefined;
        const p = slice[Number(id.slice(1)) - 1]!;
        const n = answer?.noul;
        const valid = typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
        const yes = valid && n >= DETAIL_POLICY.relationProbability;
        const no = valid && n <= 1 - DETAIL_POLICY.relationProbability;
        learned.relations.push({ id, kind, left: p.a.label, right: p.b.label, accepted: yes });
        verdicts.set(p.tag, yes ? 'yes' : no ? 'no' : 'unknown');
        if (yes) approved.add(p.tag);
        else if (no) rejected.add(p.tag);
        else learned.unresolved.push({ reason: 'relation_unresolved', message: `${p.a.label} vs ${p.b.label}` });
      }
    }
    return { approved, rejected, answers: verdicts };
  };

  const acc0 = groupList.filter((g) => g.accepted);
  const samplesOf = (g: Group) => new Set(g.rows.map((r) => r.sample.url));
  const sharesSample = (a: Group, b: Group) => [...samplesOf(a)].some((u) => samplesOf(b).has(u));
  const nestedScope = (a: Group, b: Group) => {
    const [s, l] = a.section.length <= b.section.length ? [a.section, b.section] : [b.section, a.section];
    return s.length !== l.length && s.every((t, i) => l[i] === t);
  };
  const pairSet = (pred: (a: Group, b: Group) => boolean) => {
    const out: { a: DetailFieldCandidate; b: DetailFieldCandidate; tag: string }[] = [];
    for (let i = 0; i < acc0.length; i++) {
      for (let j = i + 1; j < acc0.length; j++) {
        const a = acc0[i]!;
        const b = acc0[j]!;
        if (pred(a, b)) out.push({ a: candOf(a), b: candOf(b), tag: `${a.id}||${b.id}` });
      }
    }
    return out;
  };

  const parent = new Map<Group, Group>();
  const find = (g: Group): Group => { const p = parent.get(g); return p ? find(p) : g; };
  const union = (a: Group, b: Group) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const unitsOf = (g: Group) => {
    const out = new Set<string>();
    for (const r of g.rows) {
      const m = DETAIL_UNIT_SUFFIX.exec(r.value);
      if (m) out.add(m[1]!.toLowerCase());
      for (const bm of r.label.matchAll(/\[([^\]]+)\]|\(([^()]+)\)/g)) {
        const u = bm[1] ?? bm[2];
        if (u && DETAIL_UNIT_SUFFIX.test(`1 ${u}`)) out.add(u.toLowerCase());
      }
    }
    return out;
  };
  const sameBlockCapture = (a: Group, b: Group) => {
    const ids = new Set(a.rows.map((r) => `${r.sample.url}|${r.capture.phase}|${r.block.id}`));
    return b.rows.some((r) => ids.has(`${r.sample.url}|${r.capture.phase}|${r.block.id}`));
  };
  const cannotLink = (a: Group, b: Group, dupMode: boolean): string | undefined => {
    if (a.label.toLowerCase() === b.label.toLowerCase() && a.label !== b.label) return 'case_distinct';
    if (a.label !== b.label) {
      if (DETAIL_COMPOSITE_LABEL.test(a.label) !== DETAIL_COMPOSITE_LABEL.test(b.label)) return 'composite_label';
      if (DETAIL_COMPOSITE_LABEL.test(a.label) && DETAIL_COMPOSITE_LABEL.test(b.label)) return 'composite_label';
      if (sameBlockCapture(a, b)) return 'coexisting_labels';
    }
    const unitsA = unitsOf(a);
    const unitsB = unitsOf(b);
    if (unitsA.size && unitsB.size && ![...unitsA].some((u) => unitsB.has(u))) return 'unit_conflict';
    if (sharesSample(a, b)) {
      if (!dupMode) return 'coexisting';
      if (a.section.length && b.section.length && regionKey(a.section) !== regionKey(b.section)) return 'coexisting_scopes';
    }
    return undefined;
  };
  const verdictsByKind: Record<'field' | 'section' | 'duplicate', Map<string, 'yes' | 'no' | 'unknown'>> = {
    field: new Map(), section: new Map(), duplicate: new Map(),
  };
  const tagFor = (a: Group, b: Group) => `${a.id}||${b.id}`;
  const consistentUnion = (a: Group, b: Group, kinds: ('field' | 'section' | 'duplicate')[], dupMode = false): boolean => {
    if (find(a) === find(b)) return true;
    const membersOf = (root: Group) => acc0.filter((g) => find(g) === root);
    for (const x of membersOf(find(a))) {
      for (const y of membersOf(find(b))) {
        for (const kind of kinds) {
          const v = verdictsByKind[kind].get(tagFor(x, y)) ?? verdictsByKind[kind].get(tagFor(y, x));
          if (v === 'no') {
            issues.push({ reason: 'relation_conflict', message: `${kind}: ${x.label} vs ${y.label}` });
            learned.unresolved.push({ reason: 'relation_conflict', message: `${kind}: ${x.label} vs ${y.label}` });
            return false;
          }
        }
        const why = cannotLink(x, y, dupMode);
        if (why) {
          learned.unresolved.push({ reason: 'cannot_link', message: `${why}: ${x.label} vs ${y.label}` });
          return false;
        }
      }
    }
    union(a, b);
    return true;
  };

  const aliasPairs = pairSet((a, b) =>
    a.label !== b.label && regionKey(a.section) === regionKey(b.section)
    && !sharesSample(a, b) && a.label.toLowerCase() !== b.label.toLowerCase());
  const fieldRes = await relationAsk('field', aliasPairs);
  for (const [k, v] of fieldRes.answers) verdictsByKind.field.set(k, v);
  const pairGroups = (tag: string): [Group, Group] => {
    const [ka, kb] = tag.split('||');
    return [groupList.find((g) => g.id === ka!)!, groupList.find((g) => g.id === kb!)!];
  };
  for (const tag of fieldRes.approved) {
    const [a, b] = pairGroups(tag);
    consistentUnion(a, b, ['field']);
  }

  const crossScope = (a: Group, b: Group) =>
    regionKey(a.section) !== regionKey(b.section) && a.label === b.label
    && !sharesSample(a, b) && !nestedScope(a, b);
  const scopePairs = pairSet(crossScope);
  const sectionRes = await relationAsk('section', scopePairs);
  const fieldScopeRes = await relationAsk('field', scopePairs.map((p) => ({ ...p })));
  const dupScopeRes = await relationAsk('duplicate', scopePairs.map((p) => ({ ...p })));
  for (const [k, v] of sectionRes.answers) verdictsByKind.section.set(k, v);
  for (const [k, v] of fieldScopeRes.answers) verdictsByKind.field.set(k, v);
  for (const [k, v] of dupScopeRes.answers) verdictsByKind.duplicate.set(k, v);
  for (const p of scopePairs) {
    const sectionAlias = sectionRes.approved.has(p.tag) && fieldScopeRes.approved.has(p.tag);
    const duplicate = fieldScopeRes.approved.has(p.tag) && dupScopeRes.approved.has(p.tag);
    const [a, b] = pairGroups(p.tag);
    if (sectionAlias) {
      if (consistentUnion(a, b, ['field', 'section'])) {
        const keep = a.section.length >= b.section.length ? a : b;
        const drop = keep === a ? b : a;
        keep.regionAliases.push(drop.section);
        drop.mergedRegion = true;
      }
    } else if (duplicate) {
      if (consistentUnion(a, b, ['field', 'duplicate'], true)) {
        a.dupSource = true;
        b.dupSource = true;
      }
    } else {
      learned.unresolved.push({ reason: 'scope_unresolved', message: `${a.label}: ${a.section.join('>')} vs ${b.section.join('>')}` });
    }
  }

  const overviewPairs = pairSet((a, b) =>
    regionKey(a.section) !== regionKey(b.section)
    && ((a.section.length === 0) !== (b.section.length === 0))
    && (a.label === b.label || sharesSample(a, b)));
  const ovFieldRes = await relationAsk('field', overviewPairs);
  const ovDupRes = await relationAsk('duplicate', overviewPairs.map((p) => ({ ...p })));
  for (const [k, v] of ovFieldRes.answers) verdictsByKind.field.set(k, v);
  for (const [k, v] of ovDupRes.answers) verdictsByKind.duplicate.set(k, v);
  for (const p of overviewPairs) {
    const [a, b] = pairGroups(p.tag);
    if (ovFieldRes.approved.has(p.tag) && ovDupRes.approved.has(p.tag)) {
      if (consistentUnion(a, b, ['field', 'duplicate'], true)) {
        a.dupSource = true;
        b.dupSource = true;
      }
    } else {
      learned.unresolved.push({ reason: 'scope_unresolved', message: `${a.label}: ${a.section.join('>')} vs ${b.section.join('>')}` });
    }
  }

  const dupPairs: { a: DetailFieldCandidate; b: DetailFieldCandidate; tag: string }[] = [];
  const slotCoexist = (g: Group, i: string, j: string) =>
    [...g.slotSamples.get(i)!].some((u) => g.slotSamples.get(j)!.has(u));
  const pairTag = (g: Group, i: string, j: string) => `${g.id}::${i}::${j}`;
  for (const g of acc0) {
    const slots = [...g.slots.keys()];
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        if (slotCoexist(g, slots[i]!, slots[j]!)) {
          dupPairs.push({ a: slotCandOf(g, slots[i]!), b: slotCandOf(g, slots[j]!), tag: pairTag(g, slots[i]!, slots[j]!) });
        }
      }
    }
  }
  const slotRes = await relationAsk('duplicate', dupPairs);
  for (const [k, v] of slotRes.answers) verdictsByKind.duplicate.set(k, v);
  const slotDeclaredMap = new Map<Group, Set<string>>();
  {
    for (const g of acc0) {
      const slots = [...g.slots.keys()];
      const declared = new Set<string>(slots.length ? [slots[0]!] : []);
      for (const slot of slots.slice(1)) {
        const coexistingDeclared = [...declared].filter((d) => slotCoexist(g, d, slot));
        const ok = coexistingDeclared.every((d) =>
          slotRes.approved.has(pairTag(g, d, slot)) || slotRes.approved.has(pairTag(g, slot, d)));
        if (ok) declared.add(slot);
      }
      slotDeclaredMap.set(g, declared);
    }
  }
  const slotDeclared = (g: Group, slot: string) => slotDeclaredMap.get(g)?.has(slot) === true;

  const clusters = new Map<Group, Group[]>();
  for (const g of acc0) {
    const root = find(g);
    clusters.set(root, [...(clusters.get(root) ?? []), g]);
  }
  for (const [root, members] of clusters) {
    if (members.length < 2) continue;
    let conflict = false;
    for (let i = 0; i < members.length && !conflict; i++) {
      for (let j = i + 1; j < members.length && !conflict; j++) {
        const a = members[i]!;
        const b = members[j]!;
        if (verdictsByKind.field.get(tagFor(a, b)) === 'no' || verdictsByKind.field.get(tagFor(b, a)) === 'no') conflict = true;
        if (cannotLink(a, b, a.dupSource === true && b.dupSource === true)) conflict = true;
      }
    }
    if (conflict) {
      for (const m of members) parent.delete(m);
      learned.unresolved.push({ reason: 'relation_chain_conflict', message: members.map((m) => m.id).join(', ') });
      clusters.delete(root);
      for (const m of members) clusters.set(m, [m]);
    }
  }

  const fields: DetailFieldV2[] = [];
  for (const members of clusters.values()) {
    const canon = [...members].sort((a, b) => b.section.length - a.section.length || b.rows.length - a.rows.length)[0]!;
    const labels = [...new Set(members.map((m) => m.label))];
    const repGroup = [...members].filter((m) => regionKey(m.section) === regionKey(canon.section))
      .sort((a, b) => b.rows.length - a.rows.length)[0] ?? canon;
    const label = repGroup.label;
    const key = detailFieldKey(canon.section, label);
    const sources: DetailFieldV2['sources'] = [];
    for (const g of members) {
      const slotList = [...g.slots.entries()];
      for (const [slot, info] of slotList) {
        const declared = slotDeclared(g, slot);
        if (!declared) {
          learned.unresolved.push({ reason: 'duplicate_unconfirmed', message: `${g.label} in ${info.block_kind}` });
          continue;
        }
        sources.push({
          id: info.id,
          label: g.label, block_kind: info.block_kind, region: g.section,
          ...(g.regionAliases.length ? { region_aliases: g.regionAliases } : {}),
          ...(info.panel_label ? { panel_label: info.panel_label } : {}),
          ...(g.section.length === 0 ? { detail: false } : {}),
          structure: info.structure,
        });
      }
    }
    const present: string[] = [];
    const absent: string[] = [];
    const unknown: string[] = [];
    const ctxs = new Set(members.flatMap((g) => [...g.slots.keys()].flatMap((sl) =>
      [regionKey(g.section), ...g.regionAliases.map(regionKey)].map((r) => `${r}|${sl}`))));
    for (const s of samples) {
      if (members.some((g) => g.rows.some((r) => r.sample.url === s.url))) present.push(s.url);
      else if (verified.includes(s.url) && [...ctxs].some((c) => ctxByUrl.get(s.url)?.has(c))) absent.push(s.url);
      else unknown.push(s.url);
    }
    fields.push({
      key, label, section: canon.section,
      aliases: labels.filter((l) => l !== label),
      sources,
      coverage: { present, absent, unknown },
      sample_coverage: Math.round((present.length / (samples.length || 1)) * 100) / 100,
      observed_all: present.length === usable.length && present.length >= 1 && !unknown.length && !absent.length,
    });
  }

  const mechanisms = new Map<string, { source: string; via: string }>();
  for (const s of usable) for (const mech of s.mechanisms) mechanisms.set(`${mech.source}|${mech.via}`, mech);
  const reveals = new Map<string, SchemaSampleInput['seen'][number] & { expected_on: string[] }>();
  const v2sig = (s: SchemaSampleInput) => 'v2#' + s.seen.filter((x) => x.initial).map((x) => x.key).sort().join(';');
  for (const s of usable) {
    for (const ctl of s.seen) {
      const prior = reveals.get(ctl.key);
      if (prior) { if (!prior.expected_on.includes(v2sig(s))) prior.expected_on.push(v2sig(s)); }
      else reveals.set(ctl.key, { ...ctl, expected_on: [v2sig(s)] });
    }
  }
  let regionSeq = 0;
  const regions = new Map<string, { id: string; section: string[]; kind: ObservedBlock['kind']; role: 'specifications' | 'ordering' | 'downloads'; ctx?: string; headings: Set<string>; panel_labels: Set<string>; aliases: string[][]; links: Set<string>; confirmed: { label: string; pattern: string }[]; structure?: { path: ObservedNodeDescriptor[] } }>();
  for (const g of acc0) {
    for (const [slot, info] of g.slots) {
      const k = g.section.length ? `${regionKey(g.section)}|${info.block_kind}` : `[]|${info.block_kind}|${info.panel_label ?? ''}|${slot}`;
      const r = regions.get(k) ?? { id: `rgn${++regionSeq}`, section: g.section, kind: info.block_kind, role: 'specifications' as const, headings: new Set<string>(), panel_labels: new Set<string>(), aliases: [], links: new Set<string>(), confirmed: [] };
      if (!g.section.length && r.ctx === undefined) r.ctx = `${regionKey(g.section)}|${slot}`;
      for (const h of g.section) r.headings.add(h);
      for (const a of g.regionAliases) if (!r.aliases.some((x) => regionKey(x) === regionKey(a))) r.aliases.push(a);
      if (info.panel_label) r.panel_labels.add(info.panel_label);
      if (!g.section.length && !r.structure) r.structure = { path: info.structure.path };
      regions.set(k, r);
    }
  }

  const docCandidates: DetailDownloadCandidate[] = [];
  const docMeta = new Map<string, { region: string[]; sample: SchemaSampleInput }>();
  {
    let n = 0;
    for (const s of usable) {
      for (const { block, capture } of blocksOf(s)) {
        if (capture.block_roles[block.id] !== 'downloads') continue;
        const region = meaningfulSection(block, headingRole)
          ?? (block.evidence?.panel?.label ? [block.evidence.panel.label] : undefined);
        if (region === undefined) continue;
        const k = `${regionKey(region)}|${block.kind}`;
        const r = regions.get(k) ?? { id: `rgn${++regionSeq}`, section: region, kind: block.kind, role: 'downloads' as const, headings: new Set<string>(), panel_labels: new Set<string>(), aliases: [], links: new Set<string>(), confirmed: [] };
        for (const h of region) r.headings.add(h);
        if (block.evidence?.panel?.label) r.panel_labels.add(block.evidence.panel.label);
        regions.set(k, r);
        for (const l of block.links) {
          const id = `d${++n}`;
          docCandidates.push({ id, label: l.label, url: l.url, document_title: l.document_title ?? '', section: region, download_attribute: l.download_attribute ?? '', has_download: l.has_download });
          docMeta.set(id, { region, sample: s });
        }
      }
    }
    const { requests, unoffered } = detailDownloadRequests(page, docCandidates);
    for (const id of unoffered) learned.unresolved.push({ reason: 'download_unoffered', message: id });
    for (const req of requests) {
      const answers = await judge.ask(req.step, req.state, req.questions);
      for (const id of req.offered) {
        const role = acceptedDetailRole(answers[`${req.step}_${id}`], ['direct_download', 'navigation', 'other']);
        const cand = docCandidates.find((c) => c.id === id)!;
        const meta = docMeta.get(id)!;
        if (role === 'direct_download') {
          for (const r of regions.values()) {
            if (r.role === 'downloads' && regionKey(r.section) === regionKey(meta.region)) {
              r.links.add(cand.label);
              const pattern = detailObservedUrlKey(cand.url, meta.sample.expected_code);
              if (!r.confirmed.some((x) => x.label === cand.label && x.pattern === pattern)) r.confirmed.push({ label: cand.label, pattern });
            }
          }
        } else if (!role) {
          learned.unresolved.push({ reason: 'download_unverified', message: cand.label });
        }
      }
    }
  }
  for (const s of usable) {
    for (const ctl of s.seen) {
      const inspected = s.captures.some((c) => c.obs.blocks.some((b) => b.evidence?.panel?.label === ctl.label));
      if (!inspected) {
        issues.push({ reason: 'region_uninspected', message: ctl.label });
        learned.unresolved.push({ reason: 'region_uninspected', message: ctl.label });
        inspectedUrls.delete(s.url);
      }
    }
  }
  const mergedRegions = [...regions.values()];
  for (const r of mergedRegions) {
    for (const alias of r.aliases) {
      const dup = mergedRegions.find((o) => o !== r && regionKey(o.section) === regionKey(alias) && o.kind === r.kind);
      if (dup) {
        for (const h of dup.headings) r.headings.add(h);
        for (const p of dup.panel_labels) r.panel_labels.add(p);
        mergedRegions.splice(mergedRegions.indexOf(dup), 1);
      }
    }
  }
  const unresolvedReasons = ['unresolved_scope', 'relation_cap', 'heading_unverified', 'field_unverified', 'heading_unoffered', 'field_unoffered', 'relation_unoffered', 'region_uninspected', 'relation_conflict', 'cannot_link', 'relation_chain_conflict', 'duplicate_unresolved'];
  const state: 'ready' | 'partial' | 'unusable' =
    !usable.length || !fields.length ? 'unusable'
      : usable.length < samples.length || fields.some((f) => f.coverage.unknown.length) || issues.some((i) => unresolvedReasons.includes(i.reason)) ? 'partial'
        : 'ready';
  const recipe: DetailRecipeV2 = {
    version: 2,
    recipe_version: 2,
    sample_urls: verified,
    learning: { state, attempted, verified, inspected: [...inspectedUrls] },
    ...(mechanisms.size ? { identity: { mechanisms: [...mechanisms.values()] } } : {}),
    regions: mergedRegions.map((r) => ({
      id: r.id, section: r.section, aliases: r.aliases, role: r.role, kind: r.kind,
      observed_all: verified.every((u) => r.section.length
        ? inspectedRegions.get(u)?.has(regionKey(r.section))
        : (r.ctx !== undefined && ctxByUrl.get(u)?.has(r.ctx))),
      headings: [...r.headings], panel_labels: [...r.panel_labels],
      ...(r.links.size ? { links: [...r.links] } : {}),
      ...(r.confirmed.length ? { confirmed_links: r.confirmed } : {}),
      ...(r.structure ? { structure: r.structure } : {}),
    })),
    fields,
    reveals: [...reveals.values()].map((r) => ({ label: r.label, kind: r.kind, panel_heading: r.panel_heading, role: r.role, section: r.section, ...(r.structure ? { structure: r.structure } : {}), expected_on: r.expected_on })),
    ignored: learned.headings.filter((h) => !ACCEPTED_HEADINGS.has(h.role)).map((h) => ({ text: h.text, role: h.role })),
    diagnostics: [...issues, ...learned.unresolved.filter((u) => !issues.some((i) => i.reason === u.reason && i.message === u.message))],
    templates: [...new Set(usable.map(v2sig))],
  };
  return { recipe, learned };
}

export interface SchemaMatch {
  values: Record<string, string>;
  field_sources: Record<string, DetailFieldSourceRecord[]>;
  unmapped_fields: DetailFieldSourceRecord[];
  downloads: { label: string; url: string; section: string[] }[];
  inspected_regions: string[];
  inspected_bindings: string[];
  ambiguous: string[];
  warnings: DetailIssue[];
  issues: DetailIssue[];
}

export function resolveFieldValue(recs: DetailFieldSourceRecord[]): { value?: string; conflicts?: string[] } {
  const bySource = new Map<string, DetailFieldSourceRecord[]>();
  for (const r of recs) {
    const k = `${r.binding_id}|${r.label}|${JSON.stringify(r.section)}`;
    bySource.set(k, [...(bySource.get(k) ?? []), r]);
  }
  const conflicts: string[] = [];
  const vals = new Set<string>();
  for (const recs2 of bySource.values()) {
    const v = new Set(recs2.map((r) => nfc(r.value)));
    if (v.size > 1) conflicts.push(...v);
    else vals.add(recs2[0]!.value);
  }
  if (conflicts.length) return { conflicts };
  const distinct = [...new Set([...vals].map(nfc))];
  if (distinct.length > 1) return { conflicts: distinct };
  return { value: vals.size ? [...vals][0]! : undefined };
}

export function matchDetailSchema(recipe: DetailRecipeV2, obs: DetailObservation, phase: string, sampleUrl: string, expectedCode?: string): SchemaMatch {
  const issues: DetailIssue[] = [];
  const warnings: DetailIssue[] = [];
  const regionTexts = (block: ObservedBlock) => new Set([
    ...(block.evidence?.headings ?? []).map((h) => h.text),
    ...(block.evidence?.panel?.label ? [block.evidence.panel.label] : []),
  ]);
  const regionRule = (block: ObservedBlock): { rule: DetailRecipeV2['regions'][number]; region: string[] } | undefined => {
    if (block.evidence?.excluded) return undefined;
    const texts = regionTexts(block);
    const hits = recipe.regions.filter((r) => {
      if (r.kind !== block.kind) return false;
      if (!r.section.length) return !!r.structure && pathMatch(r.structure.path, block.evidence?.path ?? []);
      return r.section.every((t) => texts.has(t)) || r.aliases.some((a) => a.every((t) => texts.has(t)));
    });
    const matched = hits.map((r) => ({
      rule: r,
      region: r.aliases.find((a) => a.every((t) => texts.has(t))) ?? r.section,
    }));
    if (!matched.length) return undefined;
    const depth = Math.max(...matched.map((h) => h.region.length));
    const best = matched.filter((h) => h.region.length === depth);
    if (best.length === 1) return best[0]!;
    issues.push({ reason: 'region_ambiguous', message: `${block.id}: ${block.section.join('>') || '(no section)'}` });
    return undefined;
  };
  const regionOf = (block: ObservedBlock) => regionRule(block);
  const sources: Record<string, DetailFieldSourceRecord[]> = {};
  const ambiguous = new Set<string>();
  const matchedRows = new Set<ObservedBlock['rows'][number]>();
  const aux = new Set(recipe.ignored.map((i) => i.text));
  const inspected = new Set<string>();
  const inspectedBindings = new Set<string>();
  for (const block of obs.blocks) {
    const hit = regionOf(block);
    if (hit) inspected.add(hit.rule.id ?? regionKey(hit.rule.section));
  }
  for (const field of recipe.fields) {
    for (const rule of field.sources) {
      const hits: DetailFieldSourceRecord[] = [];
      for (const block of obs.blocks) {
        if (block.kind !== rule.block_kind || block.evidence?.excluded) continue;
        const hit = regionOf(block);
        if (!hit) continue;
        if (regionKey(hit.region) !== regionKey(rule.region)
          && !(rule.region_aliases ?? []).some((a) => regionKey(a) === regionKey(hit.region))) continue;
        if (rule.panel_label && block.evidence?.panel?.label !== rule.panel_label) continue;
        if (!pathMatch(rule.structure.path, block.evidence?.path ?? [])) continue;
        inspectedBindings.add(rule.id);
        for (const row of block.rows) {
          if (row.label !== rule.label || row.evidence?.kind === 'table_header') continue;
          if (rule.structure.row_kind && row.evidence?.kind && row.evidence.kind !== rule.structure.row_kind) continue;
          matchedRows.add(row);
          hits.push({
            sample_url: sampleUrl, phase,
            candidate_id: row.evidence?.id ?? '', binding_id: rule.id,
            label: row.label, value: row.value,
            raw_section: block.section, section: hit.region, block_kind: block.kind,
          });
        }
      }
      if (hits.length > 1) {
        issues.push({ reason: 'source_ambiguous', message: `${rule.id} ${field.label} x${hits.length}` });
        ambiguous.add(field.key);
      }
      for (const h of hits) (sources[field.key] ??= []).push(h);
    }
  }
  const values: Record<string, string> = {};
  for (const field of recipe.fields) {
    const recs = sources[field.key] ?? [];
    if (!recs.length || ambiguous.has(field.key)) continue;
    const resolved = resolveFieldValue(recs);
    if (resolved.value !== undefined) values[field.key] = resolved.value;
    else issues.push({ reason: 'value_conflict', message: `${field.label}: ${(resolved.conflicts ?? []).join(' | ')}` });
  }
  const unmapped: DetailFieldSourceRecord[] = [];
  const downloads: SchemaMatch['downloads'] = [];
  for (const block of obs.blocks) {
    const hit = regionOf(block);
    if (!hit) continue;
    inspected.add(regionKey(hit.rule.section));
    if (hit.rule.role === 'downloads') {
      const confirmed = hit.rule.confirmed_links ?? [];
      for (const l of block.links) {
        let u: URL;
        try { u = new URL(l.url); } catch { continue; }
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) {
          warnings.push({ reason: 'invalid_link', message: `${l.label}` });
          continue;
        }
        const key = expectedCode ? detailObservedUrlKey(l.url, expectedCode) : l.url;
        if (DETAIL_DOCUMENT_PATH.test(u.pathname) || l.has_download
          || confirmed.some((c) => c.label === l.label && c.pattern === key)) {
          downloads.push({ label: l.label, url: l.url, section: hit.region });
        } else {
          warnings.push({ reason: 'unresolved_link', message: l.label });
        }
      }
      continue;
    }
    for (const row of block.rows) {
      if (matchedRows.has(row) || row.evidence?.kind === 'table_header') continue;
      unmapped.push({
        sample_url: sampleUrl, phase,
        candidate_id: row.evidence?.id ?? '', binding_id: block.id,
        label: row.label, value: row.value,
        raw_section: block.section, section: hit.region, block_kind: block.kind,
      });
    }
  }
  if (unmapped.length) issues.push({ reason: 'schema_unmapped', message: `${unmapped.length} row(s) in accepted regions` });
  for (const b of obs.blocks) {
    if (b.evidence?.excluded) continue;
    if ([...regionTexts(b)].some((t) => aux.has(t))) {
      warnings.push({ reason: 'auxiliary_region', message: `${b.id}: ${b.section.join('>') || '(no section)'}` });
    }
  }
  return { values, field_sources: sources, unmapped_fields: unmapped, downloads, inspected_regions: [...inspected], inspected_bindings: [...inspectedBindings], ambiguous: [...ambiguous], warnings, issues };
}
