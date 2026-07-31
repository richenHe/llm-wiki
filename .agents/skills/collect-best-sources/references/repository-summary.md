# Repository framework report contract

Use this contract only for Git repositories selected as knowledge sources. Invoke
`repository-intelligence` against a commit-pinned remote snapshot before writing the report.

## Goal

Create one self-contained Markdown source that lets a reader understand, evaluate, configure, use, and
reuse the repository at framework level. Do not copy the codebase or describe every symbol. Preserve
enough pinned evidence to reopen exact implementation details later. Use repository APIs and stable
commit URLs by default; do not clone merely to write this report.

## Analysis requirements

1. Record the remote URL, full commit SHA, branch or tag, analysis date, license, and analysis mode.
2. Resolve the complete tree through repository API/platform tooling. Read repository instructions,
   root manifests, primary README, documentation index, entrypoints,
   configuration, representative implementation modules, tests, release/deployment files, and license.
3. Account for every top-level directory in the module map. Classify generated, vendored, media, model,
   example, board-variant, and build-output trees without reading every repeated file.
4. Trace only load-bearing flows that explain how the project works.
5. For hardware variants, enumerate every discoverable board/model name in a compact catalog and explain
   the meaningful dimensions of difference. Do not run one model analysis per variant.
6. Distinguish sourced facts, project claims, static-confirmed behavior, test-confirmed behavior,
   runtime-unverified behavior, inference, and unknowns.
7. Cite important claims with a repository-relative path and, when possible, a stable remote URL pinned
   to the recorded commit.
8. Explain what is directly reusable, what needs adaptation, and what should only be used as a design
   reference for the user's goal.

## Required document structure

Use these exact second-level headings so deterministic validation can protect completeness:

```markdown
---
type: repository-analysis
report_contract: repository-framework-v1
repository: owner/repository
source_url: https://host/owner/repository
commit: 40-character-full-sha
branch_or_tag: main
retrieved_at: YYYY-MM-DD
license: SPDX identifier or unknown
analysis_scope: framework
evidence_mode: remote-api
---

# owner/repository：仓库框架分析

## 1. 决策摘要
## 2. 分析快照与证据范围
## 3. 项目实际是什么
## 4. 功能全景与实现状态
## 5. 架构与核心流程
## 6. 模块与关键源码地图
## 7. 配置、构建与使用
## 8. 硬件、变体与资源目录
## 9. 可复用设计与适配建议
## 10. 限制、风险与未知项
## 11. 溯源索引
## 12. 深入查询指南
```

If a section is inapplicable, retain it and state why. Never leave `TODO`, `TBD`, placeholder text, or
empty sections.

Use `evidence_mode: remote-api` normally. Use `local-clone` only when a clone was materially required.

## Content rules

- Write directly and concretely. Explain technical names the first time they appear.
- Prefer tables for variants, modules, configuration keys, and implementation status.
- Include commands only when they are documented or statically confirmed; label them runtime-unverified
  unless actually run.
- Do not paste long code blocks, generated files, lockfiles, large data tables, or repeated configuration.
- Do not claim exhaustive line-level coverage. "Complete" means complete framework coverage: all major
  responsibilities, flows, modules, variants, operating requirements, limitations, and evidence routes.
- Include repository-relative paths in backticks. Use stable commit URLs for the most important evidence.
- Make the final report useful without immediate repository access, but make every deeper investigation
  reproducible from the pinned commit.

## Validation and cleanup

Run `scripts/validate_repository_summary.py` before injection. In `remote-api` mode it checks metadata,
required sections, report size, unresolved placeholders, and stable URLs pinned to the recorded commit.
In the exceptional `local-clone` mode, also pass `--repository-dir` to verify clone HEAD and cited paths.
Treat mechanical success as a floor, not proof of analytical quality.

Inject only the validated Markdown. Delete the bounded staging job only after the destination hash
matches. If report generation, validation, injection, or cleanup verification fails, retain the staging
job and report the exact failure.
