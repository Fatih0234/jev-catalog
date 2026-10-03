# Experiment 3: listing recipe

## Question

Can the crawler turn a product list into rows with named fields, a field that identifies each product, and the total the site advertises? And can it reuse that recipe on sibling pages without asking Jev again?

## Design

The work is split so that Jev only chooses among things code has observed.

1. **Read items in the page.** `src/page/items.js` reads each row or card of the main group as an ordered list of text leaves. Each leaf has a structural path, its parent's path, its text and an explicit label when the page shows one. Label sources are table headers, a header row above a div table matched by horizontal position, `<dt>`, text ending in ":", and inline "Label: value" text. Button text is skipped. The script also collects visible texts that look like counts.
2. **Line up slots in code.** `alignSlots` in `src/listing.ts` keys every leaf by its label or path and computes coverage, distinctness and samples per slot. A leaf with the same value on every item, followed by a varying value inside the same wrapper, is proposed as a label pair.
3. **Ask Jev.** One request confirms each proposed label pair with a Noul. A second request asks one Choice per slot with the roles `name`, `order_code`, `description`, `spec`, `price`, `availability`, `category`, `chrome` and `other`, plus one Choice per count text with the kinds `product_count`, `result_count`, `page_count` and `other`.
4. **Build the recipe in code.** Code drops chrome and names fields by the page's own label, or by role when there is none. It picks the identity in a fixed order, trying a unique order code, then a unique name, then the item's own URL. It also picks the advertised total and the page count.
5. **Apply the recipe.** Code reads every list on the page built from the same template, merges rows with the same identity, and checks coverage and uniqueness.

## Lists

| List | Shape |
| --- | --- |
| Deublin selector | div table, header row above it, 10 rows |
| WAGO search | cards, 20 per page |
| Posital inclinometers | HTML table, 20 rows |
| ifm inductive sensors | HTML table, 50 rows |
| ifm search | cards, 12 per page |
| Pepperl+Fuchs inductive | cards, 49 per load |
| Elesa+Ganter VB.839-B | DataTables variant table, 42 rows |
| Elesa+Ganter VTT-SST-VD | DataTables variant table, 4 rows |

## Results over time

| Run | Change | Main effect |
| --- | --- | --- |
| 23:01 | first version | Rows read on 7 lists. Deublin columns unnamed. WAGO's series link named a field. Elesa rows doubled and named after dropdown values. Pepperl total found. |
| 23:07 | header row without inputs, geometry headers, Jev confirms label pairs, merge by identity, largest image | Real column names on Deublin and Elesa, Elesa 42 rows with unique codes |
| 23:09 | one question per count text instead of one question for the total | WAGO 31, ifm 1655, ifm search 10000, page counts. Pepperl picked a filter count, 2766. |
| 23:11 | skip counts inside filter-like class names | Lost ifm and Pepperl totals. The class rule was too broad. |
| 23:14 | skip counts only next to a checkbox or radio, progress rule "N / M", parenthesised counts | Pepperl 2960 again, ifm back |
| 23:16 | button text out of table cells, "found" counts | Posital product column clean |
| 23:19 | add product and result probabilities | Posital 1728 |

## Final results

| List | Rows | Identity | Unique | Advertised | Fields |
| --- | --- | --- | --- | --- | --- |
| Deublin selector | 10 | Deublin Teilenummer | 100% | 77 pages | 7 labelled columns |
| WAGO search | 20 | order code, "Item no. 221-412" | 100% | 31 products | name, description, spec text, PU (SPU) |
| Posital inclinometers | 20 | PRODUCT | 100% | 1728 found | 7 labelled columns |
| ifm inductive | 50 | order code | 100% | 1655, 34 pages | 6 labelled columns |
| ifm search | 12 | order code | 100% | 10000, 834 pages | name, description, price |
| Pepperl+Fuchs inductive | 49 | order code | 100% | 2960 | category, description, price |
| Elesa VB.839-B | 42 | Code | 100% | none shown | 11 columns, such as D, d, L, d1 and C#[Nm] |
| Elesa VTT-SST-VD | 4 | Code | 100% | none shown | 9 columns |

Every page that shows a product count yielded it. A list costs about 6 Jev calls including gate, classification and probes. In the Elesa crawl, 7 of 13 variant tables reused a recipe without a Jev call.

## What we learned

### Ask about each count text, then let code pick

With one question, "which text states how many products the list contains", Jev answered `none` on WAGO, ifm and ifm search, all of which show a product count. Asked separately what each text counts, it labelled them well. Code then prefers a product count over a search-result count and rejects any total smaller than the rows already shown. On WAGO this picks "Products 31" over "All results 49", which also counts downloads.

### Add probabilities when Jev splits

Posital's "1728 found" got 0.51 for `result_count` and most of the rest for `product_count`, so neither passed 0.6. Both mean "this counts the list". Code now accepts a text whose product and result probabilities add up to 0.6 or more.

### Some numbers are code's job

Pepperl's progress text "49 / 2960" got only 0.19 as a product count. In isolation it is ambiguous. Code knows 49 rows are on screen, so a bare "N / M" with N equal to the visible rows means M is the total. This rule runs only when Jev picked nothing.

### Code proposes, Jev confirms

On WAGO, "221 - Splicing connector with lever >" repeats on every card before the item number. On Pepperl, "Induktiver Sensor" repeats before the description. Both look like labels by position. Jev's pair Noul rejected them and accepted "Preis". Code also stopped proposing pairs whose leaves sit directly in the card. Real label and value pairs share a wrapper such as a spec row or a price box.

### Filters are not totals

The first count collector found "Abgekündigte Produkte 2766", the number of discontinued products in a filter. Excluding elements with "filter" in the class removed the real totals on ifm and Pepperl, whose result bars sit in filter-named containers. The rule that held is narrower. A count is a facet option if it sits in a label, a checkbox or option role, or a small row with a checkbox or radio input.

### Table widgets distort the table

Elesa uses DataTables. Its header lives in a separate table. That header has a filter row whose dropdowns list every value, so the first labels were "M8M10M12M14". The fixed-column feature clones the table on the left and right. The reader now skips header rows that contain inputs. Rows with the same identity are merged, so the clones fill gaps instead of doubling rows. On VTT-SST-VD, 12 `<tr>` elements turned out to be 4 products and 8 clone rows.

### Unique values are not always identities

While writing the unit tests we saw that a spec column can be unique on one page by chance. Only an order code, a name or the item's own link may serve as identity.

### Reusing recipes can lose columns silently

The first reuse rule accepted a recipe if 80% of its fields fit. Sibling Elesa families have extra columns, such as `L**[J]` on VTD, and those were dropped without notice. Reuse now also requires that the new page has no well-filled column the recipe has never judged.

## Remaining problems

- Columns without any header get role names such as `spec_1`.
- A currency shown apart from its price becomes its own field, for example "116,23" and "EUR" on Pepperl.
- WAGO's series link is kept as a `name` field next to the real product name.
- The recipe does not yet check field values for plausibility. That belongs to experiment 6.

## Reproduce

```bash
set -a; . ~/.config/typesafe/.env; set +a
npx tsx bench/listing.ts                  # all eight lists
npx tsx bench/listing.ts posital-inclinometers
```

Each list folder holds `recipe.json`, `rows.json`, `check.json`, `trace.json` and a screenshot.
