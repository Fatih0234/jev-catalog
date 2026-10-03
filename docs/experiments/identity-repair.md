# Detail identity repair

## Question

Can the observer offer the main product's part number after navigation, and can the saved identity rule verify a different product without Jev?

The preceding [recipe experiment](heldout-recipes.md) failed before detail learning. This follow-up fixes the deterministic identity defects and tests the remaining detail workflow. It does not fix listing extraction, pagination, field-section alignment or downloads.

## Change

The observer used the first collected block as the end of the product-header region. A link-only navigation block could occur before the product name. Schmalz's live diagnostic confirmed this. Replaying saved Leuze HTML also reproduced the cutoff at its breadcrumbs.

`src/page/detail.js` now uses the first block with label/value rows as that cutoff. Scope, visibility, accessory exclusions and related-section checks remain active. Candidate values do not come from URLs.

Schmalz also places its number inside the label paragraph, followed by a description paragraph. The old reader used the next paragraph as the value. The reader now prefers one visible inline value. For sibling values, it skips non-rendered metadata. It still requires an adjacent `dd` for a `dt`, and it does not read hidden values.

`src/detail.ts` records new identity rules by candidate source and label. It does not bind them to a product-specific heading. Existing recipes with a section filter still use that filter. Full expected-code matching remains required, before and after reveals.

No Jev questions, thresholds or teaching sample sizes changed.

## Local proof

The two regressions use the existing public `observeDetail`, `compileDetailRecipe` and `readDetail` interfaces with routed HTML and a fake Jev service.

- The navigation regression initially failed with zero primary candidates. Changing only the cutoff left it failing because the inline number was still bound incorrectly. Fixing the inline value made the workflow verify identity and extract Voltage as `24 V`.
- The accessory number appears before the technical table, inside the expanded search area. Its Accessories section excludes it from identity candidates.
- The description regression compiles from three Leuze-shaped products, then verifies a fourth with a new code and description. It failed while the identity rule included the first description and passed after removing that binding.

Red and green logs are `/tmp/jev-identity-nav-red.log`, `/tmp/jev-identity-nav-boundary-only.log`, `/tmp/jev-identity-nav-green.log`, `/tmp/jev-identity-locator-red.log` and `/tmp/jev-identity-locator-green.log`.

Playwright CLI also exercised the new `/n1` fixture with the native observer. It offered `10.01.01.13237` and rejected accessory `10.01.06.02802`. The observation, screenshot and console/network logs are in `artifacts/identity-repair-evidence-2026-10-03/n1-verify/`. The console contained only a favicon 404.

## Fresh test set

`bench/suites/identity-repair-recipes.json` retains the original three teaching products per site. Its five new test targets per site are the first five primary products on the previously captured second listing pages. None is an earlier detail teaching or test target.

Independent captures reveal Leuze's Downloads tab, and Schmalz's Technical Data and Documentation disclosures. They do not use Jev or the detail observer. CAD downloads and login are outside the independent expectations.

The checked expected data is `artifacts/identity-repair-evidence-2026-10-03/expectations.json`. Its SHA-256 is `40e83b5bac76165e15b7268961de6da67e177275a9236122a430804c1e04b8d1`. Teaching expectations are reused exactly from the earlier frozen data, not extracted again. `freeze.json` records the check before model calls.

A local helper was missing during the first Leuze capture attempt. Empty files and incorrect note markers were corrected before the expectations were built or Jev ran. `actions.md` records this capture failure. All final captured fields are supported by the recorded visible text and HTML.

The new benchmark flag `--details-only` excludes listing and pagination work. The earlier failed benchmark remains unchanged.

## Results

Compilation and replay ran once. The recipes were not repaired using test results.

| Check | Leuze | Schmalz |
| --- | --- | --- |
| Identity-matched teaching products | 1/3 | 3/3 |
| Identity-matched fresh test products | 5/5 | 5/5 |
| Exact expected test specification values | 0/231 | 100/100 |
| Expected test download URLs | 0/73 | 9/9 |
| Extra output fields outside the audited expectations | 0 | 30 |
| Fully clean test products | 0/5 | 0/5 |

All ten outcomes remain in the denominator. No fresh test run is blocked or missing. Every test result is `partial`. Identity success is not complete extraction success.

Replay runs without `TYPESAFE_API_KEY`, does not create a Judge, and records zero forbidden API attempts. Learning records 26 successful responses and 64,896 input tokens on `jev-1.13.0`. `integrity.json` verifies that sources, expected data, source captures and saved recipes did not change during the run.

### Leuze

All three teaching pages now expose the correct numeric part number. Jev also marks the descriptive model code as `primary_code` on two pages. Those probabilities are 0.66 and 0.62, above the unchanged 0.6 threshold. The numeric part number has probability 1 on both. The exact-code verifier rejects the conflicting identities rather than choosing one silently.

The one identity-matched teaching page produces a usable partial recipe and all 46 independently expected specification values. It produces no download URLs, even though the Downloads tab is clicked. The download-collection cause remains unresolved.

Fresh replay verifies all five numeric codes. However, section and control keys still include the product description. The learned paths begin with "Glass fiber optics type diffuse reflective". Test paths begin with different glass or plastic fiber-optics descriptions. The saved declarations do not match these paths, so replay reports template/schema drift and accepts no fields. This is separate from the repaired identity rule.

### Schmalz

The three teaching pages verify identity and reproduce their expected specifications and document links.

Fresh replay reproduces all 100 audited specification values and nine document URLs. It also emits four overview fields per product under "Show moreShow less". These are duplicates outside the audited technical sections, not thirty incorrect product values.

Two more fields per product are genuinely not product attributes. The observer treats table headings as `Attribute = Value` under both Design Data and Technical Data. These ten header fields plus twenty overview fields make the thirty extras.

Every test reports template drift. One also reports unrecognized spare-part/recommendation blocks. The product with a CAD preview reports an unsupported content frame after the recipe reveals CAD data. No login or file download is performed, and CAD extraction is not counted as supported.

## Verification

- `npm run check` passes typecheck and all 131 tests across seven files.
- `npx tsx bench/recon.ts finders` retains 15/15 correct next actions and 14/15 main-item judgments. Page-kind results are 12/15, compared with the historical 11/15. This is one live run, not evidence that the identity change improves discovery.
- Finder output is in `artifacts/bench/finders-2026-10-03T00-21-24-388Z/`. It contains all fifteen planned cases and no runtime failures.
- Compilation is in `artifacts/identity-repair-compile-2026-10-03/`. Replay, `score.json` and integrity checks are in `artifacts/identity-repair-replay-2026-10-03/`.

## Reproduce

The commands used for this run were:

```bash
set -a; . ~/.config/typesafe/.env; set +a
JC_HEADLESS=0 npx --no-install tsx bench/heldout-recipes.ts compile \
  bench/suites/identity-repair-recipes.json \
  artifacts/identity-repair-evidence-2026-10-03/expectations.json \
  artifacts/identity-repair-compile-2026-10-03 --details-only

env -u TYPESAFE_API_KEY JC_HEADLESS=0 npx --no-install tsx bench/heldout-recipes.ts replay \
  bench/suites/identity-repair-recipes.json \
  artifacts/identity-repair-evidence-2026-10-03/expectations.json \
  artifacts/identity-repair-replay-2026-10-03 \
  artifacts/identity-repair-compile-2026-10-03 --details-only

npx --no-install tsx bench/heldout-recipe-score.ts \
  artifacts/identity-repair-evidence-2026-10-03/expectations.json \
  artifacts/identity-repair-compile-2026-10-03 \
  artifacts/identity-repair-replay-2026-10-03 \
  artifacts/identity-repair-replay-2026-10-03/score.json
```

Use new output directories to repeat the run. The commands refuse to replace saved runs or scores.

## Next step

Separate product descriptions from specification-section keys. Exclude table headers from product values. Then investigate Leuze's download observation and identity-judgment ambiguity. Keep the new failures as development evidence, and reserve fresh products for the next generalization measurement. Listing URL, label and companion-product defects remain open.
