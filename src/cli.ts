import { createJudge } from './jev.js';
import { crawl, renderTree } from './crawl.js';
import { recon } from './recon.js';

const [command, url, outArg] = process.argv.slice(2);
if (!['recon', 'crawl'].includes(command ?? '') || !url) {
  console.error('usage: npm run recon -- <url> [out-dir]\n       npm run crawl -- <url> [out-dir] [maxPages]');
  process.exit(2);
}
if (command === 'crawl') {
  const out = outArg ?? `artifacts/crawl/${new URL(url).host}-${Date.now()}`;
  const maxPages = Number(process.argv[5] ?? 40);
  const r = await crawl(url, createJudge(), { outDir: out, maxPages, log: (l) => console.log(l) });
  console.log(`\n${renderTree(r)}\nartifacts: ${out}`);
  process.exit(0);
}
const out = outArg ?? 'artifacts/recon/latest';
const r = await recon(url, createJudge(), out);
console.log(JSON.stringify({
  final_url: r.final_url,
  gates: r.gates.map((g) => (g.decision.action === 'click' ? `${g.decision.role} "${g.decision.label}"` : g.decision.reason)),
  page_kind: `${r.judgment.page_kind.choice} (${r.judgment.page_kind.confidence.toFixed(2)})`,
  listed_items: r.listed_items,
  probes: r.probes.map((p) => `${p.kind ?? 'error'} ${p.confidence?.toFixed(2) ?? ''} ${p.url}`),
  main_items: r.main_items,
  next: r.next,
  view_all: r.view_all,
  jev_calls: r.jev_calls,
  tokens: r.jev_input_tokens,
  elapsed_ms: r.elapsed_ms,
  artifacts: out,
}, null, 2));
