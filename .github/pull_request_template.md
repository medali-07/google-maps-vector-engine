## What this changes

<!-- And why. If it fixes an issue, link it. -->

## How it was verified

<!--
What you actually ran, and what it said. "Tests pass" is less useful than the
number that changed. If something is still broken or was skipped, say so here
rather than leaving it to be discovered in review.
-->

## Checklist

- [ ] `npm run check` passes (types, lint, formatting, doc snippets)
- [ ] `npm test` passes and `npm run test:coverage` holds the thresholds
- [ ] `npm run build` succeeds and `npm run size` is within budget
- [ ] Tests added for new behaviour, or for the bug being fixed
- [ ] Public API changes are reflected in `docs/` and, if breaking, `MIGRATION.md`
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
