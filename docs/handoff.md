# Handoff

State of the work on 2026-10-01, for the next person or agent picking it up. Read this first, then `README.md`, `docs/plan.md` and `docs/findings.md`.

## Where things stand

### Detail-schema update, 2026-10-03

The approved three-product field-learning method is implemented as V2. New compilation defaults to V2; V1 recipes remain readable. `src/detail-schema.ts` learns bounded field and source relationships, then matches saved rules without Jev. The shared detail driver retains identity, navigation and fresh-click checks.

The final local gate passed `npm run check`, with 198 tests across nine files. Browser fixtures cover description changes, section and field aliases, duplicate sources, conflicting values, optional and uninspected fields, shadow DOM, remounted controls, nested reveals, credential URL rejection and direct document links.

The independent live result is not clean. Both sites verified all three teaching identities and all five test identities. Leuze reproduced 46/234 expected values and 14/74 document URLs. Schmalz reproduced 100/100 values and 9/9 URLs but returned 20 extra overview fields. Replay used no TypeSafe key or Judge. Both learning states and all ten test results are `partial`.

The frozen evidence, recipes, score and failure analysis are recorded in [the V2 experiment](experiments/heldout-recipes.md#v2-detail-schema-experiment-2026-10-03). Preserve that run. Do not repair its recipes or change its expectations.

Next work:

1. Remove product descriptions from section contracts using better evidence. Jev classified Leuze's description as a specification heading at probability 0.85, and code saved it in specification and download regions.
2. Make initial-control signatures consistent. Learning omits already-expanded controls while replay includes them. This produced false template warnings on every test.
3. Separate inspected specification regions from unavailable CAD content. The product-level inspection summary currently requires literal panel/control label equality.
4. Improve duplicate-source evidence before considering threshold changes. Schmalz's three repeated overview attributes did not reach the fixed duplicate threshold.

These are separate repairs, not passes of the frozen held-out experiment. Listing extraction and pagination repairs remain queued. Catalogue-wide execution, monitoring and the complete output report are still unfinished.

The original 11-file staged documentation snapshot is unchanged. V2 code, tests, benchmark files and the later documentation updates are not committed. Browser inspection files under `.playwright-cli/` are untracked; do not add them by staging the whole directory.

jev-catalog is a standalone TypeScript catalogue scraper built on TypeSafe's Jev. Stages 1 to 4 of `docs/plan.md` are built and measured. Stage 5 is built with local browser tests and a three-product Deublin live comparison.

| Stage | State | Write-up |
| --- | --- | --- |
| 1. Page recon | built, finders 15/15, hubs 16/20 | `docs/experiments/01-page-recon.md` |
| 2. Crawl | built, six seeds end where expected except Kennametal | `docs/experiments/02-crawl.md` |
| 3. Listing recipe | built, 8 of 8 lists with unique identity and totals | `docs/experiments/03-listing-recipe.md` |
| 4. Pagination | built, 100%, 99.5%, 96.6% and 93.5% of advertised totals | `docs/experiments/04-pagination.md` |
| 5. Detail recipe | built, Deublin replay matches 3/3 identities, 60/60 values and 12/12 per-product download URLs | `docs/experiments/05-detail-recipe.md` |
| 6. Run with Jev monitors | not started | |
| 7. Output and completeness report | partly there, rows are written per list as JSON | |

## Repository state

jev-catalog has no git remote.

| Commit | Content |
| --- | --- |
| `d797ae2` | stages 1 and 2 |
| `7b7f5f5` | stage 3 |
| `a65e62a` | stage 4 |
| staged, not committed | the experiment docs, `docs/jev-patterns.md`, `docs/site-notes.md`, the new `docs/findings.md`, README and AGENTS.md updates, and this file |

The user has approved each commit so far, one stage at a time. Ask before committing the staged docs.

The stage 5 implementation and its bench files remain uncommitted and unstaged. The original 11-file staged snapshot is preserved. Later updates to this handoff, the experiment index and site notes are unstaged additions.

The Maxun checkout at `~/projects/maxun-studio-jev`, branch `maxun-studio-jev`, has uncommitted Jev work:

- `docs/agents/typesafe-jev.md`, the Jev knowledge base for Maxun. Its new section "Lessons from jev-catalog" points to this repo by local path.
- A "TypeSafe Jev" subsection in `AGENTS.md`.
- The vendored skill in `.agents/skills/typesafe-ai/` and `skills-lock.json`.

The user never confirmed committing these. The checkout is 28 commits behind `origin/master`. AI-authoring issues #214 to #220 are closed but their code is not on this branch, and PR #213 is open.

## Setup

```bash
cd ~/projects/jev-catalog
npm install                                  # Node 22, Playwright 1.63, @typesafe-ai/sdk 0.6.0
set -a; . ~/.config/typesafe/.env; set +a    # TYPESAFE_API_KEY, file mode 600
npm run check                                # typecheck and tests, no API calls
```

The key was once pasted into the chat, and we suggested rotating it. Never print it or commit it.

The machine has `DISPLAY=:0`. The browser runs headed and off-screen because several sites block headless Chromium. On a server without a display, use Xvfb.

## Site cool-downs

Two sites were pushing back at the end of the session. Give them time before re-running.

- ifm's Akamai firewall answered "Access Denied" after a fast 34-page run. The `ifm-search-de` paging run failed for that reason.
- Elesa+Ganter serves product pages without header or table after many visits. The Elesa crawl seed returned one page.

Check a screenshot before blaming the code for a failure on either site.

The 2026-10-01 finder regression completed all 15 sites without those blocks. That does not establish that a long pagination run is safe.

## Decisions made with the user

- A product is a listed item that does not expand further. Families and series are expanded.
- A product with an options configurator counts as a family. Code refines this. A page that names one exact article number stays a product, and a listed variant table beats a configurator.
- A listing URL means that list and its pages. A hub URL means the whole tree below it.
- Scrape detail pages by default, but not every catalogue has them.
- Maxun Studio is optional. This repo stands alone.
- TypeScript SDK only. Python is out of scope.
- The user wants a short plan before implementation on a new task, and approves commits per step.
- The user approved network access and live Jev use whenever needed for this work, including paid requests. Keep the key private. Commit approval remains separate.
- All prose follows the unslop skill at `~/.agents/skills/unslop/SKILL.md`. No em dashes, no parentheses or en dashes as substitutes, no mid-sentence colons, sentence-case headings.

## Stage 5 and next validation

`src/detail.ts` exports `compileDetailRecipe` and deterministic `readDetail`. The dedicated observer is `src/page/detail.js`; detail pages are not passed through the listing reader. Jev classifies observed identity candidates, controls and blocks. Code owns extraction and interaction.

Keep the union of accepted fields with sample coverage, including fields found on only one product. Preserve section context, label case and units. Identity and page health are checked before accepting content and after reveals. A product change discards collected values. PDFs and family-specification links are outside this stage.

Read `docs/experiments/05-detail-recipe.md` before changing this module. It records the local failure cases, live before/after results and reproduction commands. The initial Deublin replay failure came from product titles leaking into the identity locator. The corrected reader replays all three sampled variants without Jev.

The latest `npm run check` passed 131 tests across seven files, including 53 detail tests. The finder regression retains 15/15 correct next actions and 14/15 main items. The latest page-kind result is 12/15, compared with the historical 11/15.

Next, validate hidden-content discovery on saved WAGO listing rows, then Pepperl+Fuchs. Take independent Jev-free evidence before detail model calls and keep it fixed for comparisons. Deublin's tested fields were already visible, so that run does not validate live tabs and accordions.

The user then prioritized a fresh product-finder test set before more features. Read `docs/experiments/heldout-finders.md` and `bench/suites/heldout-finders.json`. The unchanged scraper's first discovery run routes 3/5 new product lists correctly, with 5/7 correct next actions across all planned cases. Turck selects a category sidebar, Banner throws during observation, and Baumer's child probes are Cloudflare-blocked.

The later Leuze and Schmalz recipe experiment is recorded in `docs/experiments/heldout-recipes.md`. Three teaching and five untaught detail products per site were frozen before compilation. Both sites fail identity during teaching, producing no usable detail recipe. All ten test results remain `identity_unverified`. Schmalz reaches listing page 2 and preserves ten names and codes but loses their URLs. Leuze's teaching rows mix companion amplifiers and shift labels. Its pagination measurement is unavailable because the new runner sent an empty question set; the runner guard is corrected, but the baseline was not rerun.

A Jev-free diagnostic confirms a deterministic Schmalz defect. A link-only navigation block occurs before the product heading, and the observer uses that block as the identity header cutoff. The visible code is excluded before Jev can judge it. Leuze also offers zero candidates in the initial rendered diagnostic, but its mechanism is not established. The next step is a local identity-boundary regression and a source fix, then listing URL and label fixes. Do not add catalogue-wide execution first or relabel the failed cases.

That first experiment left production source and Jev questions unchanged. Its failed results remain preserved.

The later identity repair changes `src/page/detail.js` and `src/detail.ts`. Link-only navigation no longer cuts off the product header. Inline part numbers bind to their own value, and new identity locators do not include product descriptions. Accessory exclusions, visibility checks, exact-code verification and filters on existing recipes remain active. Two local browser regressions go red before the fixes and green afterward.

Read `docs/experiments/identity-repair.md` for the fresh follow-up. The same three teaching products per site compile recipes that verify identity on five new detail products per site, without Jev during replay. Schmalz matches all 100 expected specification values and nine document URLs, but includes duplicate overview values and table headers, and reports template drift. Leuze matches all five test identities but no expected fields or downloads. Its section keys still inherit the product description. Only one of its three teaching pages passes the identity judgment because Jev also marks two descriptive model codes as primary.

The next task is stable specification-section keys and excluding table headers, followed by Leuze download observation and identity-judgment ambiguity. Do not tune recipes to these new test products and report that as held-out success. Listing URL, field-label and companion-product problems are still open. No catalogue-wide run is needed.

All new source, bench and documentation changes remain unstaged and uncommitted. The original 11-file staged snapshot remains untouched. New expected data and results live in `artifacts/identity-repair-*2026-10-03/`.

Replay expects an already-cleared browser context. The live bench saves anonymous consent state for its Jev-free replay. The role threshold of 0.6 remains uncalibrated across sites. Posital detail-link discovery is still separate, since its saved rows have no `_url`.

Stage 6, running every product with Jev monitoring, still needs a design before implementation.

## Other open work, roughly by value

1. **Throttled-page check.** Jev judged an Elesa page without header or table a product page at 0.84. Code should check that a page has its main content before asking Jev.
2. **Page-size selects and size parameters.** ifm offers 125 per page, and Pepperl+Fuchs's `size=` parameter may return everything in one load. Both would cut page loads.
3. **Button-driven expansion.** Kennametal's categories open through buttons with no links. jev-ultrafast's click loop at `~/projects/research/jev-ultrafast` is the reference.
4. **Shifting sort orders.** Posital stops at 96.6% after three passes. Splitting the list by a filter is the next idea.
5. **Hub misses.** Balluff's Cloudflare check, Bosch Rexroth judged not a catalogue, Testo's highlight tabs. Misumi's fix still needs a full hub run, which should give 17/20.
6. **`needs_input` finders.** Endress+Hauser and similar finders need a Jev operation loop to pick filters.
7. **Re-measure stage 4** with the 1-second pause and the new repass rule. Pepperl+Fuchs should take one pass.
8. **Label review.** A human has not checked the bench labels in `bench/suites/*.json` yet.

## Where to look

| Need | File |
| --- | --- |
| What a stage does and why | `docs/experiments/0N-*.md` |
| How to ask Jev something | `docs/jev-patterns.md` |
| Why a site misbehaves | `docs/site-notes.md` |
| Rules for agents | `AGENTS.md` |
| Thresholds | `docs/jev-patterns.md#thresholds-in-use` |
| Raw bench output | `artifacts/`, ignored by git, timestamped folders |
