# Findings

Bench results and lessons from stage 1. Bench artifacts are under `artifacts/bench/` (ignored by git).

## Results on 2026-09-30

| Suite | Sites | Next action correct | Jev calls | Input tokens |
| --- | --- | --- | --- | --- |
| finders (real finder and listing pages) | 15 | 14/15 | 66 | 204k |
| hubs (top-level catalogue pages) | 20 | 15/20 | about 56 | about 220k |

Finder progress across iterations: 10/15 with listing judgments only, 13/15 after item probes, 14/15 after link and frame fixes. A full finder run costs about $0.01 and takes about 4 minutes.

## What we learned

1. **Leaf lists are easy.** Jev identified all six leaf listings (Deublin, WAGO, Posital, ifm twice, Pepperl+Fuchs) at confidence 0.85 or higher, and probes confirmed single products at 0.9 or higher.
2. **Family versus product is not visible on the card.** Jev called Elesa, VEGA and Kübler series cards individual products at confidence 0.82 to 0.96. Opening two items and asking what the item page is fixed Elesa, Pedrollo, WIKA, Kübler and Donaldson.
3. **Preferences inside one question get read literally.** Asked to pick the button that answers a cookie prompt, "preferably reject", Jev chose "Manage preferences" twice. Asking what each button does and letting code pick by priority fixed this.
4. **Jev needs to know which site we are on.** From a Turkish IP, Hager offered "Türkiye". Jev called it "stay in region" and we landed on `/en-tr`. The gate now sends the current host and locale, and code reverts any prompt click that changes them.
5. **The first link in a card is often not the card's link.** VEGA cards start with a shared "product lines" badge link, the same problem as maxun-studio #291. Code now uses the link position whose URL differs across cards.
6. **Consent tools and finders hide in shadow roots and iframes.** ifm's Usercentrics dialog is in a shadow root, and Endress+Hauser's Product Guide is a cross-origin iframe. The snapshot now reads both.
7. **Headless Chromium is blocked on several sites.** Phoenix Contact, Festo, TE, Siemens and Misumi returned "Access Denied" headless and loaded headed. Balluff shows a Cloudflare check after a few clicks, which Jev correctly reports as blocked.
8. **Low confidence means something.** Most wrong page-kind answers had confidence under 0.5. The pipeline no longer acts on page kind alone.

## Stage 2: crawl (2026-10-01)

Crawl bench, 15 pages per seed:

| Seed | Outcome |
| --- | --- |
| Pedrollo peripheral pumps | 9 series resolve to 6 series pages (models only in the datasheet) and 3 product pages. 10 pages, 30 s. |
| VEGA radar | 12 configurable families. |
| Elesa+Ganter clamping knobs | 13 families resolve to their variant tables, 1 configurable family. |
| Novotechnik linear transducers | Categories expand to series, which resolve to configurable families and series pages. |
| ifm product hub | Descends to two leaf lists (inductive and pressure sensors, 50 rows per page) within 15 pages. 52 branches still queued. |
| Kennametal cut-off | Stops after one page. Its cards expand through buttons, not links. |

Regression checks after the stage 2 changes: finders 15/15, hubs 17/20 (up from 15/20).

What stage 2 taught us:

9. **Related-product carousels pull a crawl sideways.** On Pedrollo series pages Jev sometimes picked the "Könnte Sie interessieren" carousel as the main list, and the crawl drifted into other categories. Pages about one product or series are now terminal, and a per-group "related products" Noul drops carousels on those pages. On listing pages the Noul is ignored: Misumi's main list is literally titled "Recommended products".
10. **Variant tables beat configurators.** Elesa family pages have both a colour selector and a table of order codes. The table rows are the products, so a listed variant table wins over the configurator rule.
11. **Page layout hides lists.** Header, content and newsletter sections look like a 3-item repeated group and swallowed the variant table and Hager's category tiles. Groups whose items differ wildly in size are now treated as layout. A nested group is kept when it has more items than the group around it, unless it is made of an item's own children (the cells of a table row).
12. **An options configurator is not always a family.** WAGO product pages have a "Variant selection" switcher but already name one exact item number. The rule is: family when a configurator exists and no single exact article number is shown.

## Open questions

- **Hub pages that fail.** Balluff shows a Cloudflare check, Bosch Rexroth's products page is judged not a catalogue, and Testo's highlight tabs are judged categories.
