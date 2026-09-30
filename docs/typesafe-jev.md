# TypeSafe Jev in jev-catalog

The live docs are the source of truth: https://docs.typesafe.ai/llms.txt. Append `.md` to any page path for Markdown. The vendored skill in `.agents/skills/typesafe-ai/` covers question design and confidence.

## What matters here

- SDK: `@typesafe-ai/sdk` ([JavaScript SDK](https://docs.typesafe.ai/sdk/javascript.md)). The model is `jev-latest`; responses report the versioned id (`jev-1.13.0` on 2026-09-30).
- Input is text only. The snapshot turns pages into short JSON: visible text, controls, overlays and item samples.
- Read [Jev 1.13 jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md) before writing questions. In this project, literal reading has been the main failure mode. Counting also belongs in code.
- One request can hold many questions. Ask speculative ones together ([fan-out](https://docs.typesafe.ai/patterns/fan-out.md)) and let code use the relevant answers.
- Choice and Score answers carry confidence; a Noul returns a probability. See [Confidence](https://docs.typesafe.ai/confidence.md). Thresholds live in code next to the decision that uses them.
