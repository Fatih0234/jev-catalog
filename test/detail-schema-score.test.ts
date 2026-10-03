import { describe, expect, it } from 'vitest';
import { scoreDetailProduct } from '../bench/detail-schema-score.js';
import type { DetailResult } from '../src/detail.js';
import type { ExpectedProduct } from '../bench/heldout-recipe-evidence.js';

const key = '["Technical data","Suction cup material"]';
const gold: ExpectedProduct = {
  target: { url: 'https://fixture.test/product/4', expected_code: 'FIX-4' },
  fields: [{ section: 'Technical data', label: 'Material', value: 'NBR' }],
  downloads: ['https://fixture.test/files/4.pdf'],
  evidence: ['independent/product-4'],
};
const source = {
  sample_url: gold.target.url,
  phase: 'technical-data',
  candidate_id: 'r4',
  binding_id: 'material-technical',
  label: 'Material',
  value: 'NBR',
  raw_section: ['Changed product description', 'Technical data'],
  section: ['Technical data'],
  block_kind: 'table' as const,
};
const result = () => ({
  recipe_version: 2 as const,
  target: gold.target,
  final_url: gold.target.url,
  identity: 'matched' as const,
  status: 'ok' as const,
  values: { [key]: 'NBR' } as Record<string, string>,
  field_sources: { [key]: [{ ...source }] } as Record<string, (typeof source)[]>,
  downloads: [{ label: 'Datasheet', url: gold.downloads[0]!, section: ['Documents'] }],
  observed_codes: ['FIX-4'],
  issues: [],
  reveals: [],
});

describe('detail evidence scoring', () => {
  it('accepts a saved manufacturer alias only with current-product source evidence', () => {
    const score = scoreDetailProduct(result(), gold);
    expect(score.fields[0]!.correct).toBe(true);
    expect(score.downloads[0]!.correct).toBe(true);
    expect(score.extra_values).toEqual([]);
    expect(score.clean).toBe(true);
  });

  it('rejects wrong sections, values, missing sources and teaching-page sources', () => {
    const wrongSection = result();
    wrongSection.field_sources[key]![0]!.section = ['Design data'];
    expect(scoreDetailProduct(wrongSection, gold).fields[0]!.correct).toBe(false);
    const wrongValue = result();
    wrongValue.values[key] = 'Silicone';
    expect(scoreDetailProduct(wrongValue, gold).fields[0]!.correct).toBe(false);
    const missing = result();
    missing.field_sources = {};
    expect(scoreDetailProduct(missing, gold).fields[0]!.correct).toBe(false);
    const teaching = result();
    teaching.field_sources[key]![0]!.sample_url = 'https://fixture.test/product/1';
    expect(scoreDetailProduct(teaching, gold).fields[0]!.correct).toBe(false);
  });

  it('accepts agreeing duplicate sources and rejects a conflicting source ledger', () => {
    const agreed = result();
    agreed.field_sources[key]!.push({ ...source, binding_id: 'material-overview' });
    expect(scoreDetailProduct(agreed, gold).clean).toBe(true);
    const conflict = result();
    conflict.field_sources[key]!.push({ ...source, value: 'Silicone' });
    expect(scoreDetailProduct(conflict, gold).fields[0]!.correct).toBe(false);
    expect(scoreDetailProduct(conflict, gold).clean).toBe(false);
  });

  it('rejects two output fields for one expected attribute', () => {
    const duplicate = result();
    const other = '["Overview","Material"]';
    duplicate.values[other] = 'NBR';
    duplicate.field_sources[other] = [{ ...source, binding_id: 'material-other' }];
    const score = scoreDetailProduct(duplicate, gold);
    expect(score.fields[0]!.correct).toBe(false);
    expect(score.extra_values).toHaveLength(2);
    expect(score.clean).toBe(false);
  });

  it('cannot count one incorrectly merged output as two independently scoped attributes', () => {
    const merged = result();
    merged.field_sources[key]!.push({ ...source, section: ['Design data'] });
    const twoFields = { ...gold, fields: [
      ...gold.fields,
      { section: 'Design data', label: 'Material', value: 'NBR' },
    ] };
    const score = scoreDetailProduct(merged, twoFields);
    expect(score.fields.map((field) => field.correct)).toEqual([false, false]);
    expect(score.extra_values).toHaveLength(1);
  });

  it('reports extra values and URLs, missing products and wrong expected identities', () => {
    const extra = result();
    extra.values['["Technical data","Attribute"]'] = 'Value';
    extra.downloads.push({ label: 'Other', url: 'https://fixture.test/files/other.pdf', section: ['Documents'] });
    const score = scoreDetailProduct(extra, gold);
    expect(score.extra_values).toHaveLength(1);
    expect(score.extra_downloads).toEqual(['https://fixture.test/files/other.pdf']);
    expect(score.clean).toBe(false);
    expect(scoreDetailProduct(undefined, gold).present).toBe(false);
    const wrongCode = result();
    wrongCode.target = { ...gold.target, expected_code: 'OTHER-4' };
    expect(scoreDetailProduct(wrongCode, gold).identity_matched).toBe(false);
  });

  it('keeps version 1 exact path scoring without requiring new source records', () => {
    const legacy: DetailResult = {
      ...result(),
      values: { '["Technical data","Material"]': 'NBR' },
    };
    delete (legacy as { recipe_version?: number }).recipe_version;
    expect(scoreDetailProduct(legacy, gold).clean).toBe(true);
    legacy.values = { [key]: 'NBR' };
    expect(scoreDetailProduct(legacy, gold).fields[0]!.correct).toBe(false);
  });
});
