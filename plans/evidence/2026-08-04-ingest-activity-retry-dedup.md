# Ingest activity retry deduplication

## Reproduction evidence

- The persisted ingest queue contained one processing task for `生物_八年级下册_人教版.pdf`.
- The task had `retryCount: 1` and the previous error `Chunk analysis stream failed: empty response`.
- The UI showed two running rows because every `autoIngest` attempt created a new activity item, while an unhandled chunk-analysis exception left the previous item in `running` state.
- The activity panel also rendered both the queue task and its live activity row.

## Fix

- Identify an ingest activity by normalized project path plus normalized source path.
- Mark an unhandled ingest failure as `error` before rethrowing it to the queue.
- Reuse the same non-completed activity item on automatic retry.
- Hide the plain processing queue row when the same source already has a live detailed activity row.

## Verification

- `npm exec vitest run src/stores/activity-store.test.ts src/lib/ingest-source-path-collision.test.ts -- --reporter=dot`
  - 2 files passed, 32 tests passed.
- `npm run typecheck`
  - passed.
- `npm run test:mocks`
  - 128 files passed, 1,806 tests passed.
