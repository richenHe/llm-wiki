# Repository framework capsule contract

Use this contract only for Git repositories selected as knowledge sources. Analyze a commit-pinned
snapshot with `repository-intelligence` before writing the capsule.

## Purpose

Create one self-contained Markdown source that preserves framework-level knowledge without turning each
repository file into an ingest task. The capsule is an evidence map, not a replacement for the repository:
it explains what matters and keeps stable routes back to exact implementation details.

Adapt depth to the repository. Do not target a fixed word count or fixed number of files. Spend analysis
effort according to architectural importance, uncertainty, security impact, hardware variation, and the
user's intended reuse.

## Snapshot and coverage procedure

1. Resolve the full commit SHA, branch/tag, license, and recursive tree state.
2. Record whether the tree inventory is `complete`, `truncated`, or `unknown`.
3. Read repository instructions, root manifests, primary README, documentation index, entrypoints,
   configuration, representative implementation modules, tests, deployment/release files, and license.
4. Account for every top-level responsibility. Group generated, vendored, media, model, example,
   board-variant, and build-output trees instead of enumerating repeated files.
5. Trace load-bearing flows end to end. Inspect more files only when they resolve a material uncertainty.
6. Separate project claims from static implementation, meaningful tests, runtime verification,
   inference, unknowns, and conflicts.
7. Give each decision-relevant evidence item a stable ID and a commit-pinned URL or verified local path.
8. State what was not inspected and how to reopen it from the pinned snapshot.

Framework completeness means all major responsibilities, flows, configuration surfaces, variants,
limitations, and evidence routes are covered. It does not mean every file or symbol is summarized.

## Required frontmatter

```yaml
---
type: repository-capsule
report_contract: repository-framework-v2
repository: owner/repository
source_url: https://host/owner/repository
commit: 40-character-full-sha
branch_or_tag: main
retrieved_at: YYYY-MM-DD
license: SPDX-identifier-or-unknown
analysis_scope: framework
evidence_mode: remote-api
tree_inventory: complete
runtime_verification: not-run
---
```

Allowed values:

- `evidence_mode`: `remote-api` or `local-clone`
- `tree_inventory`: `complete`, `truncated`, or `unknown`
- `runtime_verification`: `not-run`, `partial`, or `verified`

These fields are protected provenance. Populate them from platform/Git evidence, never from guesswork.
Use `unknown`; do not add inferred `author`, `published_at`, `year`, or release metadata.

## Required document structure

Use these exact second-level headings:

```markdown
# owner/repository：仓库框架胶囊

## 1. 快照、目标与覆盖边界
## 2. 项目定位与责任边界
## 3. 能力与实现状态
## 4. 架构与关键流程
## 5. 模块、配置与使用
## 6. 变体、硬件与大型资源
## 7. 限制、风险、许可证与未知项
## 8. 复用与适配建议
## 9. 证据索引
## 10. 深入查询指南
```

Retain an inapplicable section and explain why. Never leave placeholders or empty sections.

## Evidence language

Use only these statuses:

- `project-claim`: stated by project material but not implementation-confirmed
- `static-confirmed`: confirmed by executable code, schema, or configuration
- `test-confirmed`: pinned by a meaningful test path
- `runtime-verified`: actually exercised during this analysis
- `runtime-unverified`: implementation exists but was not run
- `inference`: reasoned from multiple repository signals
- `unknown`: evidence is insufficient
- `conflict`: repository evidence disagrees

Attach evidence IDs such as `[E001]` to important statements throughout the capsule. In section 9, define
each item in this parseable form:

```markdown
- E001 | static-confirmed | `src/main.ts` | [pinned evidence](https://host/owner/repository/blob/FULL_SHA/src/main.ts) | Application entrypoint.
```

Encode spaces and parentheses in URL paths. In remote mode, every indexed item must use a URL pinned to
the recorded commit. In clone mode, every cited repository-relative path must exist in the checked-out
snapshot.

## Content rules

- Preserve exact names for commands, paths, configuration keys, protocols, components, and hardware.
- Label documented commands `runtime-unverified` unless they were actually run.
- Do not turn README promises into implemented behavior.
- Do not infer authors, dates, versions, licenses, benchmarks, or supported variants.
- Group repeated boards, models, examples, plugins, generated assets, and similar files into meaningful
  families before describing them. State the dimensions that distinguish a family, then cite a small
  representative evidence set.
- Name an individual variant only when its difference changes architecture, configuration, compatibility,
  operation, risk, or the user's intended reuse. Route exhaustive membership questions to a pinned tree,
  manifest, registry, or directory in section 10 instead of copying the inventory.
- Lead each paragraph or compact table with a framework conclusion. Paths and evidence IDs support the
  conclusion; they must not become the report's organizing principle.
- Do not paste long code, lockfiles, generated data, complete trees, or symbol inventories.
- Do not hide uncertainty to make the report read smoothly.
- Make the report useful offline, while keeping deeper investigation reproducible from the pinned commit.

## Framework-quality self-review

Before mechanical validation, review and revise the capsule using these questions:

1. If file names and paths were hidden, would sections 2–8 still explain the framework's responsibilities,
   architecture, flows, configuration, variants, limitations, and reuse implications?
2. Can any consecutive list be replaced by a family, decision rule, comparison dimension, or representative
   example without losing a material distinction?
3. Do the capability, architecture, module/configuration, variant, and limitation discussions each cite
   evidence relevant to that discussion, rather than relying on a few unrelated repository files?
4. Does the evidence set cover the load-bearing modules and flows? If a major responsibility lacks evidence,
   inspect it or label the gap `unknown`.
5. Are exact details omitted from the capsule still recoverable through a commit-pinned route in section 9
   or section 10?

Rewrite until every answer is yes or the remaining gap is explicitly labelled. This is a semantic review,
not a fixed word-count, file-count, or list-length gate.

## Validation

Run `scripts/validate_repository_capsule.py` before injection. Mechanical validation checks provenance,
section coverage, evidence vocabulary, evidence references, stable pinned URLs, and clone paths. It is a
quality floor, not proof that the analysis is correct. Heuristic quality findings are warnings only; use
them as prompts for the self-review, not as automatic rejection criteria.

Inject only the validated capsule. Delete temporary evidence only after the destination hash matches.
