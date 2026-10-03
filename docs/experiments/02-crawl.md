# Experiment 2: crawl

## Question

Starting from a hub or a family list, can the crawler open categories and families until every branch ends in something it can read, without wandering into unrelated parts of the site?

## Setup

`src/crawl.ts` runs a breadth-first crawl in one browser tab. Each page goes through recon from experiment 1. Code then follows the main group's item links when the action is `expand_items`. Limits are 40 pages, depth 4 and 25 children per page by default. Code drops URL fragments, keeps query strings, and only follows links on the seed's site and locale. When Jev finds a "view all" link at confidence 0.7 or more, the crawler tries it first and keeps the children as a fallback.

The crawl bench, `bench/crawl.ts`, runs six seeds with 15 pages each. We chose the seeds for their shapes:

| Seed | Shape | Expected leaves |
| --- | --- | --- |
| Pedrollo peripheral pumps | family list | series and product pages, no drift |
| VEGA radar | family list | configurable families |
| Elesa+Ganter clamping knobs | about 130 family cards | variant tables or configurable families |
| Novotechnik linear transducers | categories, then series | series pages or variant lists |
| ifm product hub | deep category tree | leaf product lists |
| Kennametal cut-off | mixed page | product lists |

## The first crawl drifted

The first Pedrollo crawl judged 30 pages, made 97 Jev calls and took 176 s. It found 2 product lists and 8 product pages, and drifted from peripheral pumps into VSP, CP, WR, MAGNIFICA and HYDROFRESH. On series pages such as PQA, Jev picked the 4-item "Könnte Sie interessieren" carousel of related products as the main list. That made the page `expand_items`, and the crawler opened the carousel's products.

Two changes stopped the drift.

1. **Pages about one product or series are terminal.** If the page kind is `product_detail`, or Jev is at least 0.9 sure the page is about one product or one series, the crawler never expands from it. It ends in one of these:

   | End | When |
   | --- | --- |
   | `extract` | the page lists its variants |
   | `configurable_family` | variants come only from a configurator |
   | `product_page` | one product |
   | `series_page` | a series whose variants are not listed |

2. **A Noul per group asks whether it is presented as related, recommended or similar products.** On pages about one product, code drops a group that scores 0.6 or more.

After the change, Pedrollo judged 10 pages in 34 s with 23 Jev calls. Its 9 series ended as 6 series pages and 3 product pages. The series pages list their models, such as PK 65 to PK 300, only in the text and a PDF datasheet. That is why `series_page` exists. It records honestly that the site does not list the products.

The related-products rule then broke Misumi in the hub suite. Misumi's main list is titled "Recommended products", and Jev answered the related question literally at 0.81. The rule now applies only on pages about one product or series. On listing pages the main-group question already tells Jev to ignore carousels.

## Results over time

| Run | Change | Pedrollo | VEGA | Elesa | Novotechnik | ifm hub | Kennametal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 22:12 | terminal detail pages, related Noul | 6 series, 3 products | 12 configurable | 3 configurable, 11 stop | 7 configurable, 1 stop | 2 lists | 1 page |
| 22:23 | variant tables win over configurators, layout groups | same | same | 6 lists, 8 configurable | 7 configurable, 2 series | 2 lists | 1 page |
| 22:41 | homogeneity layout rule, richer nested groups kept | same | same | 13 lists, 1 configurable | same | 2 lists | 1 page |
| 23:25 | listing recipes from experiment 3 | same | same | 13 lists, 196 rows | same | 3 lists, 106 rows | 1 page |

Each seed used 23 to 35 Jev calls for 10 to 15 pages.

## What we learned

### Variant tables beat configurators

Elesa family pages have a colour selector and a 3D configurator, plus a table of order codes such as `64635-C9 VB.839/63 B-M8-C9`. Under the configurator rule they ended as configurable families. The table rows are the non-expandable products the user asked for, so a listed variant table now wins. `configurable_family` is only for families with no list.

### Page layout hides lists

Elesa still ended in `stop` on 11 of 15 pages after the first fix. The snapshot's group detector saw the page's header, content and newsletter sections as a 3-item repeated group. Being the largest group by area, it hid the 42-row variant table nested inside it. Hager's 12 category tiles in the hub suite had the same problem.

The fix took three tries.

1. "A group whose items contain a richer group is layout." This marked the variant table itself as layout, because one row's 15 cells outnumber the table's 12 rows.
2. "Layout only if fewer than half of its items contain a richer group." This failed on the real page, because header and footer also contain menus and link lists.
3. "Layout if the smallest item has under 15% of the largest item's element count, and the largest has more than 50." List items are built alike and page sections are not. This worked. Separately, a nested group is now kept when it has more items than the group around it, unless it is made of one item's own children, like the cells of a row.

After the third version, Elesa reached 13 product lists of 15 pages and Hager's tiles appeared. The hub suite rose from 15/20 to 16/20, and the finder suite stayed at 15/15.

### Page kind is unreliable at the edges

An Elesa family page came back as `product_detail` at 0.48, just under the 0.5 threshold used then. Code now also treats a page as about one product or series when Jev is at least 0.9 sure from the page's own content.

### Breadth first needs a budget

The ifm hub has 12 top categories with 3 to 12 subcategories each. Within 15 pages the crawl reached the inductive and pressure sensor lists, with 48 to 60 branches still queued. Large hubs need a page budget in the hundreds, or a depth-first mode.

## Remaining problems

- **Kennametal stops after one page.** Its three cards open their categories through "View Categories" buttons with no links. The crawler follows links only. jev-ultrafast's click loop is a candidate fix.
- **The "view all" shortcut is unexercised.** No seed offered a view-all link that Jev accepted at 0.7 or more.
- **Elesa throttles repeated visits.** Later runs got `?err=second` redirects and eventually pages without header or table. See [site notes](../site-notes.md#elesaganter).
- **Novotechnik** ends one branch in `stop` on a profile-type category page. Not investigated.

## Decisions

- Terminal states are part of the result. A crawl reports product lists, product pages, configurable families, series pages without listed variants, finders needing input, and dead ends separately, so the user sees what was not scraped and why.
- A listed variant table beats a configurator.
- Related-product carousels are ignored only on pages about one product or series.

## Reproduce

```bash
set -a; . ~/.config/typesafe/.env; set +a
npx tsx bench/crawl.ts 15                     # six seeds, 15 pages each, 5 pages per list
npx tsx bench/crawl.ts 15 pedrollo 1          # one seed, first page of each list only
npm run crawl -- <url> [out-dir] [maxPages] [maxListPages]
```

Each run writes `tree.md`, `crawl.json`, `trace.json` and `lists/<node>.json`.
