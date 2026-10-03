# Findings

The short version of what the experiments showed. Details, numbers over time and reproduction commands are in [experiments/](experiments/README.md). General lessons about Jev are in [jev-patterns.md](jev-patterns.md), and per-site quirks in [site-notes.md](site-notes.md).

## Where each stage stands

| Stage | Result | Write-up |
| --- | --- | --- |
| Page recon | Finders 15/15 correct next action. Hubs 16/20 in the last full run, Misumi fixed since. | [01](experiments/01-page-recon.md) |
| Crawl | Six seeds end in the expected kinds of leaf. Kennametal needs button clicks. | [02](experiments/02-crawl.md) |
| Listing recipe | 8 of 8 lists become rows with a unique identity. Every page that shows a product count yields it. | [03](experiments/03-listing-recipe.md) |
| Pagination | ifm 100%, Pepperl+Fuchs 99.5%, Posital 96.6%, WAGO 93.5% of the advertised total. Deublin's server fails on page 22. | [04](experiments/04-pagination.md) |

## Lessons in one line each

Recon:

1. Cards do not show whether an item is a family. Opening two items does.
2. Preferences inside one question get read literally. Ask what each control does and rank in code.
3. Jev needs to know which site it is on, and code must revert a click that changes it.
4. The first link in a card is often a shared badge. Use the link that differs across cards.
5. Consent dialogs and finders hide in shadow roots and iframes.
6. Several sites block headless Chromium.
7. Low confidence flags wrong answers. High-confidence wrong answers need better evidence, not a higher threshold.

Crawl:

8. Related-product carousels pull a crawl sideways. Pages about one product or series are terminal.
9. A listed variant table beats a configurator.
10. Page layout sections look like lists and hide real lists. Compare how alike the items are.
11. A configurator makes a family only when the page does not name one exact article number.

Listing:

12. Ask what each count text counts, and let code pick the total.
13. When Jev splits between two equivalent options, add their probabilities.
14. Code proposes label pairs, Jev confirms them.
15. Table widgets add filter rows, split headers and clone tables. Merge rows by identity.
16. Reusing a recipe can drop columns silently. Reuse only when no column is new.

Pagination:

17. A page of repeats does not mean the end. The end is an empty or unchanged page or a missing control.
18. Wait for the list to change, not for a product you have not seen.
19. Watch the network. A server error can look like the end of a list.
20. Paging fast gets you blocked. Pause between pages.
21. Tailwind class names look like states. Only whole class tokens count.
22. Throttled pages look like real pages. Code has no check for this yet.

## Open questions

- Balluff's Cloudflare check, Bosch Rexroth judged not a catalogue, and Testo's highlight tabs are unexplained hub misses.
- Kennametal's button-driven categories need a click loop.
- Lists whose order shifts between loads may need splitting by a filter.
- Page-size selects and Pepperl's `size=` parameter could cut page loads. Not tried.
