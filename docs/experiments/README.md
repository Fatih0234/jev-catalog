# Experiments

These write-ups record what we built, how we measured it on live catalogues, what failed and why, and what we changed. They are for people deciding what to build next and for agents about to change the pipeline. Read the write-up for a stage before editing that stage's code.

Each write-up records its run date and model. Raw outputs are in `artifacts/`, which git ignores. Each write-up names the commands that produce the numbers again, but live sites change, so expect drift.

## Index

| # | Stage | Question | Outcome |
| --- | --- | --- | --- |
| 1 | [Page recon](01-page-recon.md) | Can Jev tell what a catalogue page is and what to do with it? | Finders 15/15 correct next action, hubs 16/20 |
| 2 | [Crawl](02-crawl.md) | Can the crawler descend from a hub to every product list without drifting? | 6 seeds end in the expected kinds of leaf; one seed needs button clicks |
| 3 | [Listing recipe](03-listing-recipe.md) | Can a list become rows with named fields, an identity and an advertised total? | 8 of 8 lists, every identity unique, totals found wherever the page shows one |
| 4 | [Pagination](04-pagination.md) | Can the crawler read every page of a list and prove how complete it is? | 100%, 99.5%, 96.6% and 93.5% on lists with a total; one site fails on its server |
| 5 | [Detail recipe](05-detail-recipe.md) | Can a sampled detail recipe replay without Jev? | Local browser tests and three-product Deublin live comparison |

Lessons that apply to any Jev project are collected in [../jev-patterns.md](../jev-patterns.md). Per-site quirks are in [../site-notes.md](../site-notes.md).

[Held-out product finders](heldout-finders.md) records a separate validation set across six new manufacturers. Its first assessment checks discovery, not full extraction or robot replay.

[Recipe learning on new sites](heldout-recipes.md) records the later Leuze and Schmalz teaching/test split. Both fail detail identity before a usable recipe is compiled. Schmalz replays ten listing names and article numbers but loses their URLs.

[Detail identity repair](identity-repair.md) fixes the missing identity candidates and tests ten fresh detail products. Both sites verify 5/5 identities. Schmalz reproduces 100/100 expected specification values and 9/9 document URLs, but neither site's output is fully clean.

[The V2 detail-schema experiment](heldout-recipes.md#v2-detail-schema-experiment-2026-10-03) tests cross-product field learning on another ten products. Replay uses no Jev. Leuze reproduces 46/234 values and 14/74 URLs; Schmalz reproduces 100/100 values and 9/9 URLs but returns 20 extra overview fields. No product is fully clean. Product-description classification and inconsistent initial-control signatures remain confirmed failures.

## How a bench works

A bench is a script in `bench/` that runs one stage over a fixed list of real pages and writes a timestamped folder with a `summary.md`, per-site JSON and a `trace.json` of every Jev call.

| Bench | Pages | Measures |
| --- | --- | --- |
| `bench/recon.ts finders` | 15 product finders and listings from `bench/suites/finders.json` | page kind, main item kind and next action against labels |
| `bench/recon.ts hubs` | 20 top-level catalogue pages from `bench/suites/hubs.json` | the same |
| `bench/crawl.ts [pages] [seed] [listPages]` | 6 seeds | where each branch of the crawl ended, rows read, Jev calls, time |
| `bench/listing.ts [seed]` | 8 product lists | rows, identity, uniqueness, advertised total, fields |
| `bench/paging.ts [maxPages] [seed]` | 7 product lists | mechanism, pages, rows, completeness, stop reason |
| `bench/details.ts <rows.json> <recipe.json> [out-dir]` | up to three saved listing targets | identity, section-qualified values, downloads and diagnostics |
| `bench/detail-deublin-verify.ts <evidence-dir> <run-dir>` | three Deublin products | exact values and URLs against fixed independent captures, plus Jev-free replay |

Load the key before any bench with `set -a; . ~/.config/typesafe/.env; set +a`.

### Labels

Subagents labelled both recon suites from screenshots that `bench/shoot.ts` takes without Jev. They saw only the screenshot, never Jev's answer. Nobody has reviewed the labels by hand yet. Do not relabel a site after seeing what Jev said about it. If a label looks wrong, take a fresh screenshot and decide from that.

The later stages have no label files. Their checks are internal. Identities must be unique, and code compares rows with the total the site advertises. Where those checks could not settle a question, we opened the page and counted by hand, and the write-up says so.

### Cost and time

Jev is cheap enough that cost never constrained an experiment. A full finder recon run used 64 to 66 calls and about 240k input tokens, which cost about $0.01. Time is dominated by page loads and waiting. A finder run takes about 4 minutes, and a 15-page crawl of one seed takes 30 s to 2 minutes.

### Environment effects

- The machine has a Turkish IP, so several sites offered Turkish locales.
- Five hub sites block headless Chromium. The browser runs headed and off-screen by default. Set `JC_HEADLESS=1` to force headless.
- Repeated runs against one site can trigger its defences. ifm's firewall and Elesa+Ganter both did during these experiments. Spread re-runs out and check the screenshot before blaming the code.

## Writing a new experiment

1. State the question and how you will know the answer.
2. Run the relevant bench before the change and keep its folder name.
3. Change one thing and run the bench again.
4. Record both numbers, the change and the cause of every remaining miss in a new numbered file here.
5. If a miss comes from the site rather than the code, add it to `../site-notes.md`.
