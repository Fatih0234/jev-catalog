# Detail recipe

Can a product detail page be read once with Jev and then replayed without it, the way the listing recipe works? Code reveals tabs and accordions, Jev says what each block and control holds, and code aligns field keys across three sampled items.

## Status

Built with local browser tests and verified on three live Deublin products. The first live run exposed an identity-locator problem. A local regression test and a second live run verified the fix.

## What was built

`src/detail.ts` exports `compileDetailRecipe` and `readDetail`. `src/page/detail.js` observes a page inside its `main` scope, or the smallest substantial ancestor of the primary `h1`, and returns bounded evidence:

- identity candidates limited to the primary header region before the first technical block, from `itemprop` code metadata, explicit code-labelled pairs such as "Item no.", and code-like tokens in primary headings;
- disclosure controls with proof of disclosure: wired tabs, `aria-controls` or `aria-expanded` or `data-bs-target` buttons bound to a local panel, `details` summaries, and accordion headers with a sibling content region, tagged `data-jc-detail-control` per read;
- label/value blocks: two-cell table rows, adjacent `dt`/`dd` pairs, peer two-cell rows with a shared structural signature, alternating pairs in a computed CSS grid, and colon-labelled lines, each with its heading ancestry as the section path;
- a detail-specific text fingerprint and truncation and unsupported-frame diagnostics.

Compilation opens its own page per target, validates the target URL, checks that the landing page stays on the target site and locale, and checks HTTP status plus error-page title and content patterns before asking anything. It then reuses `clearGates` from `src/gate.ts` to answer consent, locale or newsletter prompts through the existing gate question, and re-observes the page before judging it. It asks `detail-identity` for the primary product code, then `detail-content` for every observed control and block. After each reveal it re-observes, asks again for only the newly mounted shapes, rechecks the page health and re-verifies the identity. Roles are never inferred from a parent control's label: a nested variant or cart control inside a specifications panel is judged on its own and stays unclicked when `other`. A control or block whose answer is missing, malformed or below the role threshold becomes `role_unverified` and the sample `partial`.

Blocks and controls carry stable keys built from kind, label, panel wiring heading and the full section path. Block roles are remembered per exact observed content shape, so two differently labelled tables in one section keep their own judgments. Blocks are re-judged when their row or link labels change. A block positively judged non-content is remembered in `ignored_sections` with its label shape, so replay does not flag it.

Field keys use `detailFieldKey(section, label)`, so "D" and "d" stay distinct and a repeated "Voltage" in two sections stays two fields. The recipe keeps the union of fields over identity-matched usable samples, with `sample_coverage` counted over those samples.

## Replay

`readDetail` runs without a Judge. It verifies the primary identity through the recorded source, label text and section. It then reveals the recipe's declared controls, deepest section path first, so a sibling tab cannot hide a panel that still needs extraction. Each click re-observes and requires exactly one match before clicking a fresh element. The post-click watch starts when the click returns, so a control that takes time to become clickable still gets the full observation budget.

Templates are separated by a code-derived signature: the identity locator shape plus the sorted initial control keys. Each recorded reveal knows the signatures it appeared on, so an optional control on one template is not demanded of another. A page whose signature is unknown gets `template_drift` and `partial`; a declared reveal missing on a known template gets `reveal_missing`; an ambiguous match gets `reveal_ambiguous`.

Replay trusts only declared section shapes. A novel field inside a block that shares labels with an accepted shape is kept and flagged `schema_drift`. A block whose labels are disjoint from every accepted shape, or that sits in an undeclared section, is reported `schema_drift` and not extracted. New link labels inside an accepted downloads shape are kept and flagged the same way.

## Local verification

The fixture in `test/helpers/detail-site.ts` serves pages over `node:http` and the same HTML through Playwright routes in `test/detail.test.ts`. Jev is a scripted judge that never touches the network.

`npx tsx bench/detail-local.ts artifacts/detail-local-verified` compiled three products:

- all three samples `ok` and `matched`, recipe with 12 fields, 9 sections, 5 reveals and 3 templates;
- replay of `/b` ended `ok` with no issues;
- replay of `/d` ended `partial` with `schema_drift` on its novel "Coating" field and a new accessories shape.

The capture lives in `artifacts/detail-local-verified/`; the earlier `artifacts/detail-local/` run predates the shape-keyed role cache and is kept only as history.

The suite covers the failure modes chosen before implementation: hidden rows and nested hidden text are never read, `display:contents` values render through while a `display:none` ancestor still hides them, malformed `dl` pairs bind only adjacent `dt`/`dd`, single-row labelled tables survive, lazily mounted panels get fresh judgments before any click, remounted controls are re-matched on fresh ids, stale control tags are cleared before every observation, duplicate stable controls are refused as `reveal_ambiguous`, a silent product swap at an unchanged URL empties the values and reports `navigation_changed`, a delayed `?productId=` navigation is caught even after a slow click, an initial redirect to another origin ends the sample before any question, a reveal that replaces the main region with an error page discards everything, an error page with the code only in the footer is `blocked`, a "please log in" price row is not an error, a complete heading code like `1005-000-001` verifies identity while a bare "73" does not, answers below the role threshold cause no reveals, missing required reveals and unknown templates replay as `partial`, disjoint blocks in a declared section are drift rather than data, a shape judged content by one sample and non-content by another is tombstoned with `role_conflict`, a consent overlay is answered through the gate seam, multi-origin target batches are refused before any page opens, a large cross-origin frame reports `unsupported_frame`, and the reveal cap is reported as `reveal_limit`.

## Decisions

- A reveal that changes the document or swaps the product ends the sample as `navigation_changed`, because URL equality does not prove the same product.
- A heading containing the literal expected code becomes `{code}` in recipe section paths so they replay across products; raw headings stay in the evidence.
- Duplicate conflicting values for the same section and label are kept once and reported `conflicting_values` with `partial`.
- `DetailRecipe` gained optional code-generated fields: `identity` with its locator section, `templates`, and per-reveal `role`, `section` and `expected_on`. Sections and `ignored_sections` entries carry the row and link labels observed in accepted shapes so replay can match or reject shapes without a model.
- Content-bearing child frames, including cross-origin ones the reader cannot inspect, are reported `unsupported_frame` and `partial`, not read.
- Gate dismissal is compile-only. Replay requires an already-cleared browser context and does not dismiss new consent overlays.
- Invalid and conflicting input targets are reported as `invalid_target` and `shared_url` before any page opens; a multi-origin batch is refused outright because a recipe describes one site.
- Selection diagnostics are persisted to `inputs.json` in the output dir before a browser or key is touched; the CLI exits 2 on invalid input and 1 when nothing usable was sampled.

## Limits

- The 0.6 role probability in `DETAIL_POLICY.roleProbability` has not been calibrated across sites.
- The identity locator replays the first matched candidate shape per recipe; a site mixing locator styles across products may verify fewer.
- Compile assumes one origin; multi-origin targets are rejected.
- Live detail validation currently covers three Deublin products. WAGO-style tabs and accordions still have only local-fixture coverage.

## First live run, 2026-10-01

The user approved live Jev calls. The JavaScript SDK, Choice, State and pre-parsed value extraction docs were read from `docs.typesafe.ai` before this run.

The inputs were the saved Deublin selector listing from `artifacts/listing-bench/2026-09-30T23-19-06-338Z/deublin-selektor/`. Listing discovery and pagination were not rerun. Code selected the first, middle and last distinct products:

- `1005-000-001`
- `1005-011-037`
- `1005-020-039`

Before any detail Jev call, an independent reader captured the site's named product-detail rows and download-card URLs. It did not use the detail observer to generate the expected values. Screenshots, HTML, expected values and the observer's output are saved in `artifacts/deublin-detail-evidence-2026-10-01/`. The first product has 18 fields and the other two have 21 each. Each has four download links. These captures are fixed inputs for the comparisons, not labels regenerated after seeing Jev's answers.

The initial live compilation matched all three identities, all 60 field values and all 12 per-product download links. Deterministic replay matched only the first product, with 18 of 60 values and four of 12 links. The other pages exposed their correct codes but failed identity verification.

The recorded locator included the first product's descriptive `h1`. That title differs between variants. The observer had treated a preceding header wrapper as a section heading, and also included the global navigation header in section paths. The saved before-run artifacts are in `artifacts/deublin-details-live-before/`.

This run used `jev-1.13.0`, with 10 recorded requests and 18,640 input tokens. No role threshold or Jev question changed.

### Fix and second run

The new local browser test reproduced the title leaking into the identity locator before the fix. The reader now accepts a preceding header as an accordion heading only when it forms a visible, local header/body pair. It excludes the primary product `h1` from every section-heading source. A download-only block can also retain its own single visible heading.

The second live run used the same listing and the same fixed expected values. It did not recapture or relabel the pages.

| Replay check | Before | After |
| --- | --- | --- |
| Identity matches | 1/3 | 3/3 |
| Exact field values | 18/60 | 60/60 |
| Per-product download URLs | 4/12 | 12/12 |

All three compile and replay results ended `ok` without issues. The corrected recipe records the identity source as `heading`, the locator as `h2`, and the three sections as `Maße`, `Betriebsdaten` and `Dokumente und Ressourcen`. It does not contain navigation text or a product title in those paths.

The after-run artifacts are in `artifacts/deublin-details-live-after/`. The run made 10 Jev requests with 18,307 input tokens, using `jev-1.13.0`. Replay made no Jev requests. It restored the anonymous browser consent state saved by compilation.

`npm run check` passed 129 tests across seven files, including 51 detail tests. The regression's failing and passing logs are saved in `/tmp/jev-stage5-deublin-regression-red.log` and `/tmp/jev-stage5-deublin-regression-green.log`. The full check log is `/tmp/jev-stage5-final-live-check.log`.

### Finder regression

The unchanged finder suite was run once against its existing labels. No site was relabelled.

| Metric | Historical 22:01 run | Current live run |
| --- | --- | --- |
| Next action correct | 15/15 | 15/15 |
| Main items correct | 14/15 | 14/15 |
| Page kind correct | 11/15 | 11/15 |

The historical figures come from experiment 1. This is a comparison with a prior live run, not a controlled test of identical captured pages. The current run made 63 requests with 232,153 input tokens. Results are saved in `artifacts/bench/finders-2026-10-01T15-42-45-589Z/`.

## Reproduce

```bash
npm test -- test/detail.test.ts          # 51 tests, no API calls
npx tsx bench/detail-local.ts [out-dir]  # compile on the local fixture, writes artifacts
npx tsx bench/detail-local.ts --serve    # keep the fixture site up for browser inspection
npm run details -- <listing.json> [out-dir]   # live entrypoint, needs TYPESAFE_API_KEY
```

The independent capture refuses to reuse an output directory. Keep the original capture for before/after comparisons:

```bash
npx tsx bench/detail-deublin-evidence.ts <new-evidence-dir>  # no Jev
npx tsx bench/details.ts <rows.json> <recipe.json> <new-run-dir>
npx tsx bench/detail-deublin-verify.ts <evidence-dir> <run-dir>  # Jev-free replay and comparison
npx tsx bench/recon.ts finders
```
