# LLM Wiki Windows build pipeline isolation

## Scope

- Added a content-based application input fingerprint shared by launch and preparation checks.
- Added a Rust test entry that always uses `D:\llmwiki-deps\cargo-test-target`.
- Reserved `D:\llmwiki-deps\cargo-target` for standalone Tauri desktop builds.
- Added a single-build mutex, dependency lock stamps, stage timing, and build-history logging.
- Added project rules that require targeted tests before one final desktop build and prohibit unrelated refactors.

## Verification on 2026-08-04

- All four PowerShell files passed parser validation with zero syntax errors.
- Build fingerprint: `E86F8E7DA867D80E190BE0F5EBD8F381D8E0E324824124D133D01E255FED722B` across 273 application input files.
- `AGENTS.md` is excluded from application inputs.
- `src-tauri/src/commands/mineru_download.rs` is included in application inputs.
- `src/lib/mineru.test.ts` is excluded from application inputs.
- Running `prepare-llmwiki.ps1` against the already deployed fingerprint skipped all dependency and build stages in 2.56 seconds.
- The Rust test wrapper reported `D:\llmwiki-deps\cargo-test-target` and completed `cargo --version` without touching the desktop target.
- A held `Local\LlmWikiStandaloneBuild` mutex caused a second preparation attempt to fail immediately before compilation.

## Recovery

- Previous external preparation script: `D:\llmwiki-deps\prepare-llmwiki.before-20260804-181500.ps1`
- Previous external launcher script: `D:\llmwiki-deps\run-llmwiki.before-20260804-181500.ps1`
- Existing standalone executable was not rebuilt or replaced during this pipeline-only change.
