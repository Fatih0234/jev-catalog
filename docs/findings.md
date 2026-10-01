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

## Stage 3: listing recipe (2026-10-01)

Listing bench, first page of each list:

| List | Rows | Identity | Advertised | Fields |
| --- | --- | --- | --- | --- |
| Deublin selector | 10 | Deublin Teilenummer | 77 pages | 7 labelled columns from a div-table header |
| WAGO search | 20 | order code ("Item no. 221-412") | 31 products | name, description, spec text, PU (SPU) |
| Posital inclinometers | 20 | PRODUCT | 1728 found | 7 labelled columns |
| ifm inductive | 50 | order code | 1655, 34 pages | 6 labelled columns |
| ifm search | 12 | order code | 10000, 834 pages | name, description, price |
| Pepperl+Fuchs inductive | 49 | order code | 2960 | category, description, price |
| Elesa VB.839-B | 42 | Code | none shown | 11 columns (D, d, L, d1, l2, h, C# [Nm], ...) |
| Elesa VTT-SST-VD | 4 | Code | none shown | 9 columns |

About 6 Jev calls per list including gates, classification and probes. In the Elesa crawl, 7 of 13 variant tables reused a recipe without a Jev call.

What stage 3 taught us:

13. **Totals need per-candidate questions.** Asked "which text states the total", Jev answered none on every page. Asked per text what it counts (products, search results, pages, other), it labels them well, and code picks. "1728 found" splits between product and result count, so code adds the two.
14. **Code proposes, Jev confirms.** A text that repeats on every card before a varying value looks like a label, but on WAGO it is the series link and on Pepperl+Fuchs the product type. A literal Noul per proposed pair sorts them.
15. **Page widgets distort tables.** DataTables adds a filter row with dropdowns listing every value, a separate header table, and left and right fixed-column clones. Header rows with inputs are skipped and rows are merged by identity.
16. **Reusing recipes can lose columns silently.** A sibling family can have a column the first family lacked. Reuse now requires that every well-filled column was judged before.

## Stage 4: pagination (2026-10-01)

Full runs, up to 150 pages per list, 1 s pause:

| List | Mechanism | Rows | Completeness | Stop |
| --- | --- | --- | --- | --- |
| ifm inductive sensors | click next (icon only) | 1655 of 1655 | 100% | reached total, 34 pages, 62 s |
| Pepperl+Fuchs inductive | load more | 2944 of 2960 | 99.5% | the button disappeared, 60 loads |
| Posital inclinometers | URL `?page={v}`, zero-based | 1669 of 1728 | 96.6% | 3 passes over 87 pages |
| WAGO search | click next (icon only) | 29 of 31 | 93.5% | page 2 really shows 9 products |
| Deublin selector | click next | 210 | n/a | the site answers HTTP 500 for page 22 |

Each list costs one Jev call for paging on top of the listing calls. Every list worked with the first mechanism tried.

What stage 4 taught us:

17. **Zero new products does not mean the end.** Posital's default order shifts between loads, so whole pages repeat earlier ones. The end is an empty or unchanged page or a missing control. With an advertised total, repeats before the expected last page are ignored.
18. **Wait for the change, not for something new.** Waiting until an unseen product appears cost 12 s on every page of repeats (28 minutes for Posital). Waiting until the list differs from the previous page brought it to under 10 minutes.
19. **Watch the network.** Deublin's empty page 22 was a server error, visible only as HTTP 500 responses. Paging now reports failed pages instead of a silent stop.
20. **Paging fast gets you blocked.** After 34 ifm pages in a minute, ifm's firewall answered "Access Denied" for the next run. Paging now pauses 1 s between pages.
21. **Tailwind class names look like states.** `disabled:bg-grey-200` made every Deublin and Posital control look disabled. Only whole class tokens count.
22. **Throttled pages look like product pages.** After many visits Elesa serves its product pages without header or table, and Jev judged one a product page at 0.84. Code has no check for this yet.

## Open questions

- **Hub pages that fail.** Balluff shows a Cloudflare check, Bosch Rexroth's products page is judged not a catalogue, and Testo's highlight tabs are judged categories.
