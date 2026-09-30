# Plan

Compile once, execute deterministically, and let Jev check the result at decision points.

## Definitions (agreed with the user, 2026-09-30)

- A product is a listed item that does not expand further. Product families and series are not products; the crawler expands them.
- A product with an options configurator counts as a family.
- Scope depends on the input URL. A listing URL means scrape that list and its pages. A hub URL means crawl the tree below it down to leaf listings.
- Most catalogues have detail pages, but some do not.
- Maxun Studio is optional. This is a standalone repo.

## Stages

1. **Recon (built).** Answer prompts, judge the page, find the main list, and probe items to tell families from products.
2. **Crawl (built).** Follow `expand_items` breadth-first. Every branch ends in one of these actions:
   - `extract`: a list of products, including a family page's variant table.
   - `product_page`: one product.
   - `configurable_family`: a family whose variants exist only through a configurator.
   - `series_page`: a series page whose variants are not listed (for example only in a PDF datasheet).
   - `needs_input`: a finder that wants a selection first.
   - `stop`: nothing to do.
   Pages about one product or series never expand, so related-product carousels cannot pull the crawl sideways. A "view all" link is tried first when Jev finds one, with the children as fallback.
3. **Listing recipe.** For the main list: which text slots in a card are which fields, which ones are page chrome, the item link, the identity field, and the advertised total.
4. **Pagination.** Code collects the candidates: numbered pages, next buttons, load more, infinite scroll, page-size options and URL parameters. Jev picks one. Code verifies it by checking that new product identities appear.
5. **Detail recipe.** Open three different items. Reveal tabs and accordions, then find and name the spec sections and align their keys across items.
6. **Run.** Replay the recipes with Playwright. Jev checks page boundaries ("are there more products?"), value plausibility on samples, and zero-row pages.
7. **Output.** JSONL or CSV, plus a completeness report comparing rows found with the advertised total, plus the recipe for reruns.

## Known gaps after stage 2

- Items that expand through buttons instead of links (Kennametal "View Categories") are not followed.
- Large hubs need a larger page budget; breadth-first judges every category before descending.
- The "view all" shortcut is built but no bench seed has exercised it yet.

## Finders that need input

For `needs_input` pages, a Jev operation loop such as jev-ultrafast's (operation plus target in one request) can pick filters or areas. That becomes useful once stages 2 to 4 exist.
