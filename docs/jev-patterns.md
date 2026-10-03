# Jev patterns from jev-catalog

Lessons from building a catalogue scraper on Jev, written for anyone designing Jev questions, in this repo or elsewhere. Each pattern names the experiment that showed it. The full stories are in [experiments/](experiments/README.md). TypeSafe's own guidance lives at <https://docs.typesafe.ai/llms.txt> and in the vendored `typesafe-ai` skill. Read those first. This page records what held up in practice on about 30 manufacturer websites with `jev-1.13.0`.

## Division of labour

Code finds candidates, keeps the rules, counts, waits and navigates. Jev answers narrow questions about candidates that code has observed. Every Jev answer in this project maps back to a control id, a group id, a slot key or a count text that exists on the page. Nothing Jev says becomes a selector, URL or value directly.

The table shows where that line sits in each stage.

| Stage | Code does | Jev answers |
| --- | --- | --- |
| Gate | collect overlay controls, press by priority, revert a site change | what each control does |
| Recon | find repeated groups, open probe pages, decide the next action | page kind, main group, item kinds, item page kinds |
| Listing | line up slots, propose label pairs, name fields, pick identity and total | whether a pair is a label, what each slot holds, what each count text counts |
| Paging | collect controls, fit URL templates, verify new identities, wait, stop | what each control does |

## Patterns

### Ask what each candidate is, and let code rank

Do not ask Jev to pick the best candidate according to a preference. Ask what each candidate is, then pick in code.

- The cookie gate asked for the button that answers the prompt, "preferably reject". Jev chose "Manage preferences" twice. Asking what each control does and pressing in the order reject, stay, close, accept fixed it. See [experiment 1](experiments/01-page-recon.md#a-preference-inside-one-question-gets-read-literally).
- The listing step asked which text states the total. Jev answered `none` on three pages that showed one. Asking what each count text counts, and letting code prefer product counts over result counts, found all of them. See [experiment 3](experiments/03-listing-recipe.md#ask-about-each-count-text-then-let-code-pick).
- Paging asks one role question per control and never "which control goes to the next page". Code then tries the mechanisms in a fixed order and keeps the first that works.

### Split compound conditions into separate literal questions

When a decision has the form "X unless Y", ask about X and Y separately and combine in code.

The rule "a product with an options configurator is a family" broke on WAGO, whose pages have a variant switcher and name one exact item number. Two Nouls, one for "lets the visitor choose options" and one for "identified by exactly one complete article number", let code say family only when the first is at least 0.6 and the second below 0.5. See [experiment 1](experiments/01-page-recon.md#configurable-products-count-as-families).

### Code proposes, Jev confirms

Some candidates only exist as a hypothesis from structure. Code can propose them cheaply, but structure alone over-proposes. Ask Jev to confirm each one with a Noul.

A text that repeats on every card before a varying value looks like a field label. On WAGO it was a series link and on Pepperl+Fuchs a product type. Jev rejected both and accepted "Preis". See [experiment 3](experiments/03-listing-recipe.md#code-proposes-jev-confirms).

### Get better evidence before raising a threshold

High-confidence wrong answers usually mean the evidence was misleading, not that the threshold was too low. VEGA's series cards look exactly like product cards, and Jev called them products at 0.92. Opening two items and asking what each page is about gave the right answer. A higher threshold would have refused every good answer too. See [experiment 1](experiments/01-page-recon.md#the-card-does-not-show-whether-an-item-is-a-family).

### Give Jev the context a literal reader needs

Jev reads literally, so add the facts that make the literal reading right.

- The gate sends `current_site`. Without it, "Türkiye" in a region prompt looked like "stay in region" from a Turkish IP.
- Paging controls carry `placed: "below the product list"` and `inside: "a pagination bar"`. An icon-only button is described by its aria-label and icon class.
- Listing slots carry sample values and fill rate, not just a path.

### Scope a literal rule in code

A correct literal answer can still be the wrong signal for a decision. The related-products Noul answered 0.81 for Misumi's main list, which is titled "Recommended products". Code now uses that Noul only on pages about one product or series, where carousels are the problem. See [experiment 2](experiments/02-crawl.md#the-first-crawl-drifted).

### Use the probabilities, not only the choice

A Choice answer returns a probability per option. When two options mean the same thing for the decision, add them. "1728 found" split between `product_count` and `result_count`, with neither above 0.6. Their sum was, and for "is this the size of the list?" the two kinds are interchangeable. See [experiment 3](experiments/03-listing-recipe.md#add-probabilities-when-jev-splits).

The gate works the same way. It reads `probabilities[role]` for every control, so a control whose top choice was `other` can still be the best `close`.

### Keep numbers in code

Jev's jaggedness notes list counting and numbers as weak points, and we saw why.

- "49 / 2960" got 0.19 as a product count. Code knows 49 rows are on screen, so it reads M as the total when N equals the visible rows.
- Code parses every total, page count and URL number, rejects totals smaller than the rows shown, and computes the expected last page.

### Verify outcomes with checks that do not involve Jev

A judgment is not proof. Every stage checks its result with independent evidence.

| Check | Catches |
| --- | --- |
| Host and locale before and after a gate click | a click that switched country |
| Unique identity across rows | wrong identity field, duplicated rows |
| New identities after a paging action | a mechanism that does nothing |
| Rows against the advertised total | missed pages, shifting order |
| HTTP 5xx during a paging step | site failures that look like the end |

### Ask speculative questions in the same request

One request can carry many questions, and extra questions cost little. The classification request asks about the page and also asks the questions a probe would ask about it, such as "is this page about a single product?" and "does it have a configurator?". It also asks a role question for every repeated group. Code uses whichever answers the decision needs. TypeSafe calls this [fan-out](https://docs.typesafe.ai/patterns/fan-out.md).

### Remember judgments per template

Pages built from one template get the same answers. The probe memo skips probing once two siblings under the same parent agreed. The recipe memo reuses a listing recipe on sibling pages. In the Elesa crawl, 7 of 13 variant tables needed no Jev call. Reuse needs a safety check. A recipe is reused only if the new page has no well-filled column the recipe never judged, after reuse silently dropped `L**[J]` on one family.

### Jev judges what it is shown

When a page arrives broken or throttled, Jev judges the broken page. Elesa served a product page without header or table after many visits, and Jev called it a product page at 0.84. Code must check that the evidence is complete before asking. This check does not exist yet.

## Thresholds in use

| Decision | Threshold | File |
| --- | --- | --- |
| A gate is present | Noul 0.6 | `src/gate.ts` |
| A control has a role | probability 0.6 | `src/gate.ts` |
| A page needs input | Noul 0.6 | `src/classify.ts` |
| A page has a configurator | Noul 0.6 | `src/classify.ts`, `src/probe.ts` |
| A page names one exact code | Noul 0.5 | `src/classify.ts`, `src/probe.ts` |
| A page is about one product or series | confidence 0.9 | `src/classify.ts` |
| A group is a related-products carousel | Noul 0.6 | `src/classify.ts` |
| A link opens all products | confidence 0.7 | `src/classify.ts` |
| A label pair is real | Noul 0.5 | `src/listing.ts` |
| A text counts the list | product plus result probability 0.6 | `src/listing.ts` |
| A paging control has a role | confidence 0.5 | `src/paging.ts` |

Each threshold sits next to the decision that uses it. Change one only with a bench run before and after.

## Cost

Measured on 2026-09-30 and 2026-10-01. A call carries 3,000 to 4,000 input tokens on average.

| Work | Jev calls |
| --- | --- |
| Recon of one page, with gate and probes | 2 to 6 |
| One crawled page in a 15-page crawl | about 2 |
| Listing recipe for one list | 1 or 2, none when reused |
| Paging one list | 1 |
| Full finder bench, 15 pages | 64 to 66, about $0.01 |

Page loads and waiting, not Jev, set the run time.
