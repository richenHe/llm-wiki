# Source routing

| Source type | Acquire | Inject | Temporary cleanup |
|---|---|---|---|
| Web article | Save full article Markdown with original URL | Markdown unchanged | Delete staged copy after verified injection |
| PDF/Office/data | Download original file | Original file unchanged | Delete staged copy after verified injection |
| Image | Download original image and add an adjacent provenance Markdown note | Image plus note | Delete staged copy after verified injection |
| Public video | Invoke `download-cn-video` | `knowledge.md` plus a hidden raw-side evidence archive | Let that skill delete the complete package only after manifest and hash verification |
| Git repository | Traverse a pinned commit through repository APIs with `repository-intelligence`; clone only as fallback | One `repository-framework-v2` evidence-indexed Markdown capsule; no code tree | Delete the staged capsule, or fallback clone job, only after validation and verified injection |
| Archive/CAD/PCB/binary | Download original and record provenance | Original file; report if LLM Wiki cannot ingest it | Delete only when an injected canonical copy exists |

## Repository acquisition

Use repository API/platform tools first. Resolve a full commit SHA, inspect the complete tree map, then
open README files, manifests, docs, entrypoints, representative modules, tests, configuration, and
license directly at that commit. Stable commit URLs are the validation evidence; downloading the working
tree is unnecessary for normal framework reports.

Clone only when remote traversal cannot resolve decision-critical evidence, access is available only
through local Git, material submodule/LFS content cannot be inspected remotely, or the user requests
runtime verification:

```powershell
git clone --depth 1 --branch "<branch-or-tag>" "<url>" "<staging-dir>\repository"
git -C "<staging-dir>\repository" rev-parse HEAD
```

Do not install dependencies, initialize submodules, use Git LFS network downloads, or execute project
scripts unless the user separately requests runtime verification. Preserve files already present in the
checked-out tree while analyzing it. Record unresolved submodules or LFS pointer files as limitations.

Invoke `repository-intelligence`, then create exactly one capsule using
[repository-capsule.md](repository-capsule.md). The clone is evidence for capsule generation and
validation only when the fallback path was required. Do not inject it into LLM Wiki.

## Image provenance note

Keep the note factual and minimal:

```markdown
---
type: image-source
title: "Original title"
source_url: "https://example.com/original"
author: "Known author"
retrieved_at: "YYYY-MM-DD"
license: "unknown"
---

# Original title

![Original image](safe-image-name.jpg)
```

Do not add OCR, captions, inferred descriptions, or claims. LLM Wiki owns visual interpretation.

## Cleanup invariant

Treat `D:\video\package\.staging` as disposable and `raw\sources` as durable. Cleanup is allowed only
after byte/hash verification and only for a source or repository job strictly below the explicitly
supplied staging root. Repository cleanup additionally requires a valid report and successful injection.
Never clean the staging root itself, a user-selected local original, a drive root, or any path under the
active LLM Wiki project.
