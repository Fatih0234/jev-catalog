# Recipe learning on new sites

## Question

Can the unchanged scraper learn listing and detail recipes from Leuze and Schmalz, then replay those recipes on untaught products without Jev?

The first attempt failed during detail learning. Neither site produced a usable detail recipe. This establishes a robot-creation failure, not the generalization rate of a successfully compiled detail recipe.

The later [identity repair](identity-repair.md) preserves this first result and tests five fresh detail products per site after the source fix.

## Fixed inputs

`bench/suites/heldout-recipes.json` selects three teaching products and five test products per site. They are the first eight primary product links in the earlier independent finder captures. Leuze's companion amplifiers are outside the fiber-optics list. Teaching and test detail URLs and codes do not overlap.

Each site also has one teaching listing page and its second numbered page for testing. The independent captures follow the observed page-2 control. The listing pages have no overlapping primary products.

Test-product names and some listing specifications appear on the teaching listing page. The separation is between detail teaching and detail testing, not between every mention of a test product and the model. No test detail page enters detail compilation. Listing classification uses the existing question builder without child probes.

The raw evidence is in `artifacts/heldout-recipe-evidence-2026-10-03/`. It contains HTML, visible text, observed links and controls, snapshots, screenshots, console logs and request logs. Captures reveal Leuze's Downloads tab and Schmalz's Technical Data and Documentation disclosures. Schmalz's initial Design Data is already expanded.

The checked expectations are `expectations-v2.json`, with SHA-256 `fb620ffc448cd4ec8ad35759842c765ab00e48118345c0e4ba68f2dc6c146977`. `freeze.json` records the check before compilation. The first draft omitted Leuze's observed KFX model from page 2. That pre-model labelling mistake was corrected, and the draft remains as `expectations.json`.

Expected fields come from the site's tables, parsed offline without scraper observers. Section names, labels, case, units and punctuation stay exact. Comparisons fold whitespace and use Unicode NFC only. Download expectations cover observed links in the product download sections, not footer PDFs, file contents or login-gated CAD downloads.

| Site | Untaught detail products | Expected specification values | Expected download URLs | Untaught listing rows |
| --- | --- | --- | --- | --- |
| Leuze | 5 | 238 | 72 | 12 |
| Schmalz | 5 | 100 | 9 | 10 |

## First result

The source and Jev questions stayed unchanged. Compilation and replay ran once, in separate processes. Replay ran without `TYPESAFE_API_KEY`, did not construct a Judge, and recorded zero forbidden TypeSafe API attempts.

| Check | Leuze | Schmalz |
| --- | --- | --- |
| Identity-matched teaching products | 0/3 | 0/3 |
| Usable detail recipe | none | none |
| Identity-matched test products | 0/5 | 0/5 |
| Accepted test specification values | 0/238 | 0/100 |
| Accepted test download URLs | 0/72 | 0/9 |
| Second listing page | not evaluated after runner failure | reached the expected page |
| Test listing names and article numbers | not evaluated | 10/10 each in the code-based audit |
| Test listing product URLs | not evaluated | 0/10 |

All ten test detail outcomes are retained. They stop as `identity_unverified`, with no accepted values or downloads. Those zeros do not mean the sites lack data. Independent captures contain the expected data. The scraper stops before content extraction because identity is a required precondition.

Learning recorded 17 successful Jev responses and 82,769 input tokens on `jev-1.13.0`. The traces contain no `detail-identity` or `detail-content` calls. The observer did not offer identity candidates, so the model could not help with detail learning.

## Confirmed defects and unresolved causes

### Detail identity

A separate Jev-free diagnostic visits only the first teaching product from each site. It asserts that the observer offers the visibly displayed primary code. The first diagnostic fails on both sites with zero candidates, while the body shows `50153815` and `10.01.01.13237`.

For Schmalz, an instrumented copy of the observer confirms the cause. Its earliest collected block is a link-only navigation row containing "Back to product family", "Product information" and "Ordering information". Identity collection treats the first collected block as the end of the header region. The primary code appears after this navigation row, so `in_header` is false. The code is visible, inside `main`, outside global chrome, and not in an excluded or related section. The header-boundary rule rejects it.

This is a deterministic observer defect before Jev, not an incorrect identity judgment by the model. Production source was not patched.

The second Leuze diagnostic captured an empty page with no title or scope. That observation cannot establish the mechanism behind Leuze's original missing candidates. The original rendered diagnostic remains available. The cause of the later empty page is unresolved.

### Listing extraction

Leuze's teaching extraction mixes primary products with companion amplifiers. Its first row joins the primary part number and amplifier part number as `50153815 | 50118405`. Its named specifications are also shifted. For example, "Type of fiber optics" holds "Diffuse reflection principle" instead of "Glass fiber optics (GF)". A unique identity and 100% field coverage do not prove these values are correct.

Schmalz's second-page replay retains the correct ten names and article numbers but loses every `_url`. It reports recipe fit 1 and no unknown slots despite the missing destinations. Some specification labels also remain separate unnamed fields rather than named label/value pairs.

The original scorer joins listing rows by product URL. Its zero name/code results therefore mean no URL-joined rows, not ten incorrect strings. `schmalz-listing-code-audit.json` separately joins by the declared article-code fields and verifies the ten names and codes. The original score is retained unchanged.

The exact cause of Schmalz's disappearing URLs and Leuze's label shifts needs further diagnosis.

### Experiment-runner defects

The first Leuze pagination attempt failed with `TypeSafeError: At least one question is required.` My runner called Jev with an empty paging question set. The production `paginate` function already guards this case. Leuze's pagination result is therefore unavailable, not a proven failure of the native pagination workflow.

The runner now guards empty questions and saves the paging dump and teaching screenshot before the model call. Its exact original version is retained as `baseline-driver.ts` in the compilation directory. No recompilation or replay followed this correction.

The scorer initially referred to a nonexistent `Field.label`, causing typecheck to fail. It now uses the existing field key and name. This did not change predictions or frozen expectations.

## Artifacts and checks

- `artifacts/heldout-recipes-compile-2026-10-03/` contains teaching results, listing recipes, empty detail recipes, errors, traces and anonymous browser state.
- `artifacts/heldout-recipes-replay-2026-10-03/` contains all ten test detail results, Schmalz's second-page rows, `score.json`, the separate code audit and the replay execution receipt.
- `artifacts/heldout-recipes-diagnostic-2026-10-03/` contains the original visible-code/missing-candidate proof.
- `artifacts/heldout-recipes-diagnostic-inspected-2026-10-03/` contains the observer-boundary flags for Schmalz and the later empty Leuze capture.
- `npm run typecheck` passes after the runner and scorer corrections. `npm test` passes all 129 tests across seven files.
- The diagnostic command exits 1 as expected. Its failure is preserved, not treated as a passing test.

The first `npm run check` stopped at the scorer type error before tests ran. After the correction, typecheck and tests ran separately and passed. Logs are `/tmp/jev-heldout-recipes-final-typecheck-2026-10-03.log` and `/tmp/jev-heldout-recipes-tests-2026-10-03.log`.

## V2 detail-schema experiment, 2026-10-03

The V2 implementation learns fields across three teaching products. It retains manufacturer labels, source bindings, recorded aliases and optional-field coverage. Replay uses these rules without Jev. Existing V1 recipes remain readable.

This is a new detail-only experiment. It does not rerun listing extraction or pagination. The earlier failures above and the identity-repair results remain unchanged.

### Frozen evidence and recipes

`bench/suites/detail-schema-recipes.json` keeps the original three teaching targets per site and selects five new test targets per site. No test detail page enters compilation.

Independent expectations were captured without Jev before recipe learning. The expectations contain 234 specification values and 74 download URLs for Leuze, and 100 values and nine URLs for Schmalz. The final Leuze capture initially aborted; a separate capture of the same target succeeded. Both receipts remain available.

The expectations are `artifacts/detail-schema-evidence-2026-10-03/expectations.json`, with SHA-256 `2eaf94e9c012dfb76261b5ef2058236ae5986fd09e4d4f584ed9bd96043f872f`. The manifest hash and all 216 independent evidence hashes were checked before compilation.

`artifacts/detail-schema-implementation-freeze-2026-10-03.json` records the source and runner hashes. `artifacts/detail-schema-compile-2026-10-03/recipe-freeze.json` freezes the compiled recipes, teaching results, traces and browser state before replay. These files were checked again after replay. No repair, retry or target replacement occurred during compilation or replay.

Replay ran in a separate process without `TYPESAFE_API_KEY`. Its execution receipt records no Judge, no key and zero forbidden TypeSafe API attempts.

### Results

| Check | Leuze | Schmalz |
| --- | --- | --- |
| Verified teaching identities | 3/3 | 3/3 |
| Learned fields | 46 | 24 |
| Learning state | partial | partial |
| Reported test products | 5/5 | 5/5 |
| Verified test identities | 5/5 | 5/5 |
| Correct specification values with current-product source evidence | 46/234 | 100/100 |
| Missing expected values | 188 | 0 |
| Incorrect or ambiguous returned expected values | 0 | 0 |
| Correct direct download URLs | 14/74 | 9/9 |
| Extra output fields | 0 | 20 |
| Extra download URLs | 0 | 0 |
| Fully clean products | 0/5 | 0/5 |

All ten products ended `partial`. The scorer requires an exact observed label and local section, a source URL belonging to the current product, and source values that agree with the returned value. Matching an alias name alone does not count as success.

Leuze reproduced 46 of 49 expected values and all 14 URLs on `50149673`. Its three unfamiliar fields remain unmapped evidence. The other four products returned no confirmed values or download URLs.

Schmalz reproduced every audited specification and document URL. Each product also returned four overview fields: `Size`, `Suction cup material`, `Material hardness [Shore A]` and `Thread G1`. The first three repeat technical attributes. This audit does not assert that overview `Thread G1` and dimension `G1` are the same field.

No replay result reported a value conflict, source ambiguity or failed reveal. All recorded reveal actions changed page state. These facts do not establish complete extraction: region matching still rejected four Leuze products.

### Confirmed failures

**Leuze still binds sections to the product description.** The teaching trace classifies `Glass fiber optics type diffuse reflective` as `specification_section` with probability 0.85. Code retains it in every specification and download region. The four products with different descriptions report these saved regions missing. The one matching-description product extracts fields and documents. This identifies an executed semantic-classification failure, not a download-anchor discovery failure.

**Schmalz duplicate judgments do not establish the required merges.** The duplicate probabilities for overview `Size`, `Suction cup material` and `Material hardness [Shore A]` are 0.88, 0.87 and 0.89. None reaches the fixed 0.9 relation threshold. The fields remain separate. The experiment did not lower the threshold after seeing these results.

**Initial template signatures are inconsistent.** Compilation records initially clickable controls but omits controls that start expanded. Replay includes all recorded relevant controls in its initial signature. Leuze's initially active `Technical features` tab and Schmalz's initially expanded `Design Data` disclosure therefore cause false `template_drift` on all ten products. This code defect is separate from missing fields.

**Learning inspection diagnostics are too literal.** The inspection check requires a block's panel label to equal the control label. It reports `Technical features` uninspected for Leuze and `CAD data` uninspected for Schmalz. Both recipes consequently show an empty product-level `learning.inspected` list. This must not be read as proof that no specification data was inspected. Three Schmalz test products also report an unsupported CAD frame, which is outside the direct-link scope.

These results do not establish a generally reusable scraper. The next repair should address product-description evidence, the initial expanded-control contract and inspection diagnostics. Duplicate judgments need better source context before any threshold change. Any repair must be measured separately from this frozen run.

### Verification and artifacts

- `npm run check` passed typecheck and 198 tests across nine files. The first gate caught a fixture-route rename that had accidentally redirected the label-alias test to layout fixtures. Its intended alias routes were restored, and the final gate passed. Final log: `/tmp/jev-v2-final-check.log`.
- Playwright CLI exercised the local Specifications tab, nested Electrical data disclosure and Downloads tab. It also inspected the unheaded overview fixture. Captures include `/tmp/verify-a-docs.yml`, `/tmp/verify-a-final.png` and `/tmp/verify-ov4.png`. Only favicon 404s were observed.
- `npx tsx bench/recon.ts finders` retained 15/15 correct next actions and 14/15 main-item judgments. Page-kind judgments were 12/15, versus 11/15 in the previous live run. The fixed labels were unchanged. Output: `artifacts/bench/finders-2026-10-03T12-21-19-717Z/`.
- Compilation recorded 106 successful responses and 835,755 input tokens on `jev-1.13.0`. Replay recorded zero Jev calls. Finder usage is separate.
- Teaching artifacts: `artifacts/detail-schema-compile-2026-10-03/`.
- Test outputs, per-field comparisons and the checked failure audit: `artifacts/detail-schema-replay-2026-10-03/`, particularly `score.json` and `audit.json`.
- The original 11-file staged documentation snapshot is unchanged. No commit was made.

The V2 experiment commands are:

```bash
set -a; . ~/.config/typesafe/.env; set +a
npx tsx bench/heldout-recipes.ts compile bench/suites/detail-schema-recipes.json artifacts/detail-schema-evidence-2026-10-03/expectations.json artifacts/detail-schema-compile-2026-10-03 --details-only
env -u TYPESAFE_API_KEY npx tsx bench/heldout-recipes.ts replay bench/suites/detail-schema-recipes.json artifacts/detail-schema-evidence-2026-10-03/expectations.json artifacts/detail-schema-replay-2026-10-03 artifacts/detail-schema-compile-2026-10-03 --details-only
npx tsx bench/heldout-recipe-score.ts artifacts/detail-schema-evidence-2026-10-03/expectations.json artifacts/detail-schema-compile-2026-10-03 artifacts/detail-schema-replay-2026-10-03 artifacts/detail-schema-replay-2026-10-03/score.json
```

The runner refuses existing output directories, and the scorer refuses an existing score file. Use new paths for another experiment. The recipe-freeze step must occur between compilation and replay.

## Reproduce the original experiment

Use new output paths. The commands refuse to replace existing run directories or frozen expectations.

```bash
set -a; . ~/.config/typesafe/.env; set +a
JC_HEADLESS=0 npx tsx bench/heldout-recipes.ts compile \
  bench/suites/heldout-recipes.json \
  artifacts/heldout-recipe-evidence-2026-10-03/expectations-v2.json \
  artifacts/new-compile

env -u TYPESAFE_API_KEY JC_HEADLESS=0 npx tsx bench/heldout-recipes.ts replay \
  bench/suites/heldout-recipes.json \
  artifacts/heldout-recipe-evidence-2026-10-03/expectations-v2.json \
  artifacts/new-replay artifacts/new-compile

npx tsx bench/heldout-recipe-score.ts \
  artifacts/heldout-recipe-evidence-2026-10-03/expectations-v2.json \
  artifacts/new-compile artifacts/new-replay artifacts/new-replay/score.json
```

The corrected runner differs from the preserved baseline runner. Live pages can also change. These commands reproduce the procedure, not a guarantee of identical results.

## Next step

Fix and locally reproduce the primary-identity boundary first. Then address listing URL preservation, companion-product mixing and label alignment. Keep this first failed run unchanged. Once these cases guide a fix, they become development cases. Use fresh products for the next generalization measurement.
