#!/usr/bin/env python3
"""Validate a repository-framework-v1 Markdown report and its pinned evidence."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = (
    "type",
    "report_contract",
    "repository",
    "source_url",
    "commit",
    "branch_or_tag",
    "retrieved_at",
    "license",
    "analysis_scope",
    "evidence_mode",
)

REQUIRED_HEADINGS = (
    "## 1. 决策摘要",
    "## 2. 分析快照与证据范围",
    "## 3. 项目实际是什么",
    "## 4. 功能全景与实现状态",
    "## 5. 架构与核心流程",
    "## 6. 模块与关键源码地图",
    "## 7. 配置、构建与使用",
    "## 8. 硬件、变体与资源目录",
    "## 9. 可复用设计与适配建议",
    "## 10. 限制、风险与未知项",
    "## 11. 溯源索引",
    "## 12. 深入查询指南",
)

PLACEHOLDER_RE = re.compile(
    r"(?im)\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b|"
    r"<(?:owner|repo|repository|commit|branch|tag|date|license)>|"
    r"40-character-full-sha",
)


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("Report must begin with YAML frontmatter.")
    end = text.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Frontmatter closing delimiter was not found.")
    fields: dict[str, str] = {}
    for raw_line in text[4:end].splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        if ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        fields[key.strip()] = value.strip().strip("\"'")
    return fields, text[end + 5 :]


def git_value(repository_dir: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repository_dir), *args],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def cited_existing_paths(body: str, repository_dir: Path) -> list[str]:
    existing: set[str] = set()
    for raw in re.findall(r"`([^`\r\n]+)`", body):
        candidate = raw.strip().replace("\\", "/")
        if (
            not candidate
            or candidate.startswith(("/", "http://", "https://"))
            or re.match(r"^[A-Za-z]:/", candidate)
            or any(token in candidate for token in ("*", " ", "->", "=", "$"))
        ):
            continue
        path = repository_dir.joinpath(*candidate.split("/"))
        if path.exists():
            existing.add(candidate)
    return sorted(existing)


def validate(summary: Path, repository_dir: Path | None = None) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    if not summary.is_file():
        return {"ok": False, "errors": [f"Summary file not found: {summary}"], "warnings": []}
    if repository_dir is not None and not repository_dir.is_dir():
        return {
            "ok": False,
            "errors": [f"Repository directory not found: {repository_dir}"],
            "warnings": [],
        }

    text = summary.read_text(encoding="utf-8")
    try:
        fields, body = parse_frontmatter(text)
    except ValueError as exc:
        return {"ok": False, "errors": [str(exc)], "warnings": []}

    for field in REQUIRED_FIELDS:
        if not fields.get(field):
            errors.append(f"Missing frontmatter field: {field}")

    if fields.get("type") != "repository-analysis":
        errors.append('Frontmatter "type" must be "repository-analysis".')
    if fields.get("report_contract") != "repository-framework-v1":
        errors.append('Frontmatter "report_contract" must be "repository-framework-v1".')
    if fields.get("analysis_scope") != "framework":
        errors.append('Frontmatter "analysis_scope" must be "framework".')
    evidence_mode = fields.get("evidence_mode")
    if evidence_mode not in {"remote-api", "local-clone"}:
        errors.append('Frontmatter "evidence_mode" must be "remote-api" or "local-clone".')
    if evidence_mode == "local-clone" and repository_dir is None:
        errors.append('evidence_mode "local-clone" requires --repository-dir.')

    commit = fields.get("commit", "")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", commit):
        errors.append("Frontmatter commit must be a full 40-character SHA.")

    actual_commit = git_value(repository_dir, "rev-parse", "HEAD") if repository_dir else None
    if repository_dir:
        if actual_commit and commit and actual_commit.lower() != commit.lower():
            errors.append(f"Report commit {commit} does not match clone HEAD {actual_commit}.")
        elif actual_commit is None:
            warnings.append("Could not verify clone HEAD with git.")

    for heading in REQUIRED_HEADINGS:
        if heading not in body:
            errors.append(f"Missing required heading: {heading}")

    if len(body.strip()) < 2500:
        errors.append("Report body is too short for a framework-level repository analysis.")
    if PLACEHOLDER_RE.search(text):
        errors.append("Report contains unresolved placeholder text.")

    cited_paths: list[str] = []
    uncited_top_level: list[str] = []
    if repository_dir:
        cited_paths = cited_existing_paths(body, repository_dir)
        top_level = sorted(path.name for path in repository_dir.iterdir() if path.name != ".git")
        cited_top_level = {path.split("/", 1)[0] for path in cited_paths}
        uncited_top_level = [
            name for name in top_level
            if name not in cited_top_level and (repository_dir / name).is_dir()
        ]
        minimum_citations = min(5, max(1, len(top_level)))
        if len(cited_paths) < minimum_citations:
            errors.append(
                f"Only {len(cited_paths)} cited repository paths resolve; expected at least "
                f"{minimum_citations}."
            )
        if uncited_top_level:
            warnings.append(
                "Top-level directories without a directly resolving backtick citation: "
                + ", ".join(uncited_top_level)
            )

    pinned_url_pattern = re.compile(
        rf"https?://[^\s)>]+(?:/blob/|/tree/|/-/blob/|/-/tree/){re.escape(commit)}(?:/|$)",
        flags=re.IGNORECASE,
    ) if commit else None
    pinned_url_count = len(pinned_url_pattern.findall(body)) if pinned_url_pattern else 0
    if evidence_mode == "remote-api" and pinned_url_count < 5:
        errors.append(
            f"Remote evidence mode requires at least 5 stable file/tree URLs pinned to the commit; "
            f"found {pinned_url_count}."
        )
    elif evidence_mode == "local-clone" and pinned_url_count < 2:
        warnings.append("Fewer than two body references are stable URLs pinned to the commit SHA.")

    return {
        "ok": not errors,
        "summary": str(summary),
        "repository_dir": str(repository_dir) if repository_dir else None,
        "evidence_mode": evidence_mode,
        "commit": commit or None,
        "body_characters": len(body),
        "resolved_citations": cited_paths,
        "uncited_top_level_directories": uncited_top_level,
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("summary")
    parser.add_argument("--repository-dir")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = validate(
        Path(args.summary).expanduser().resolve(),
        Path(args.repository_dir).expanduser().resolve() if args.repository_dir else None,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        for error in result.get("errors", []):
            print(f"ERROR: {error}")
        for warning in result.get("warnings", []):
            print(f"WARNING: {warning}")
        print("VALID" if result.get("ok") else "INVALID")
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
