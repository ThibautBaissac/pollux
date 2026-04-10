Implement: {{FEATURE_NAME}} (ref: docs/nanobot-feature-gap.md)

Phase 1 — Spec
- Read the feature row in docs/nanobot-feature-gap.md
- Read nanobot's implementation for reference (~/code/ThibautBaissac/nanobot)
- Read Pollux's current code in the affected areas
- Produce a short spec:
  - Goal: 1-2 sentences
  - Data model changes (new tables, columns, files)
  - API routes (method, path, request/response shape)
  - UI changes (which page/component, what the user sees)
  - Agent changes (tools, system prompt, config)
  - Edge cases & security considerations
- Stop and show me the spec before writing any code

Phase 2 — Implement
- After I approve the spec, implement it end-to-end
- Follow existing Pollux patterns (CLAUDE.md, .claude/rules/)
- Commit nothing — leave changes unstaged for my review

Phase 3 — Verify
- Run npm run build — fix any errors
- Run npm run lint — fix any warnings
- Run npm test — fix any failures
- Add tests for new server-side logic if it's pure/unit-testable
- Run npm test again to confirm

Rules:
- No scope creep — implement exactly what the spec says
- No new dependencies unless strictly necessary (justify if so)
- Adapt nanobot's approach to Pollux's stack, don't port it literally
- Keep the UI consistent with existing Pollux dark theme and patterns
