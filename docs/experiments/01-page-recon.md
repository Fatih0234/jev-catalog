# Experiment 1: page recon

## Question

Given one catalogue URL, can Jev say what kind of page it is and what the crawler should do next? The next action is one of these:

| Action | Meaning |
| --- | --- |
| `extract` | the main list holds individual products |
| `expand_items` | the main list holds families or categories to open |
| `product_page`, `configurable_family`, `series_page` | the page is about one product or series (added in experiment 2) |
| `needs_input` | a finder that shows nothing until the visitor picks filters |
| `stop` | nothing to do, or blocked |

The next action is what the rest of the pipeline depends on, so it is the headline metric. Page kind and main item kind are diagnostics.

## Pipeline under test

1. **Gate.** If the page shows an overlay, Jev says what each overlay control does and code presses one by priority. See `src/gate.ts`.
2. **Classify.** One request with many questions covers the page kind, which repeated group is the main list, what each group's items are, whether the page needs input, and the same questions a probe would ask about the page itself. See `src/classify.ts`.
3. **Bot-check retry.** If Jev says the page is an error or blocked, code waits 15 s and classifies again.
4. **Probes.** When the main list looks like products or families, code opens the first and the middle item in new tabs and asks Jev what each item page is about. See `src/probe.ts`.
5. **Decide.** Pure code turns the answers into the next action. See `decideNext` in `src/classify.ts`.

## Suites

The first suite was 20 top-level catalogue pages from maxun-studio's live-sites corpus. The user pointed out that most of them are company landing pages, while the scraper's real input is a product finder or listing. We kept those 20 as the `hubs` suite and built a `finders` suite of 15 real finder and listing pages. Two seeds came from the user, WAGO search and Pedrollo. Scout subagents found the rest and verified each one live. The finders suite has 6 leaf product lists, 7 family lists, Kennametal's category page with families, and Endress+Hauser's finder inside a cross-origin iframe.

## Results over time

### Finders

| Run | Change | Next action correct | Main items correct | Page kind correct |
| --- | --- | --- | --- | --- |
| 21:38 | listing judgments only | 10/15 | 10/15 | 10/15 |
| 21:41 | item probes | 13/15 | 13/15 | 9/15 |
| 21:48 | own-link position and iframe snapshot | 14/15 | 13/15 | 11/15 |
| 22:01 | configurator rule from the user's definition | 15/15 | 14/15 | 11/15 |
| 22:19 to 22:52 | regression runs during experiment 2 | 15/15 | 14/15 | 10 or 11/15 |

A full finder run made 64 to 66 Jev calls with 204k to 240k input tokens, about $0.01.

### Hubs

| Run | Change | Next action correct |
| --- | --- | --- |
| 21:19 | first scored run on the 20 landing pages | 14/20 |
| 21:23 | gate and snapshot fixes, exact diff not recorded | 15/20 |
| 21:52 | same code as the 21:48 finder run | 15/20 |
| 22:47 | layout-group and nesting fixes from experiment 2 | 16/20 |
| 22:52 | Misumi alone, after scoping the related-products rule | 1/1 |

The last full hub run scored 16/20. The Misumi fix was checked on Misumi alone, so 17/20 is expected but not measured.

## Final per-site results, finders

| Site | Label | Jev page kind | Confidence | Next action |
| --- | --- | --- | --- | --- |
| Deublin selector | product listing | product listing | 0.62 | extract, correct |
| WAGO search | product listing | product listing | 0.99 | extract, correct |
| Posital inclinometers | product listing | product listing | 0.99 | extract, correct |
| ifm inductive sensors | product listing | product listing | 0.89 | extract, correct |
| ifm search | product listing | product listing | 1.00 | extract, correct |
| Pepperl+Fuchs inductive | product listing | product listing | 0.97 | extract, correct |
| Pedrollo peripheral pumps | family listing | family listing | 0.73 | expand, correct |
| Novotechnik linear | family listing | family listing | 0.50 | expand, correct |
| Elesa+Ganter clamping knobs | family listing | product listing | 0.86 | expand, correct |
| WIKA pressure gauges | family listing | product listing | 0.42 | expand, correct |
| VEGA radar | family listing | product listing | 0.92 | expand, correct |
| Kübler encoder finder | family listing | product listing | 0.81 | expand, correct |
| Donaldson | family listing | product listing | 0.26 | expand, correct |
| Kennametal cut-off | category hub | family listing | 0.85 | expand, correct |
| Endress+Hauser product guide | finder needing input | category hub | 0.39 | needs input, correct |

## What we learned

### The card does not show whether an item is a family

Jev called the series cards of Elesa, VEGA and Kübler individual products at 0.82 to 0.96. The cards really do look like products. Opening two items and asking what the item page is about fixed Elesa, Pedrollo, WIKA, Kübler and Donaldson. If any probe sees a series page, the list counts as a family list. This is why page kind stays at 10 or 11 of 15 while the next action reaches 15 of 15. The pipeline never acts on page kind alone.

### Configurable products count as families

VEGA's radar sensors are single models with an options configurator. The user decided that a configurator makes a family. WAGO product pages also have a "Variant selection" switcher but name one exact item number. The probes now ask two literal Nouls, and code combines them. A page is a configurable family when the configurator probability is at least 0.6 and the exact-code probability is below 0.5. VEGA scored 0.85 and 0.04. WAGO scored 0.93 and 0.93 and stays a product.

### A preference inside one question gets read literally

The first gate asked Jev to pick the button that answers the cookie prompt, preferring reject. Jev chose "Manage preferences" twice. The fix asks what each control does, with roles such as `reject_optional`, `accept_all`, `open_settings`, `stay_region` and `close`. Code then presses by a fixed priority: reject, stay, close, accept. Jev never sees the priority.

### Jev must know which site it is on

From a Turkish IP, Hager showed a region prompt with "Türkiye". Jev called it "stay in region", and the click moved us from `/de` to `/en-tr`. The gate now sends `current_site` with host, path and page language. Code also compares host and locale segment before and after each click and reverts a click that changed them.

### The first link in a card is often not the card's link

VEGA cards start with a "product lines" badge that links to the same page from every card. Code now picks the anchor position whose URL differs most across items. maxun-studio issue #291 is the same bug.

### Pages hide content in shadow roots and iframes

ifm's Usercentrics consent dialog lives in a shadow root. Endress+Hauser's product guide is a cross-origin iframe. The snapshot walks open shadow roots and reads child frames, prefixing their ids with `f1-` and so on.

### Headless browsers are blocked

Phoenix Contact, Festo, TE, Siemens and Misumi answered "Access Denied" to headless Chromium and loaded in a headed browser. The browser now runs headed and off-screen by default. A server deployment needs Xvfb or similar.

### Low confidence means something

Most wrong page-kind answers came with confidence under 0.5, for example Donaldson at 0.26, Endress+Hauser at 0.39 and WIKA at 0.42. High-confidence wrong answers, such as VEGA at 0.92, came from pages whose cards really look like products. Probes are the fix for those, not a higher threshold.

### The main group decides, not the page kind

On SMC, a site-search page, Jev judged the page a product listing while the main group held navigation. The next action now comes from the kind of items in the main group, so a page with no product group never gets extracted.

## Remaining misses

| Site | Expected | Got | Cause |
| --- | --- | --- | --- |
| Balluff hub | expand | stop | A Cloudflare check appears after a click and does not clear in 15 s. Jev reports it as blocked, which is true. |
| Bosch Rexroth hub | expand | stop | Judged not a catalogue at 0.61. Not investigated. |
| Testo hub | extract | expand | Highlight tabs judged categories. The label may also be wrong. Not investigated. |
| Misumi hub | expand | stop | The main list is titled "Recommended products" and the related-products rule dropped it. Fixed after the last full run and verified alone. |

## Decisions

- Probes are part of recon, not an optional extra. They cost two page loads and one Jev call each, and they settle the family question.
- Answering a gate must never change the site or locale.
- Thresholds live in code next to the decision that uses them. The gate, role, needs-input and configurator thresholds are 0.6, and the exact-code threshold is 0.5.

## Reproduce

```bash
set -a; . ~/.config/typesafe/.env; set +a
npx tsx bench/recon.ts finders            # about 4 minutes
npx tsx bench/recon.ts hubs
npx tsx bench/recon.ts finders vega-radar-de   # one site
npm run recon -- <url> [out-dir]          # any page
```
