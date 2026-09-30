# AGENTS.md

Read README.md and docs/plan.md before editing.

## TypeSafe Jev

Load the `typesafe-ai` skill in `.agents/skills/typesafe-ai/` for any Jev work, and read `docs/typesafe-jev.md`. The live docs at https://docs.typesafe.ai/llms.txt are the source of truth.

## Rules

- Jev chooses among observed elements, ids and labels. Never let model output become a selector, URL, value or code.
- Code owns thresholds, preference order, counting, waiting and navigation. When a Jev question needs a ranking or an "otherwise", split it into literal questions and combine them in code.
- Every click must map to an element in the latest snapshot. A prompt answer must not change the site or locale; `gate.ts` reverts it if it does.
- A judgment is not proof. Verify outcomes with independent checks, such as rows found against the advertised total.
- Keep state small and relevant. Send bounded text, never whole pages.
- The key lives in `~/.config/typesafe/.env`. Never commit it or print it.

## Tests

- `npm run check` runs the typecheck and the tests. Tests must not call the TypeSafe API.
- Test decision logic with fake answers, and test the snapshot script against local HTML in Playwright.
- Judge a change to prompts or pipeline by the bench: `npx tsx bench/recon.ts finders`. Report the before and after numbers. A bench run costs about $0.01.
- Bench labels come from Jev-free screenshots. Do not relabel a site after seeing Jev's answer for it.
