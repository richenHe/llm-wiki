# Document ingest completeness repair — 2026-08-04

## User-visible incident

- Source: `历史_八年级下册_统编版.pdf` (114 pages).
- Incorrect result before this repair: the ingest reported completion after writing only three files, with zero expected knowledge pages and no clickable concept/entity links in the source summary.
- Image coverage was also allowed to complete with 105 cached captions and 9 failed captions.

## Reproduced failures before the repair

The new regression tests failed before the implementation change:

- A legacy long-document outline returned no expected knowledge paths.
- A long document wrote only its source summary instead of the three explicit entity/concept pages in its outline.
- The caption pipeline reported only a failure count and did not retain the failed image path and error message.

## Repair contract

- Long documents prefer the explicit `Generation Contract` knowledge-page list.
- If an older long-document analysis has no usable contract, explicit schema-qualified links from the complete outline are recovered.
- If neither pages nor an explicit `NO_STANDALONE_PAGES: reason` decision exists, one small plan-finalization model call runs. An empty result fails before any Wiki page is written.
- Every generated knowledge page is added to the source summary as a verified clickable link.
- When image description is enabled, one failed image makes the ingest incomplete. Successful image descriptions remain cached, so retrying calls the vision model only for failed images.
- The document pipeline version changed from 2 to 3, so results created by the broken completeness rule are not reused as valid cache hits.

## Verification evidence

Commands run from `D:\project\llmwiki`:

```text
npm exec vitest run src/lib/ingest-source-path-collision.test.ts src/lib/ingest-parse.test.ts src/lib/image-caption-pipeline.test.ts src/lib/source-summary-links.test.ts
Result: 4 test files passed; 102 tests passed.

npm run typecheck
Result: passed with zero TypeScript errors.

npm run test:mocks
Result: 126 test files passed; 1,793 tests passed.
```

Important verified examples:

- A long-document outline containing `[[entities/邓小平]]`, `[[concepts/改革开放]]`, and `[[concepts/经济特区]]` produced all three knowledge files and added clickable links to the source summary.
- An empty long-document plan raised `Long-document knowledge plan could not be finalized` and did not write a misleading source-only Wiki result.
- A failed image caption retained both `/abs/b.png` and `HTTP 500` in the structured failure evidence.

## Scope and rollback

This repair does not delete or rewrite existing test knowledge automatically. Re-importing a source uses pipeline version 3 and regenerates it under the repaired rules.

The Git commit containing this evidence is the rollback point. Reverting that commit restores the exact pre-repair source state; for example, `git revert <commit>` creates a new commit that undoes this repair without deleting later history.
