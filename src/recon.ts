import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assessPage, type Assessment } from './assess.js';
import { open } from './browser.js';
import type { Judge } from './jev.js';

export type ReconReport = Omit<Assessment, 'snap'> & {
  input_url: string;
  final_url: string;
  groups: Assessment['snap']['groups'];
  jev_calls: number;
  jev_input_tokens: number;
  elapsed_ms: number;
};

/** Open one URL, answer blocking prompts, and judge what to do with the page. */
export async function recon(url: string, judge: Judge, outDir?: string): Promise<ReconReport> {
  const started = performance.now();
  const callsBefore = judge.trace.length;
  const session = await open(url);
  try {
    const { snap, ...a } = await assessPage(session.page, session.context, judge, { gates: true });
    const calls = judge.trace.slice(callsBefore);
    const report: ReconReport = {
      input_url: url,
      final_url: snap.url,
      ...a,
      groups: snap.groups,
      jev_calls: calls.length,
      jev_input_tokens: calls.reduce((n, c) => n + c.input_tokens, 0),
      elapsed_ms: Math.round(performance.now() - started),
    };
    if (outDir) {
      mkdirSync(outDir, { recursive: true });
      await session.page.screenshot({ path: join(outDir, 'page.png') }).catch(() => {});
      writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
      writeFileSync(join(outDir, 'trace.json'), JSON.stringify(calls, null, 2));
    }
    return report;
  } finally {
    await session.browser.close();
  }
}
