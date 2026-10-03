# Experiment 4: pagination

## Question

Can the crawler read every page of a product list, whatever paging the site uses, and say how complete the result is?

## Design

`src/paging.ts` and `src/page/paging.js` split the work this way.

1. **Collect controls in code.** The page script collects controls near the list but outside its items. These are pagination bars, numbered pages, next and previous arrows, "load more" buttons, `rel=next` and page-size selects. Icon-only arrows are described by their aria-label, title and icon class. Each control carries its position relative to the list and whether it is disabled or current.
2. **Ask Jev what each control does.** One Choice per control with the roles `next_page`, `page_number`, `load_more`, `previous_first_last`, `page_size` and `other`. This costs one Jev call per list.
3. **Choose a mechanism in code.** The order is fixed:

   | Order | Mechanism | Source |
   | --- | --- | --- |
   | 1 | URL template | fitted from numbered links, a next link or `rel=next`, as page number, zero-based page or offset |
   | 2 | click next | a `next_page` control |
   | 3 | load more | a `load_more` control |
   | 4 | click numbers | `page_number` controls without links |
   | 5 | scroll | always tried last |

   The first mechanism that brings product identities not seen on page 1 wins. If one fails, code tries the next without asking Jev again.
4. **Loop in code.** After each step, code waits until the list has changed, reads it with the listing recipe and adds new identities. Paging stops when one of these happens:

   | Stop | Condition |
   | --- | --- |
   | `empty_page` | the page shows no items |
   | `not_advancing` | the page shows exactly the items of the previous page |
   | `end_of_list` | the control is gone or disabled |
   | `reached_total` | rows reached the advertised total |
   | `page_limit` | the page cap |
   | `no_new_items` | 3 pages in a row bring nothing new, past the expected last page when a total is known |
   | `server_error` | the page came back empty with HTTP 5xx responses and cannot be skipped |

5. **Report.** The result records pages that failed with HTTP 5xx, rows seen again, passes, and completeness against the advertised total.

## First runs, capped at 4 pages

Every list found a working mechanism on the first try.

| List | Mechanism |
| --- | --- |
| Deublin selector | click next, numbered buttons have no links |
| WAGO search | click next, icon only |
| Posital inclinometers | URL template `?page={v}`, zero-based |
| ifm inductive sensors | click next, icon only with aria-label "Next page" |
| ifm search | click next, aria-label "Nächste Seite" |
| Pepperl+Fuchs inductive | load more, "Mehr laden" |

Before this run, code treated Tailwind classes such as `disabled:bg-grey-200` as a disabled state, which made every control on Deublin and Posital look disabled. Only whole class tokens count now.

## Full runs over time

Cap 150 pages. Times are total paging time for the list.

| Version | Change | ifm | Pepperl | Posital | Deublin |
| --- | --- | --- | --- | --- | --- |
| v1 | stop at the first page with nothing new | page loaded empty, never paged | 600 of 2960, 20% | 815 of 1728, 47% | 210, stop at page 22 |
| v2 | read only added items on growing lists, 3 stale pages, server errors | 1655 of 1655, 100%, 66 s | 2944, 99.5%, 232 s | 1459, 84.4%, 357 s | 210, `server_error` on page 22 |
| v3 | extra passes when the order shifts | | | 737, 42.7% | |
| v4 | ignore stale pages before the expected last page | | | 1647, 95.3%, 1701 s | |
| v5 | wait for the list to change, not for a new product | 1655, 100%, 45 s | 2944, 99.5%, 415 s | 1669, 96.6%, 569 s | 210, `server_error` |

WAGO showed 29 of 31 in every version. Opening page 2 by hand showed 9 products, so 29 is all the list displays.

The v5 runs had no pause between pages. The 1-second default pause came after them, and its effect on time is not measured. The second Pepperl pass in v5, which added nothing, ran under the old repass rule. The current rule would skip it, which is also not measured.

## What we learned

### A growing list outgrows the reader

Pepperl stopped at 600 rows in v1 because the item reader capped a read at 600. Load-more lists keep every loaded item in the page. The reader now takes a starting index, and paging reads only the items added since the last step.

### Zero new products does not mean the end

Posital's default order shifts between page loads. Loading pages 40 to 47 twice gave different products on pages 40 and 45. Whole pages repeat earlier ones. Page 25 brought 0 new of 20, and pages 42 to 44 brought nothing new at all. v1 stopped at the first such page, and v3 at the third in a row. The end of a list is an empty page, an unchanged page or a missing control. With an advertised total, repeats before the expected last page, `ceil(total / page size)`, do not stop the pass.

### Several passes recover part of a shifting order

When the total is not reached and repeats reach 1% of the total, code goes back to page 1 and pages through again, keeping only new identities. It stops when a pass adds under 1% of the total, after 3 passes. On Posital the three passes added 1397, 214 and 58 rows, ending at 1669 of 1728. Posital's sort menu offers only price and delivery time, which tie on many products, so sorting cannot fix the order. Splitting the list by a filter is the next idea.

### Wait for the change, not for something new

v4 waited after each step until a product it had not seen appeared. On a page of repeats that never happens, so each such page cost the full 12-second timeout and Posital took 1701 s. v5 waits until the list differs from the previous page, or for a URL load, until rows exist. Posital dropped to 569 s with slightly more rows.

### Watch the network

Deublin always stopped at page 22. Its page showed "page 22 of 1" and no items. The network showed the site's own API answering `searchPage: 22` with HTTP 500 three times. After that the site's next button disappears, so a click-driven list cannot skip the page. Paging now counts 5xx responses during each step and records the page in `failed_pages`. A URL-driven list skips up to 3 failed pages.

### Paging fast gets you blocked

After the full ifm run, 34 pages in about a minute, the next ifm request got Akamai's "Access Denied". Jev classified that page as blocked, which was correct. Paging now pauses 1 s between pages by default.

## Tests

`test/paging.test.ts` serves fake shops with Playwright's `page.route` and a scripted judge. Each test reproduces one failure seen on a real site.

| Fake shop | Real site it reproduces |
| --- | --- |
| zero-based `?page=` links ending in an empty page | Posital |
| icon-only next button driven by JavaScript | ifm, WAGO |
| load more that appends items | Pepperl |
| HTTP 500 on one page | Deublin |
| order that shifts on every load | Posital |
| pages that repeat earlier pages before the end | Posital |

Unit tests cover template fitting, including keeping leading zeros in paths such as `200_010`, mechanism order and the repass rule.

## Remaining problems

- Page-size selects are collected but never used. ifm offers 125 per page instead of 50.
- Lists with a shifting order cannot reach 100% by paging alone.
- A click-driven list ends at the first page the server fails to serve.
- Throttled pages can look like normal pages. After many visits Elesa served product pages without header or table, and Jev judged one a product page at 0.84.

## Reproduce

```bash
set -a; . ~/.config/typesafe/.env; set +a
npx tsx bench/paging.ts 4                       # all lists, 4 pages each
npx tsx bench/paging.ts 150 ifm-inductive       # one list in full
```

Each list folder holds `paging.json` with every step, `rows.json` and `trace.json`. Space out full runs on the same site.
