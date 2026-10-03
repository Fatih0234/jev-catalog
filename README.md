# jev-catalog

A headless product-catalogue scraper. Given a catalogue or product-finder URL, it should return every product in it. That includes following pagination and descending into families and categories until it reaches products that do not expand further.

TypeSafe's Jev model makes the decisions. Code does the reading, clicking and counting. Jev only chooses among elements that code observed on the page, so it never writes selectors, URLs or values.

## Status

Stages 1 to 4 work. Stage 1 opens a page, answers blocking prompts and decides what to do with it. Stage 2 crawls from a seed until every branch ends in a product list, a product page, a configurable family, a series page or a finder that needs input. Stage 3 turns each product list into rows with named fields, an identity and the advertised total. Stage 4 pages through each list by URL, next button, load more, numbered pages or scrolling, and reports completeness against the advertised total.

## Docs

| File | For |
| --- | --- |
| `docs/handoff.md` | Current state, repository state, decisions so far and what to do next |
| `docs/plan.md` | The stages, the definitions agreed with the user, and known gaps |
| `docs/findings.md` | Where each stage stands, and the lessons in one line each |
| `docs/experiments/` | One write-up per stage: question, setup, numbers over time, failures, decisions, how to reproduce |
| `docs/jev-patterns.md` | How to design Jev questions, with the experiment behind each pattern |
| `docs/site-notes.md` | Quirks of each tested catalogue and how the code handles them |
| `docs/typesafe-jev.md` | Where TypeSafe's docs live and what matters here |

## Run

```bash
npm install
set -a; . ~/.config/typesafe/.env; set +a   # provides TYPESAFE_API_KEY

npm run recon -- <url> [out-dir]            # one page: gates, page judgment, item probes
npm run crawl -- <url> [out-dir] [maxPages] [maxListPages]  # crawl and read every list; writes tree.md and lists/*.json
npx tsx bench/crawl.ts 15                   # crawl six seeds, 15 pages each
npx tsx bench/listing.ts [seed-id]          # build listing recipes on eight lists and read their rows
npx tsx bench/paging.ts [maxPages] [seed-id]  # page through seven lists and report completeness
npx tsx bench/recon.ts finders              # bench over real product finders
npx tsx bench/recon.ts hubs                 # bench over top-level catalogue hubs
npm run check                               # typecheck + tests (no API calls)
```

`recon` writes `report.json`, `trace.json` (every Jev request and answer) and `page.png` to the output directory. Bench runs write `artifacts/bench/<suite>-<time>/summary.md`.

The browser runs headed with the window off-screen when a display exists, because several catalogues block headless Chromium. Set `JC_HEADLESS=1` to force headless.

## Layout

| Path | Job |
| --- | --- |
| `src/page/snapshot.js` | In-page script. Reads visible text, controls, overlays and repeated item groups, including open shadow roots. Tags elements so a choice maps back to a node. |
| `src/browser.ts` | Launch, settle, frame-aware snapshot, click by observed id. |
| `src/jev.ts` | TypeSafe client with a trace of every call. |
| `src/gate.ts` | Cookie, country and popup prompts. |
| `src/classify.ts` | Page kind, main list, item kinds, and the next action. |
| `src/probe.ts` | Opens two items to tell product families from single products. |
| `src/assess.ts` | Judges one loaded page and picks the crawl action. |
| `src/listing.ts` | Listing recipe: slot alignment, Jev roles, identity, advertised total, rows. |
| `src/page/items.js` | Reads list items as labelled text leaves, plus count texts (runs in the page). |
| `src/paging.ts` | Pagination: control roles from Jev, mechanism choice and verification, passes, stop reasons. |
| `src/page/paging.js` | Collects paging controls near a list (runs in the page). |
| `src/crawl.ts` | Breadth-first crawl with dedupe, depth and page limits, and a "view all" shortcut. |
| `src/recon.ts` | Runs stage 1 for one URL. |
| `bench/suites/*.json` | Bench sites with labels. |
