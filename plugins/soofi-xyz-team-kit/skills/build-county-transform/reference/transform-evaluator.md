---
title: Transform evaluator helper
impact: medium
tags: [transform, ai-assist]
---

# Transform evaluator helper (optional)

`elephant-xyz/AI-Agent` ships a LangGraph `test-evaluator-agent` that can generate or
repair a transform output from a prepared input. It is a drafting aid inside the loop in
`SKILL.md`; its output goes through the same validate, coverage, replay, and hash steps
as any hand-written transform.

```bash
# county data group from a prepared ZIP (seed entities plus raw captures)
uvx --from git+https://github.com/elephant-xyz/AI-Agent test-evaluator-agent \
  --transform --group county --input-zip path/to/input.zip [--output-zip path/to/output.zip]

# seed data group from a seed CSV
uvx --from git+https://github.com/elephant-xyz/AI-Agent test-evaluator-agent \
  --transform --group seed --input-csv path/to/seed.csv
```

Environment: `OPENAI_API_KEY` required; `MODEL_NAME` (default `gpt-4.1`) and
`TEMPERATURE` (default `0`) optional.

Do not accept its output on the strength of its own report. Inspect the ZIP, run
`elephant-cli validate`, and prove coverage against the raw capture before scaling.
