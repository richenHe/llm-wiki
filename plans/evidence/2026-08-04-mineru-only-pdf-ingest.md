# MinerU-only PDF ingest repair evidence

Date: 2026-08-04

## Required behavior

- MinerU is the only content and image extraction path for PDF ingest.
- If MinerU is disabled, unconfigured, fails to parse, fails to download its ZIP, returns no `full.md`, references a missing image, or cannot save an extracted image, the current PDF remains pending and the whole ingest queue pauses.
- A failed MinerU run must not invoke built-in PDF text extraction, embedded-image extraction, full-page rendering, a vision model, or the knowledge-generation model.
- DOCX, PPTX, Markdown, and other non-PDF source behavior is unchanged.

## Code evidence

- `src/lib/ingest.ts` skips built-in source reading for PDFs and throws `IngestQueuePauseError` on every MinerU preparation failure.
- The PDF branch takes images only from `mineruSavedImages`; the former local extraction and full-page rendering fallback is absent.
- `src/lib/mineru.ts` requires the official complete `full.md`, rejects unresolved local image references, and rejects image-write failures instead of keeping text-only output.
- `src/lib/ingest-queue.ts` keeps the current task pending, stores the exact failure, and pauses before another queued document starts.
- The document pipeline version was raised to 4 so earlier degraded PDF results cannot be reused as valid cache hits.

## Verification evidence

- `npm run typecheck`: passed.
- `npm run test:mocks`: 126 test files passed; 1,795 tests passed.
- Focused PDF/MinerU/queue suite: 3 test files passed; 119 tests passed.
- Queue regression verifies that after the first PDF raises a MinerU repair error, the first and second PDFs both remain pending, only one ingest attempt occurs, retry count stays at zero, and the queue reports paused.
- MinerU regression verifies that a missing `full.md`, an ambiguous or missing image reference, and an image disk-write failure all reject the result.
- Static search confirms `renderAndSavePdfPages()` has no production ingest caller; its remaining implementation is an unused low-level utility and test helper.

## Rollback

- Restore the pre-update executable saved by the standalone preparation script in `D:/llmwiki-deps/app/llm-wiki.before-20260804-151151.exe`.
- Revert the Git commit associated with this evidence file to restore the previous source behavior.
