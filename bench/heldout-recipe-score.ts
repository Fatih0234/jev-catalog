// Score every planned test against frozen evidence. Missing output is a failure.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DetailCompilation, DetailResult } from '../src/detail.js';
import type { ListingRecipe, Row } from '../src/listing.js';
import type { ExpectedListingRow, ExpectedProduct, FrozenEvidence } from './heldout-recipe-evidence.js';
import { scoreDetailProduct } from './detail-schema-score.js';

const [expectedPath, compileDir, replayDir, output] = process.argv.slice(2);
if (!expectedPath || !compileDir || !replayDir || !output) {
  throw new Error('usage: tsx bench/heldout-recipe-score.ts <expectations> <compile-dir> <replay-dir> <new-score.json>');
}
if (existsSync(output)) throw new Error('Refusing to replace a score');
const load = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const optional = <T>(path: string): T | undefined => existsSync(path) ? load<T>(path) : undefined;
const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
const expected = load<FrozenEvidence>(expectedPath);
let detailsOnly: boolean | undefined;
for (const dir of [compileDir, replayDir]) {
  const inputs = load<{ expectations_sha256: string; manifest_sha256: string; details_only?: boolean }>(join(dir, 'inputs.json'));
  if (inputs.expectations_sha256 !== sha(expectedPath) || inputs.manifest_sha256 !== expected.manifest_sha256) {
    throw new Error('Run inputs do not match frozen expectations');
  }
  const scope = inputs.details_only ?? false;
  if (detailsOnly !== undefined && detailsOnly !== scope) throw new Error('Compilation and replay scopes differ');
  detailsOnly = scope;
}
const receipt = optional<{ judge_created: boolean; typesafe_key_present: boolean; forbidden_api_attempts: number }>(
  join(replayDir, 'execution.json'));
const replayWithoutJev = !!receipt && !receipt.judge_created && !receipt.typesafe_key_present &&
  receipt.forbidden_api_attempts === 0;

function product(result: DetailResult | undefined, gold: ExpectedProduct) {
  return scoreDetailProduct(result, gold);
}

function listing(rows: Row[], recipe: ListingRecipe | undefined, gold: ExpectedListingRow[]) {
  const fields = recipe?.fields ?? [];
  const check = gold.map((expectedRow) => {
    const matches = rows.filter((row) => row._url === expectedRow.url);
    const row = matches.length === 1 ? matches[0] : undefined;
    const valuesForRole = (role: string) => fields.filter((field) => field.role === role)
      .map((field) => row?.[field.name]).filter((value): value is string => value !== undefined);
    const name = valuesForRole('name').some((value) => norm(value) === norm(expectedRow.name));
    const code = valuesForRole('order_code').some((value) => norm(value) === norm(expectedRow.code));
    const specs = Object.entries(expectedRow.specs).map(([label, value]) => {
      const candidates = fields.filter((field) => field.key === `label:${label}` || field.name === label);
      const actual = candidates.map((field) => row?.[field.name]).filter((value): value is string => value !== undefined);
      return { label, value, actual, correct: actual.length === 1 && norm(actual[0]!) === norm(value) };
    });
    return {
      expected: expectedRow, matched_rows: matches.length, url_correct: matches.length === 1,
      name_correct: name, code_correct: code, specs,
      clean: matches.length === 1 && name && code && specs.every((spec) => spec.correct),
    };
  });
  return {
    expected_rows: gold.length, actual_rows: rows.length,
    urls_correct: check.filter((row) => row.url_correct).length,
    names_correct: check.filter((row) => row.name_correct).length,
    codes_correct: check.filter((row) => row.code_correct).length,
    specs_expected: check.reduce((n, row) => n + row.specs.length, 0),
    specs_correct: check.reduce((n, row) => n + row.specs.filter((spec) => spec.correct).length, 0),
    clean_rows: check.filter((row) => row.clean).length,
    extra_rows: rows.filter((row) => !gold.some((expectedRow) => expectedRow.url === row._url)),
    checks: check,
  };
}

const sites = expected.sites.map((site) => {
  const compile = join(compileDir, site.id);
  const replay = join(replayDir, site.id);
  const compilation = optional<DetailCompilation>(join(compile, 'compilation.json'));
  const teaching = site.teach.map((gold) =>
    product(compilation?.samples.find((sample) => sample.target.url === gold.target.url), gold));
  const tests = site.test.map((gold) =>
    product(optional<DetailResult>(join(replay, `test-${gold.target.expected_code}.json`)), gold));
  const listingReplay = optional<{
    recipe: ListingRecipe; second: { rows: Row[]; fit: number; unknown_slots: string[] };
    transition: { after_url: string };
  }>(join(replay, 'listing-replay.json'));
  const list = listing(listingReplay?.second.rows ?? [], listingReplay?.recipe, site.listing.test);
  const trace = optional<{ model: string; input_tokens: number }[]>(join(compile, 'trace.json')) ?? [];
  return {
    id: site.id, teaching, tests,
    summary: {
      planned: tests.length, reported: tests.filter((test) => test.present).length,
      identity_correct: tests.filter((test) => test.identity_matched).length,
      fields_expected: tests.reduce((n, test) => n + test.fields.length, 0),
      fields_correct: tests.reduce((n, test) => n + test.fields.filter((field) => field.correct).length, 0),
      downloads_expected: tests.reduce((n, test) => n + test.downloads.length, 0),
      downloads_correct: tests.reduce((n, test) => n + test.downloads.filter((download) => download.correct).length, 0),
      extra_values: tests.reduce((n, test) => n + test.extra_values.length, 0),
      extra_downloads: tests.reduce((n, test) => n + test.extra_downloads.length, 0),
      clean_products: tests.filter((test) => test.clean).length,
      recorded_learning_responses: trace.length,
      recorded_learning_input_tokens: trace.reduce((n, entry) => n + entry.input_tokens, 0),
      models: [...new Set(trace.map((entry) => entry.model))],
    },
    listing: detailsOnly ? { planned: false } : {
      ...list,
      reached_expected_page: listingReplay?.transition.after_url === site.listing.test_url,
      fit: listingReplay?.second.fit, unknown_slots: listingReplay?.second.unknown_slots,
      error: optional(join(replay, 'listing-error.json')),
    },
    compilation_issues: compilation?.issues,
    site_error: optional(join(replay, 'site-error.json')),
  };
});
writeFileSync(output, JSON.stringify({
  scope: detailsOnly ? 'Untaught detail products only. All planned cases remain in the denominator.' :
    'Untaught detail products and the second listing page. All planned cases remain in the denominator.',
  expectations_sha256: sha(expectedPath), replay_without_jev: replayWithoutJev, receipt, sites,
}, null, 2) + '\n', { flag: 'wx' });
console.log(output);
