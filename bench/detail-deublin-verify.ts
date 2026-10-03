// Compare captured expectations with compilation and Jev-free replay. Never recapture labels.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { defaultHeadless } from '../src/browser.js';
import { readDetail, type DetailCompilation, type DetailResult } from '../src/detail.js';
import type { DetailTarget } from '../src/detail-policy.js';
import type { TraceEntry } from '../src/jev.js';

interface Expected {
  target: DetailTarget;
  rows: { section: string; label: string; value: string }[];
  downloads: { url: string }[];
}

const [evidenceDir, runDir] = process.argv.slice(2);
if (!evidenceDir || !runDir) throw new Error('usage: tsx bench/detail-deublin-verify.ts <evidence-dir> <run-dir>');
const load = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const compilation = load<DetailCompilation>(join(runDir, 'compilation.json'));
const targets = load<DetailTarget[]>(join(evidenceDir, 'targets.json'));
const trace = load<TraceEntry[]>(join(runDir, 'trace.json'));
const expectations = targets.map((_, i) => load<Expected>(join(evidenceDir, `sample-${i}-expected.json`)));

function compare(result: DetailResult | undefined, expected: Expected) {
  const actual = Object.entries(result?.values ?? {}).map(([key, value]) => ({
    path: JSON.parse(key) as string[], value,
  }));
  const fields = expected.rows.map((row) => {
    const matches = actual.filter(({ path }) =>
      path.at(-1) === row.label && path.at(-2) === row.section);
    return {
      section: row.section, label: row.label, expected: row.value,
      actual: matches.map((m) => m.value),
      correct: matches.length === 1 && matches[0]!.value === row.value,
    };
  });
  const downloads = expected.downloads.map(({ url }) => ({
    url, correct: result?.downloads.some((d) => d.url === url) ?? false,
  }));
  return {
    url: expected.target.url,
    identity_matched: result?.identity === 'matched',
    status: result?.status,
    fields,
    downloads,
    issues: result?.issues,
  };
}

const browser = await chromium.launch({
  headless: defaultHeadless(),
  args: defaultHeadless() ? [] : ['--window-position=-2400,-2400'],
});
const replays: DetailResult[] = [];
try {
  // Restore the anonymous consent state captured by compilation. Replay does not ask Jev.
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
    storageState: join(runDir, 'browser-state.json'),
  });
  for (const [i, target] of targets.entries()) {
    if (i) await new Promise((resolve) => setTimeout(resolve, 1_500));
    const page = await context.newPage();
    const result = await readDetail(page, compilation.recipe, target);
    replays.push(result);
    writeFileSync(join(runDir, `replay-${i}.json`), JSON.stringify(result, null, 2));
    await page.screenshot({ path: join(runDir, `replay-${i}.png`), fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
}
const compileChecks = expectations.map((e) => compare(
  compilation.samples.find((s) => s.target.url === e.target.url), e));
const replayChecks = expectations.map((e) => compare(
  replays.find((s) => s.target.url === e.target.url), e));
const tally = (checks: ReturnType<typeof compare>[]) => ({
  identity_matches: checks.filter((c) => c.identity_matched).length,
  products: checks.length,
  correct_fields: checks.flatMap((c) => c.fields).filter((f) => f.correct).length,
  expected_fields: checks.flatMap((c) => c.fields).length,
  correct_downloads: checks.flatMap((c) => c.downloads).filter((d) => d.correct).length,
  expected_downloads: checks.flatMap((c) => c.downloads).length,
});
const report = {
  evidence_dir: evidenceDir,
  run_dir: runDir,
  compile: tally(compileChecks),
  replay: tally(replayChecks),
  compile_checks: compileChecks,
  replay_checks: replayChecks,
  compilation_issues: compilation.issues,
  jev_calls: trace.length,
  input_tokens: trace.reduce((n, t) => n + t.input_tokens, 0),
  models: [...new Set(trace.map((t) => t.model))],
};
writeFileSync(join(runDir, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  compile: report.compile, replay: report.replay,
  jev_calls: report.jev_calls, input_tokens: report.input_tokens, models: report.models,
}, null, 2));
