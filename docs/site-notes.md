# Site notes

Quirks of the catalogues we tested, what they broke, and how the code handles them now. Use this page when a site behaves oddly, and when you need a realistic fixture for a test. Notes cover 2026-09-30 through 2026-10-03, seen from a Turkish IP. Sites change, so confirm before relying on a note.

The experiment links point to the full story.

## Balluff

- A Cloudflare check appears after a click and does not clear within the 15-second wait. Jev reports the page as blocked, which is accurate. The hub bench counts this as a miss. [Experiment 1](experiments/01-page-recon.md#remaining-misses)

## Bosch Rexroth

- The products hub was judged not a catalogue at 0.61. Not investigated.

## Deublin

- The product selector is a div table. Its column headers sit in a separate row above the rows. The reader matches header texts to columns by horizontal position. [Experiment 3](experiments/03-listing-recipe.md)
- Paging uses numbered buttons without links and an icon-only next button. The mechanism is click next.
- Tailwind classes such as `disabled:bg-grey-200` are on every pager button. Only whole class tokens like `disabled` mean a disabled state.
- The site's API, `/catalog/productList?query={"searchPage":22,...}`, answers HTTP 500 for page 22 every time. The page then shows "page 22 of 1" and the next button disappears, so the UI reaches 21 of 77 pages, 210 products. Paging reports `server_error` with `failed_pages: [22]`. [Experiment 4](experiments/04-pagination.md#watch-the-network)
- Detail pages put the exact numeric code in an `h2`. The descriptive `h1` differs between variants and must not become part of a reusable identity locator. Header class names also occur on ordinary layout wrappers, not only accordion controls. [Experiment 5](experiments/05-detail-recipe.md#first-live-run-2026-10-01)
- Metric and imperial values share a row, with the inactive span hidden. The detail reader must copy only the rendered value. The tested products had 18, 21 and 21 visible fields and four download links each. Download links are observed, not opened.

## Donaldson

- A family list judged a product listing at 0.26. Probes settle it.

## Elesa+Ganter

- Family cards look like products. Probes show they open series pages.
- Family pages have a colour selector, a 3D configurator and a table of order codes. The table wins, so the families become product lists. [Experiment 2](experiments/02-crawl.md#variant-tables-beat-configurators)
- The variant tables use DataTables. The header is a separate table whose filter row holds dropdowns with every value. Fixed-column clones of the table sit on the left and right. Some families split their variants over several tables. The reader skips header rows with inputs, reads every table of the template and merges rows by order code. [Experiment 3](experiments/03-listing-recipe.md#table-widgets-distort-the-table)
- The page's header, content and newsletter sections looked like a 3-item list and hid the table. The homogeneity rule in the snapshot handles this. [Experiment 2](experiments/02-crawl.md#page-layout-hides-lists)
- GN products from Ganter use a different table template from VB and VTT products from Elesa, so they get their own recipe.
- Repeated visits get throttled. URLs gain `?err=second`, and later product pages arrive without header or table. Jev judged one of those a product page at 0.84. Wait before re-running.

## Endress+Hauser

- The product guide is a cross-origin iframe. The snapshot reads child frames and prefixes their ids with `f1-`.
- It shows nothing until the visitor picks filters, so the result is `needs_input`.

## Festo, Phoenix Contact, Siemens, TE Connectivity

- These sites answer "Access Denied" to headless Chromium and load in a headed browser. The browser runs headed and off-screen by default.

## Hager

- From a Turkish IP, a region prompt offers "Türkiye". Pressing it moves from `/de` to `/en-tr`. The gate sends the current site to Jev and reverts any click that changes host or locale. [Experiment 1](experiments/01-page-recon.md#jev-must-know-which-site-it-is-on)
- The 12 category tiles were hidden inside a 3-item layout group until the homogeneity rule.

## ifm

- The Usercentrics consent dialog is in a shadow root. The snapshot walks open shadow roots.
- Category pages such as `/category/200_010_010` are HTML tables with 50 rows. They show "Applicable products: 1655" and "Page 1 of 34".
- Paging uses icon-only buttons with aria-labels "First page", "Previous page", "Next page" and "Last page". The German site uses "Nächste Seite".
- A page-size select offers 50, 75, 100 and 125. It is not used yet.
- Akamai blocks with "Access Denied" after fast paging, 34 pages in about a minute. Paging now pauses 1 s.
- The search page shows "Produkte (10000)", likely a capped count, over 834 pages of 12. Relevance order repeats a product across pages now and then.

## Kennametal

- The cut-off page's cards open their categories through "View Categories" buttons with no links. The crawler follows links only, so it stops there.

## Kübler

- Encoder series cards look like products. Probes settle it.

## Misumi

- Blocks headless Chromium.
- The hub's main list is titled "Recommended products". The related-products rule now applies only on pages about one product or series, so the list is kept.

## Novotechnik

- Category pages list series. Jev's probes judged the series pages configurable, so they end as configurable families. Not checked by hand.

## Pedrollo

- Series pages such as PK describe models PK 65 to PK 300 only in text and a PDF datasheet. The crawl ends them as `series_page`.
- Series pages show a related-products carousel, "Könnte Sie interessieren". It made the first crawl drift into other categories. [Experiment 2](experiments/02-crawl.md#the-first-crawl-drifted)

## Pepperl+Fuchs

- Product cards load 50 at a time through "Mehr laden". Each click also adds a `size=` parameter to the URL, for example `&size=700`. A larger value might return the whole list in one load. Not tried.
- The progress text "49 / 2960" and the button "Produkte anzeigen (2960)" both carry the total. A filter offers "Abgekündigte Produkte 2766", which is not the total. [Experiment 3](experiments/03-listing-recipe.md#filters-are-not-totals)
- Cards repeat the product type, "Induktiver Sensor", before the description. It is not a label.
- Price and currency are separate elements, so they become two fields.
- A full run reached 2944 of 2960.

## Posital

- The inclinometer search is an HTML table with 20 rows and zero-based `?page=0` links. The mechanism is a URL template.
- "1728 found" splits between product count and result count in Jev's answer. Code adds the two.
- Each product cell holds a "Compare" button. The reader skips button text.
- The default order shifts between loads, so pages repeat products from other pages. Three passes reach 1669 of 1728. The sort menu offers only price and delivery time, which tie on many products. [Experiment 4](experiments/04-pagination.md#zero-new-products-does-not-mean-the-end)

## SMC

- The tested page is a site search. Jev judged it a product listing at 0.73 while the main group held navigation. The next action comes from the main group, so it ends in `stop`.

## Testo

- Highlight tabs on the hub were judged categories, giving `expand` where the label says `extract`. Not investigated.

## VEGA

- Each card starts with a "product lines" badge link shared by all cards. The item's own link is the anchor position whose URL differs across cards. maxun-studio #291 is the same bug.
- Radar sensors are single models with an options configurator, so they end as configurable families.

## WAGO

- Search results show 20 cards per page with icon-only next and previous buttons.
- The count bar shows "All results 49" and "Products 31". The list itself has 29 products over 2 pages.
- Every card repeats the series link "221 - Splicing connector with lever >" before the item number. Jev rejects it as a label.
- Product pages have a "Variant selection" switcher but name one exact item number, so they stay products.

## WIKA

- A family list judged a product listing at 0.42. Probes settle it.

## Leuze and Schmalz held-out recipe checks

- The 2026-10-03 Leuze teaching listing includes companion amplifiers inside each primary fiber-optics card. Current extraction joins primary and amplifier part numbers and shifts some named specification values.
- Schmalz's second results page preserves names and article numbers but loses `_url` during recipe replay, even with recipe fit 1 and no unknown slots.
- Both sites show the expected primary code, but the initial detail diagnostics offer zero identity candidates. On Schmalz, the confirmed cutoff is a link-only navigation row before the product heading. This is an observer defect, not site blocking.
- Schmalz shows Design Data initially. Technical Data and Documentation are disclosures. CAD previews on the products with a CAD section require login for download; no direct CAD file links were observed.
- A later Leuze diagnostic captured an empty page. Its cause is unresolved, and that capture does not explain the initial missing identity candidates.

See `experiments/heldout-recipes.md` for the frozen expectations and failed run.

## Detail identity repair follow-up

- The observer now ignores link-only blocks when it sets the identity cutoff. It prefers a visible inline part number over the next paragraph and skips non-rendered metadata for sibling values.
- On Leuze, two teaching judgments accept both the numeric article number and the descriptive model code as primary. Exact identity verification rejects that ambiguity. Fresh replay uses the learned numeric `sku` location and verifies all five new products.
- Leuze's specification and control paths still include the product description. Fresh glass/plastic variants therefore fail declaration matching. The matched teaching page also collects no download links after opening Downloads. Its download failure is not diagnosed.
- Schmalz's fresh replay matches all 100 expected technical values and nine document links. Four overview fields per product duplicate values under "Show moreShow less". Two table-header rows per product also appear as `Attribute = Value`.
- Schmalz reports template drift for changing auxiliary controls and an unsupported frame for the revealed CAD preview. CAD file extraction and login remain unsupported.

See `experiments/identity-repair.md` for the local regressions and fresh-product results.
