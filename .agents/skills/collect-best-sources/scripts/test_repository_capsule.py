from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from validate_repository_capsule import REQUIRED_HEADINGS, validate


def capsule_text(commit: str, *, mode: str = "remote-api", extra_frontmatter: str = "") -> str:
    sections = []
    for index, heading in enumerate(REQUIRED_HEADINGS, start=1):
        references = " [E001] [E002] [E003]" if index == 3 else ""
        content = (
            f"This section records framework responsibility, evidence boundaries, limitations, "
            f"and reproducible follow-up routes.{references}"
        )
        if index == 9:
            content = "\n".join(
                (
                    f"- E001 | project-claim | `README.md` | "
                    f"[pinned evidence](https://github.com/owner/repo/blob/{commit}/README.md) | Project description.",
                    f"- E002 | static-confirmed | `src/main.ts` | "
                    f"[pinned evidence](https://github.com/owner/repo/blob/{commit}/src/main.ts) | Main entrypoint.",
                    f"- E003 | test-confirmed | `tests/main.test.ts` | "
                    f"[pinned evidence](https://github.com/owner/repo/blob/{commit}/tests/main.test.ts) | Behavior test.",
                )
            )
        sections.append(f"{heading}\n\n{content}")
    return "\n".join(
        (
            "---",
            "type: repository-capsule",
            "report_contract: repository-framework-v2",
            "repository: owner/repo",
            "source_url: https://github.com/owner/repo",
            f"commit: {commit}",
            "branch_or_tag: main",
            "retrieved_at: 2026-07-30",
            "license: MIT",
            "analysis_scope: framework",
            f"evidence_mode: {mode}",
            "tree_inventory: complete",
            "runtime_verification: not-run",
            extra_frontmatter.rstrip(),
            "---",
            "",
            "# owner/repo：仓库框架胶囊",
            "",
            "\n\n".join(sections),
            "",
        )
    )


class RepositoryCapsuleValidationTests(unittest.TestCase):
    def test_required_headings_and_contract_are_valid_utf8_chinese(self) -> None:
        self.assertEqual(REQUIRED_HEADINGS[0], "## 1. 快照、目标与覆盖边界")
        self.assertEqual(REQUIRED_HEADINGS[-1], "## 10. 深入查询指南")
        contract = (
            Path(__file__).resolve().parent.parent
            / "references"
            / "repository-capsule.md"
        ).read_text(encoding="utf-8", errors="strict")
        for heading in REQUIRED_HEADINGS:
            self.assertIn(heading, contract)

    def test_accepts_remote_capsule_with_pinned_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            capsule = Path(temp) / "capsule.md"
            capsule.write_text(capsule_text("a" * 40), encoding="utf-8")
            result = validate(capsule)
            self.assertTrue(result["ok"], result["errors"])
            self.assertEqual(result["evidence_count"], 3)

    def test_quality_findings_warn_without_blocking(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            capsule = Path(temp) / "capsule.md"
            commit = "d" * 40
            text = capsule_text(commit)
            base_content = (
                "This section records framework responsibility, evidence boundaries, limitations, "
                "and reproducible follow-up routes."
            )
            list_content = "\n".join(
                f"- board-{index}: representative configuration member."
                for index in range(1, 26)
            )
            text = text.replace(
                f"{REQUIRED_HEADINGS[5]}\n\n{base_content}",
                f"{REQUIRED_HEADINGS[5]}\n\n{list_content}",
            )
            text = text.replace("`README.md`", "`src/README.md`")
            text = text.replace(f"/{commit}/README.md", f"/{commit}/src/README.md")
            text = text.replace("`tests/main.test.ts`", "`src/main.test.ts`")
            text = text.replace(f"/{commit}/tests/main.test.ts", f"/{commit}/src/main.test.ts")
            capsule.write_text(text, encoding="utf-8")
            result = validate(capsule)
            self.assertTrue(result["ok"], result["errors"])
            self.assertTrue(any("25 list items" in item for item in result["warnings"]))
            self.assertTrue(any("one repository area" in item for item in result["warnings"]))

    def test_rejects_known_mojibake_in_chinese_headings(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            capsule = Path(temp) / "capsule.md"
            text = capsule_text("e" * 40).replace(
                "## 1. 快照、目标与覆盖边界",
                "## 1. 蹇収銆佺洰鏍囦笌覆盖边界",
            )
            capsule.write_text(text, encoding="utf-8")
            result = validate(capsule)
            self.assertFalse(result["ok"])
            self.assertTrue(any("mojibake" in error for error in result["errors"]))

    def test_rejects_inferred_metadata_and_unpinned_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            capsule = Path(temp) / "capsule.md"
            text = capsule_text("b" * 40, extra_frontmatter="author: guessed")
            text = text.replace(f"/blob/{'b' * 40}/src/main.ts", "/blob/main/src/main.ts")
            capsule.write_text(text, encoding="utf-8")
            result = validate(capsule)
            self.assertFalse(result["ok"])
            self.assertTrue(any("forbidden" in error for error in result["errors"]))
            self.assertTrue(any("not pinned" in error for error in result["errors"]))

    def test_checks_clone_head_and_evidence_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            repository = root / "repo"
            repository.mkdir()
            for relative in ("README.md", "src/main.ts", "tests/main.test.ts"):
                path = repository / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(relative, encoding="utf-8")
            capsule = root / "capsule.md"
            capsule.write_text(capsule_text("c" * 40, mode="local-clone"), encoding="utf-8")
            result = validate(capsule, repository)
            self.assertTrue(result["ok"], result["errors"])


if __name__ == "__main__":
    unittest.main()
