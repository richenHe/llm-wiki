from __future__ import annotations

import argparse
import tempfile
import unittest
from pathlib import Path

from inject_sources import InjectError, ensure_cleanup_target
from validate_repository_summary import REQUIRED_HEADINGS, validate


class RepositorySummaryValidationTests(unittest.TestCase):
    def test_accepts_complete_framework_report_with_resolving_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repository = root / "repository"
            repository.mkdir()
            for name in ("README.md", "package.json", "LICENSE", "src/main.ts", "docs/guide.md"):
                path = repository / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"# {name}\n", encoding="utf-8")

            commit = "a" * 40
            headings = "\n\n".join(
                f"{heading}\n\n"
                + "本节直接说明项目框架、责任边界、配置、流程、限制和复用方法。"
                + "内容来自固定快照，未执行的行为明确标记为运行时未验证。"
                for heading in REQUIRED_HEADINGS
            )
            citations = "\n".join(
                f"- `{path}`：固定证据路径。"
                for path in ("README.md", "package.json", "LICENSE", "src/main.ts", "docs/guide.md")
            )
            body = (headings + "\n\n" + citations + "\n") * 4
            summary = root / "summary.md"
            summary.write_text(
                "\n".join(
                    (
                        "---",
                        "type: repository-analysis",
                        "report_contract: repository-framework-v1",
                        "repository: owner/repository",
                        "source_url: https://github.com/owner/repository",
                        f"commit: {commit}",
                        "branch_or_tag: main",
                        "retrieved_at: 2026-07-29",
                        "license: MIT",
                        "analysis_scope: framework",
                        "evidence_mode: local-clone",
                        "---",
                        "",
                        "# owner/repository：仓库框架分析",
                        "",
                        body,
                    )
                ),
                encoding="utf-8",
            )

            result = validate(summary, repository)

            self.assertTrue(result["ok"], result["errors"])
            self.assertEqual(len(result["resolved_citations"]), 5)

    def test_rejects_placeholder_and_missing_sections(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repository = root / "repository"
            repository.mkdir()
            summary = root / "summary.md"
            summary.write_text(
                "---\ntype: repository-analysis\n"
                "report_contract: repository-framework-v1\n"
                "repository: owner/repository\n"
                "source_url: https://github.com/owner/repository\n"
                f"commit: {'b' * 40}\n"
                "branch_or_tag: main\nretrieved_at: 2026-07-29\n"
                "license: unknown\nanalysis_scope: framework\n---\n\nTODO\n",
                encoding="utf-8",
            )

            result = validate(summary, repository)

            self.assertFalse(result["ok"])
            self.assertTrue(any("placeholder" in error.lower() for error in result["errors"]))
            self.assertTrue(any("heading" in error.lower() for error in result["errors"]))

    def test_accepts_remote_api_report_without_clone(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            commit = "c" * 40
            headings = "\n\n".join(
                f"{heading}\n\n"
                + "本节说明仓库框架、主要能力、配置、限制和复用边界，并区分静态证据与未知项。"
                for heading in REQUIRED_HEADINGS
            )
            pinned_links = "\n".join(
                f"- [证据 {index}](https://github.com/owner/repository/blob/{commit}/path-{index}.md)"
                for index in range(1, 6)
            )
            summary = root / "summary.md"
            summary.write_text(
                "\n".join(
                    (
                        "---",
                        "type: repository-analysis",
                        "report_contract: repository-framework-v1",
                        "repository: owner/repository",
                        "source_url: https://github.com/owner/repository",
                        f"commit: {commit}",
                        "branch_or_tag: main",
                        "retrieved_at: 2026-07-29",
                        "license: MIT",
                        "analysis_scope: framework",
                        "evidence_mode: remote-api",
                        "---",
                        "",
                        "# owner/repository：仓库框架分析",
                        "",
                        (headings + "\n\n" + pinned_links + "\n") * 4,
                    )
                ),
                encoding="utf-8",
            )

            result = validate(summary)

            self.assertTrue(result["ok"], result["errors"])
            self.assertEqual(result["evidence_mode"], "remote-api")


class CleanupBoundaryTests(unittest.TestCase):
    def test_rejects_cleanup_root_itself(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / "project"
            project.mkdir()

            with self.assertRaises(InjectError):
                ensure_cleanup_target(root, root, project)

    def test_accepts_bounded_job_outside_project(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            staging = root / "staging"
            job = staging / "job-1"
            project = root / "project"
            job.mkdir(parents=True)
            project.mkdir()

            ensure_cleanup_target(job, staging, project)


if __name__ == "__main__":
    unittest.main()
