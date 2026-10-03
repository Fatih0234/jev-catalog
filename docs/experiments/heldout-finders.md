# Held-out product finders

## Question

Can the current scraper learn a reusable recipe on a new manufacturer's site, then apply that frozen recipe to products and listing pages not used to teach it?

This records candidate selection and the first discovery baseline. No Jev answers were used to select these sites or label their behavior.

## Candidate sources

These manufacturers are absent from the current `bench/suites/finders.json` and `bench/suites/hubs.json`. That establishes separation from those development suites, not from Jev's training data or every past project.

| Manufacturer | First-party entry | Reason to inspect |
| --- | --- | --- |
| Leuze | [Fiber optics](https://www.leuze.com/en-us/products/switching-sensors/fiber-optic-sensors/fiber-optics) | The indexed page describes an article list and product selector. |
| Schmalz | [Flat suction cups SPF](https://www.schmalz.com/en-us/products/vacuum-technology-for-automation-301607/vacuum-components-301608/vacuum-suction-cups-301609/suction-cups-for-the-packaging-industry-304415/flat-suction-cups-spf-304419) | The indexed family page contains named variants, specification rows and a result range. |
| Banner Engineering | [QS18 series](https://www.bannerengineering.com/us/en/products/sensors/photoelectric-sensors/qs18-series.html) | A series page with model documentation. The browser check must establish whether models are listed on the page. |
| Baumer | [Inductive proximity switches](https://www.baumer.com/lu/en/product-overview/object-detection/inductive-proximity-switches/c/278) | A product-category entry. The browser check must establish the route to its selector. |
| Omron | [Product selection tool](https://automation.omron.com/en/us/support/product-selection-tool) | Describes the ONSeT search and configuration tool. This may be a tool landing page rather than a usable finder. |
| Turck | [Inductive sensors](https://www.turck.ca/en/productgroup/Sensors/Inductive%20Sensors) | A first-party product-group entry. Availability and the actual finder route need browser verification. |

Search excerpts identify candidates only. Browser evidence determines eligibility and expected behavior. A blocked page or a tool landing page must not be presented as a working product list.

## Evidence before evaluation

Capture the rendered page without Jev or the scraper's observers. Keep screenshots, raw HTML, visible text, observed links and controls, landed URLs, console output and network-request logs.

The scout captures live under `artifacts/heldout-finder-scout-2026-10-01/`. The lead reviewed all screenshots and raw state before authoring `bench/suites/heldout-finders.json`. Labels were frozen before its first Jev run.

The implementation's source and dependency hashes are recorded in `artifacts/heldout-finder-baseline-2026-10-01.json`. The existing Git commit alone would omit the uncommitted stage 5 code.

### Browser findings

| Case | Observed behavior | Evaluation group |
| --- | --- | --- |
| Leuze fiber optics | Article cards, companion amplifiers, numbered paging, "100 products found" | listing |
| Schmalz SPF | Series overview with individual variant cards, "1 - 10 from 38 results" | listing |
| Banner QS18 | Series overview with a parametric model table, "Results 1-30 of 457", Load More | listing |
| Baumer portfolio | Category and family cards linking to selectors, no article list | navigation |
| Baumer selector | The portfolio's observed [selector link](https://www.baumer.com/lu/en/product-overview/object-detection/inductive-proximity-switches/c/278/products) opens a technical table, "694 products", Show more products | listing |
| Omron selection tool | Registration instructions and an ONSeT Login link, no products or selection form on this page | negative control |
| Turck inductive sensors | Individual Type and ID cards, "3096" search results, numbered paging | listing |

These totals describe the captured pages. The first discovery assessment does not score counts or values.

Schmalz redirects the seed to a canonical path under `/products/automation-743270/`. Banner's final capture still shows its Data Usage Settings overlay, despite a Decline click. Omron's observed login destination is `https://omronsolutions.com/`; it was not visited.

The scout overwrote Leuze's initial headless access-denial capture during a headed retry. Only the successful headed capture is retained, so that first failure has no inspectable evidence and is not scored. All runnable cases use the project's normal headed-browser mode.

Keep input-dependent finders, login requirements and blocked pages separate from eligible listing tests. Do not silently replace them with easier pages or exclude them after inspecting Jev output.

## Two independent tests

### Discovery on new sites

Freeze the current implementation before its first Jev run on these candidates. Record whether it identifies the correct main content and next action, learns a listing recipe, and finds observed product destinations.

Page classification alone is not robot success. A classification bench and a recipe-execution bench answer different questions.

### Replay on untaught pages

For each eligible site, record the teaching URLs and test URLs before compilation. Product URLs and identities must not overlap between the two groups. Listing replay must use a page not used to build the listing recipe.

Compile using the teaching group, save the recipe, then replay against the test group without Jev. Compare identity, exact labelled values and download URLs against independent captures. Report unfamiliar templates and missing or conflicting content, even when some values were extracted.

Independent captures need to reveal supported hidden sections. Matching the initially visible fields does not establish completeness.

No full catalogue run is needed. Exercise an observed pagination transition and a bounded set of untaught products.

## Keeping the test independent

- Freeze expectations before inspecting Jev answers.
- Keep accessibility failures separate from extraction and identity failures.
- Report exact mismatches and extra output, not only matching expected fields.
- Record Jev calls during learning and verify zero calls during replay.
- Keep the first result when a failure leads to a fix. That case becomes development evidence; reserve fresh cases for the next held-out evaluation.
- Do not claim generalization from replaying the same products used in compilation.

## Current status

Scouting, label review and the first discovery assessment are complete. The frozen suite has five listing cases, one navigation case and one negative control across six manufacturers. No extraction or replay score is available for this candidate set.

The later bounded [recipe-learning experiment](heldout-recipes.md) tests Leuze and Schmalz. Both fail detail compilation at identity verification. It does not establish successful detail generalization.

```bash
set -a; . ~/.config/typesafe/.env; set +a
npx tsx bench/recon.ts heldout-finders
```

The existing recon summary excludes rows with no classification result from its headline denominator. Report against every planned case, count absent results as failures, and show listing, navigation and negative-control outcomes separately.

## First discovery run, 2026-10-01

The implementation and labels stayed unchanged. The single run is saved in `artifacts/bench/heldout-finders-2026-10-01T20-00-33-819Z/`. The lead checked the reports, traces and screenshots, then scored every planned case in `discovery-score.json`.

| Group | Planned | Reports produced | Page kind correct | Main item kind correct | Next action correct |
| --- | --- | --- | --- | --- | --- |
| Product lists | 5 | 4 | 4/5 | 3/5 | 3/5 |
| Navigation | 1 | 1 | 1/1 | 1/1 | 1/1 |
| Negative control | 1 | 1 | 0/1 | 1/1 | 1/1 |
| All cases | 7 | 6 | 5/7 | 5/7 | 5/7 |

Four of seven cases pass all three checks together. Baumer's category/family alternatives and the series-detail alternatives were declared before the run, not added afterward.

### What worked

Leuze and Schmalz selected their actual product groups and routed to `extract`. Their two item probes each returned `single_product`. Baumer's selector selected its 30-row technical table and routed to `extract`. The portfolio page selected its eight groupings and routed to `expand_items`.

These are discovery outcomes. No listing recipe, detail recipe or held-out product values were evaluated in this run.

### Failures and qualifications

- Turck's real product cards were observed as `g1`, but the model chose the `g3` category sidebar as the main group. The pipeline returned `expand_items` rather than `extract`. This is a selection failure on a rendered product list, not a missing candidate.
- Banner failed with `frame.evaluate: Execution context was destroyed, most likely because of a navigation`. The failed run produced no per-case report, screenshot or trace. Its error is retained in `summary.json` and the command log. The exact navigation or frame event causing the exception has not been established.
- Omron was classified as `finder_needs_input` at confidence 0.96 even though the captured page contains tool information and registration instructions. The pipeline still selected no main group and stopped, so routing passed while page-kind classification failed.
- Baumer's two portfolio probes and two selector product probes returned Cloudflare "Sorry, you have been blocked" pages. The entry pages passed discovery, but child-page access and detail extraction are not established. Do not count this as an end-to-end working site.
- The bench's original headline reads 5/6 for all three metrics because it excludes Banner. The all-planned-case result is 5/7. Neither score measures robot replay.

The existing bench reports 28 Jev requests and 126,934 input tokens. The command log is `/tmp/jev-heldout-finders-discovery-2026-10-01.log`. No failure was repaired or retried to improve this baseline.

## Next measurement

Use Leuze and Schmalz for bounded recipe-learning and untaught-product replay, with independent field and download evidence captured first. Freeze teaching and test URLs before compilation. Keep the Turck, Banner and Omron failures for later investigation instead of relabelling them. Respect Baumer's access blocks.

This set found limitations that the familiar finder suite did not expose. It does not yet answer whether an automatically learned robot generalizes.
