# MinerU upload timeout and retry verification

## Problem reproduced

- The queue remained on `Uploading file to MinerU...` with no file or queue update after the five-minute outer limit.
- Upload-address requests, file uploads, and status polls had no per-request timeout.
- A single HTTP request that never settled could therefore bypass the outer polling deadline.

## Change

- Split progress into local PDF reading, upload-address request, file upload attempt, and MinerU processing.
- Upload-address and status requests time out after 30 seconds.
- File uploads use a size-aware timeout between 120 and 600 seconds.
- Each upload attempt requests a fresh signed upload address; at most three attempts are made.
- Timeout completion uses `Promise.race`, so it does not depend on the HTTP plugin honoring cancellation.

## Verification

- MinerU focused tests: 47 passed.
- Image-caption and MinerU combined tests: 66 passed.
- Full local mock suite: 127 files and 1,803 tests passed.
- TypeScript typecheck passed.
- A request mock that never resolves and ignores cancellation was terminated by the wrapper timeout.
- A failed first upload requested a second signed address and completed through poll and ZIP extraction.
