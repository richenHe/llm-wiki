---
name: collect-best-sources
description: Find, acquire, provenance-label, and safely inject selected web pages, documents, images, public videos, repositories, datasets, and other source files into the current LLM Wiki project. Use for topic research or for importing existing search results, curated URL/file lists, resource tables, manifests, or staged materials without searching again. When discovery invokes find-best-resources, show the search results and stop for explicit user confirmation before acquiring, staging, or injecting any discovered candidate. For repositories, inspect a pinned snapshot with repository-intelligence and inject one evidence-indexed repository-framework-v2 Markdown capsule instead of the working tree or individual code files. Clone only when remote traversal cannot resolve decision-critical evidence. Leave ordinary-source interpretation, entity extraction, indexing, and wiki generation to LLM Wiki.
---

# Collect the best sources

## Overview

Coordinate existing research and format-specific skills. Preserve original material and provenance.
Repositories are the narrow exception to original-file injection: turn each pinned snapshot into one
evidence-indexed framework capsule so LLM Wiki receives one high-quality source rather than hundreds of
code tasks.

Treat discovery and collection as separate user-visible phases. Search and verify candidates first,
then pause until the user explicitly chooses what may be collected.

## Run the workflow

1. Evaluate `has_existing_search_materials` before invoking any search:
   - Set it to `true` when the user has explicitly supplied, selected, confirmed, or asked to import one
     or more URLs, files, repository names, resource-table rows, manifest entries, staging directories,
     or previously collected materials.
   - Also set it to `true` when the user asks to import, process, organize, or inject the supplied
     materials, even if they do not call them "search results."
   - Never set it to `true` merely because an earlier assistant message or tool output contains a
     search-result list. If those candidates have not been explicitly approved, preserve or re-present
     the numbered list, set `state = awaiting_user_confirmation`, and stop without searching again.
   - Set it to `false` only when the user supplied merely a topic, question, or open-ended goal and no
     candidate source is already available.
2. Select the operating mode with this branch:

   ```text
   if has_existing_search_materials:
       mode = curated
       skip find-best-resources and every open-ended search step
       process only the existing material set
   else:
       mode = discovery
       invoke find-best-resources
       present the discovery results to the user
       state = awaiting_user_confirmation
       stop
   ```

   In curated mode, do not supplement, replace, re-rank, or search for alternatives unless the user
   explicitly asks for gap-filling or a fresh search. Missing metadata is a retrieval task, not permission
   to restart discovery.
3. In discovery mode, complete only the search, filtering, verification, and adoption-decision stages of
   `find-best-resources`. Then present a user-visible candidate report containing:
   - a stable number or ID for every candidate;
   - its title and primary URL;
   - why it fits, its recommended adoption outcome, and the evidence status of decision-critical claims;
   - known access, license, version, completeness, or compatibility gaps;
   - a clear recommended selection when the evidence supports one;
   - an explicit request for the user to approve specific IDs, approve the recommendation, change the
     selection, or request more searching.
4. After presenting that report, end the turn with `state = awaiting_user_confirmation`. Do not treat the
   original topic request, the assistant's own recommendation, silence, or an ambiguous reply as approval.
   Resume only when the user explicitly identifies the approved candidates or clearly says to proceed with
   the recommended set or all shown results. Preserve the approved IDs and URLs as the exact collection
   scope. If the user changes the scope, show the revised selection and obtain confirmation again whenever
   the change adds newly discovered candidates.
5. While awaiting confirmation, do not download final source files, clone repositories, invoke acquisition
   or archival pipelines, create staging content or provenance notes, call the loopback injection service,
   write into `raw\sources`, or clean up collection jobs. Opening pages or repository files only to verify
   facts for the candidate report is allowed; retaining them as collected knowledge is not.
6. After explicit confirmation, set `mode = confirmed-discovery` and process only the approved candidate
   set. Treat those approved results as curated inputs for all remaining steps; do not silently substitute
   or supplement them. If retrieval exposes a materially different resource, license, version, or scope,
   disclose the change and ask for confirmation before collecting the replacement.
7. Use `agent-reach` only as required by the selected mode:
   - **Discovery mode**: use it for internet search and evaluation-only retrieval, preferring official and
     primary sources; do not retain retrieved content as collected knowledge before confirmation.
   - **Curated mode**: use it only to retrieve or inspect the supplied URLs; do not issue search queries.
   - **Confirmed-discovery mode**: use it only to retrieve the user-approved URLs; do not continue open-ended
     search unless the user asks for it.
8. Read [references/source-routing.md](references/source-routing.md), then route every selected resource
   by type.
9. For every selected Git repository, invoke `repository-intelligence` and read
   [references/repository-capsule.md](references/repository-capsule.md). Follow the v2 capsule contract
   instead of injecting the working tree. Keep the v1 report contract only for legacy recovery.
10. Before validating a repository capsule, run the framework-quality self-review defined in the
   capsule contract. Rewrite list-heavy or file-driven passages into conclusions, grouped differences,
   representative evidence, and explicit follow-up routes.
11. Stage non-video downloads under `D:\video\package\.staging\<job-id>\`. Never use C: for bulk data.
12. Record source URL, retrieval date, author/publisher when known, license status, and immutable identifiers
   such as a repository commit SHA. Do not invent missing metadata.
13. Ask LLM Wiki's loopback service for the current project and inject into
   `raw\sources\collected\<topic>\`; never write directly into `wiki\`.
14. Verify the injected destination exists and matches staged content before cleanup.
15. Delete verified temporary downloads. Never delete anything under the target project's `raw\sources`.

## Preserve the responsibility boundary

Do:

- collect original resources;
- remove exact duplicate downloads using hashes or canonical identifiers;
- create minimal provenance notes needed to connect an image or repository snapshot to its source;
- transport complete source files into LLM Wiki;
- analyze a pinned repository snapshot at framework level, using remote repository APIs by default;
- inject exactly one evidence-indexed framework capsule per repository;
- report unsupported files that were archived but produced no ingest task.

Do not:

- summarize ordinary webpages, documents, or images;
- run downloaded code or install its dependencies;
- perform OCR, entity extraction, semantic chunking, embeddings, wiki deduplication, or page generation;
- delete injected source files after ingestion.

Repository reports may explain architecture, capabilities, flows, modules, configuration, hardware
variants, use, limitations, and reuse opportunities. They must not copy the codebase, enumerate every
symbol, create final wiki pages, or claim runtime behavior from static inspection. Group repeated
families before naming representative members; preserve exact names only when a difference affects
architecture, configuration, compatibility, operation, risk, or later retrieval.

Video is the explicit exception: delegate public YouTube, Douyin, and Bilibili inputs to
`download-cn-video`. Let that skill inject `knowledge.md`, archive the remaining evidence below the
raw source's hidden `.cache` tree, verify every file, and clean its temporary package; do not reimplement
its downloader, subtitle, transcription, keyframe, archival, or injection pipeline.

## Use the deterministic helpers

Create a provenance note for an image or other non-repository source:

```powershell
python "<skill-dir>\scripts\write_source_note.py" `
  --output "<staging-dir>\SOURCE.md" `
  --kind repository `
  --title "owner/repository" `
  --source-url "https://github.com/owner/repository" `
  --commit "<full-sha>" `
  --license "MIT" `
  --json
```

Inject a staged ordinary file or directory and safely remove only an explicitly bounded temporary source:

```powershell
python "<skill-dir>\scripts\inject_sources.py" "<staged-path>" `
  --topic "<topic>" `
  --temporary-root "D:\video\package\.staging" `
  --cleanup-source `
  --json
```

For repositories, prefer remote traversal with `repository-intelligence`. Resolve the full commit SHA,
walk the tree, open decision-relevant files, and create:

```text
D:\video\package\.staging\<job-id>\
└── <owner>-<repo>-repository-capsule.md
```

Validate the remote-evidence capsule:

```powershell
python "<skill-dir>\scripts\validate_repository_capsule.py" `
  "<staging-dir>\<owner>-<repo>-repository-capsule.md" `
  --json
```

Only after validation succeeds, inject the single report and clean it:

```powershell
python "<skill-dir>\scripts\inject_sources.py" `
  "<staging-dir>\<owner>-<repo>-repository-capsule.md" `
  --topic "<topic>" `
  --temporary-root "D:\video\package\.staging" `
  --cleanup-source `
  --json
```

Clone only when remote traversal cannot read decision-critical files, the host/API lacks the required
access, submodules or LFS pointers materially affect the decision, or the user requests local build/test
verification. Put that fallback clone under `<job-id>\repository`, set `evidence_mode: local-clone`,
validate the capsule with `--repository-dir`, and use `--cleanup-job-root <job-id>` after injection.

Any fallback clone is temporary evidence, not knowledge-base content. Never inject the working tree,
individual README files, licenses, CSV/TXT assets, or code files when a valid repository report exists.
If validation or injection fails, retain the whole job directory for recovery.

## Validate

Before claiming success, verify:

1. every discovery-generated candidate was shown to the user before any collection operation began;
2. the user explicitly confirmed the exact collected IDs or clearly approved the recommended or complete
   displayed set, and no collected item falls outside that scope;
3. every selected item has a primary URL or an explicitly labelled unknown source;
4. repository snapshots have a recorded full commit SHA and evidence mode;
5. each repository produced exactly one capsule conforming to `repository-framework-v2`;
6. repository capsules contain protected provenance, evidence-status labels, referenced evidence IDs,
   stable commit-pinned URLs or locally verified clone paths, explicit runtime-verification state, and
   no unresolved placeholders;
7. repository capsule self-review confirms that major responsibilities are covered, repeated families
   are grouped, core conclusions cite representative evidence, and detailed names remain reachable
   through pinned follow-up routes;
8. image source notes reference an adjacent, safe-named local image;
9. the target path is inside the active project's `raw\sources\collected`;
10. destination hashes match staged input;
11. cleanup removed only paths inside the explicit staging root;
12. video injection archived and hash-verified every package file except `source.mp4`, wrote its raw-side
   receipt, and only then removed the complete temporary video package.
13. non-video injection used the target's watcher-excluded `.cache` staging directory, so LLM Wiki queued
   only final `raw\sources\collected\...` paths.
