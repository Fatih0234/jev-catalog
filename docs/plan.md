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
3. **Listing recipe (built).** Steps:
   - Code lines up the text positions of every row or card and finds labels: table headers (including DataTables' separate header table), header rows above div tables matched by column position, `dt`, "Label:" text, and constants followed by a value.
   - Jev confirms each proposed label pair, then says per slot whether it is a name, order code, spec, price, category or chrome.
   - Code names fields by the page's own label, picks the identity (order code, then name, then the item's own link) and checks that it is unique.
   - Code collects count texts. Jev says what each one counts, and code picks the total and the page count.
   - Rows from same-template lists on one page are merged by identity, which handles fixed-column clones.
   - A recipe is reused on sibling pages only when it fits and the page has no column it has not judged.
4. **Pagination (built).** How it works:
   - Code collects controls near the list: numbered pages, next and previous arrows (including icon-only ones), load more, `rel=next` and page-size selects.
   - Jev says what each control does, one literal question per control.
   - Code tries mechanisms in a fixed order: a URL template fitted from numbered links or a next link, click next, load more, click the next number, then scrolling. The first one that brings unseen product identities wins.
   - Code waits for the list to change, not for a fixed time. It stops on an empty or unchanged page, a missing or disabled control, the advertised total, or a page limit.
   - It records HTTP 5xx pages and skips them when paging by URL.
   - When the order shifts between loads (many repeats, total not reached), it makes further passes while they still add at least 1% of the total.
   - It pauses 1 s between pages.
5. **Detail recipe.** Open three different items. Reveal tabs and accordions, then find and name the spec sections and align their keys across items.
6. **Run.** Replay the recipes with Playwright. Jev checks page boundaries ("are there more products?"), value plausibility on samples, and zero-row pages.
7. **Output.** JSONL or CSV, plus a completeness report comparing rows found with the advertised total, plus the recipe for reruns.

## Known gaps after stage 4

- Page-size options (ifm offers 125 per page) are collected but not used.
- A list whose order shifts between loads (Posital) cannot be read completely by paging alone. Splitting it by a filter would be the next step.
- A site that fails to serve a page in a click-driven list (Deublin page 22) ends the list there.
- Unlabelled columns get role names such as `spec_1`.
- A currency shown apart from its price ("116,23" and "EUR") becomes two fields.

- Items that expand through buttons instead of links (Kennametal "View Categories") are not followed.
- Large hubs need a larger page budget; breadth-first judges every category before descending.
- The "view all" shortcut is built but no bench seed has exercised it yet.

## Finders that need input

For `needs_input` pages, a Jev operation loop such as jev-ultrafast's (operation plus target in one request) can pick filters or areas. That becomes useful once stages 2 to 4 exist.
