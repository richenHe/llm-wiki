#!/usr/bin/env python3
"""Validate a repository-framework-v2 framework capsule and its evidence map."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import date
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = (
    "type", "report_contract", "repository", "source_url", "commit",
    "branch_or_tag", "retrieved_at", "license", "analysis_scope",
    "evidence_mode", "tree_inventory", "runtime_verification",
)
FORBIDDEN_INFERRED_FIELDS = {
    "author", "authors", "published_at", "publication_date", "year", "release_date",
}
REQUIRED_HEADINGS = (
    "## 1. 快照、目标与覆盖边界",
    "## 2. 项目定位与责任边界",
    "## 3. 能力与实现状态",
    "## 4. 架构与关键流程",
    "## 5. 模块、配置与使用",
    "## 6. 变体、硬件与大型资源",
    "## 7. 限制、风险、许可证与未知项",
    "## 8. 复用与适配建议",
    "## 9. 证据索引",
    "## 10. 深入查询指南",
)
EVIDENCE_STATUSES = {
    "project-claim", "static-confirmed", "test-confirmed", "runtime-verified",
    "runtime-unverified", "inference", "unknown", "conflict",
}
PLACEHOLDER_RE = re.compile(
    r"(?im)\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b|"
    r"<(?:owner|repo|repository|commit|branch|tag|date|license)>|"
    r"40-character-full-sha",
)
EVIDENCE_LINE_RE = re.compile(
    r"(?m)^-\s+(E\d{3,})\s+\|\s+([a-z-]+)\s+\|\s+`([^`\r\n]+)`\s+\|"
    r"\s+\[[^\]\r\n]+\]\((https?://[^\s<>\r\n]+)\)\s+\|\s+(.+?)\s*$"
)
CORE_EVIDENCE_HEADINGS = REQUIRED_HEADINGS[1:8]
MOJIBAKE_MARKERS = ("蹇収", "銆佺洰", "椤圭洰瀹", "鑳藉姏涓", "鏋舵瀯涓")


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    normalized = text.replace("\r\n", "\n")
    if not normalized.startswith("---\n"):
        raise ValueError("Capsule must begin with YAML frontmatter.")
    end = normalized.find("\n---\n", 4)
    if end < 0:
        raise ValueError("Frontmatter closing delimiter was not found.")
    fields: dict[str, str] = {}
    for raw_line in normalized[4:end].splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#") or ":" not in raw_line:
            continue
        key, value = raw_line.split(":", 1)
        fields[key.strip()] = value.strip().strip("\"'")
    return fields, normalized[end + 5:]


def git_value(repository_dir: Path, *args: str) -> str | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(repository_dir), *args],
            check=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return result.stdout.strip() or None


def section_text(body: str, heading: str) -> str:
    start = body.find(heading)
    if start < 0:
        return ""
    content_start = start + len(heading)
    next_heading = re.search(r"(?m)^##\s+", body[content_start:])
    end = content_start + next_heading.start() if next_heading else len(body)
    return body[content_start:end].strip()


def is_pinned_url(url: str, commit: str) -> bool:
    lowered = url.lower()
    return any(
        marker in lowered
        for marker in (
            f"/blob/{commit}/".lower(),
            f"/tree/{commit}/".lower(),
            f"/-/blob/{commit}/".lower(),
            f"/-/tree/{commit}/".lower(),
        )
    )


def quality_warnings(body: str, evidence_entries: dict[str, dict[str, str]]) -> list[str]:
    warnings: list[str] = []

    for heading in CORE_EVIDENCE_HEADINGS:
        if not re.search(r"\[E\d{3,}\]", section_text(body, heading)):
            warnings.append(
                f"Quality review: core section has no evidence reference: {heading}"
            )

    for heading in REQUIRED_HEADINGS[1:8]:
        section = section_text(body, heading)
        list_items = re.findall(r"(?m)^\s*(?:[-*+]|\d+[.)])\s+\S", section)
        if len(list_items) >= 20:
            warnings.append(
                f"Quality review: section contains {len(list_items)} list items; "
                f"group repeated members and keep only decision-relevant examples: {heading}"
            )

    groups: dict[str, int] = {}
    for item in evidence_entries.values():
        normalized = item["path"].replace("\\", "/").strip("/")
        group = normalized.split("/", 1)[0] if "/" in normalized else "<repository-root>"
        groups[group] = groups.get(group, 0) + 1
    if len(evidence_entries) >= 3 and groups:
        dominant_group, dominant_count = max(groups.items(), key=lambda pair: pair[1])
        if dominant_count == len(evidence_entries):
            warnings.append(
                "Quality review: all evidence items come from one repository area "
                f"({dominant_group}); confirm that the evidence covers every load-bearing module."
            )

    return warnings


def validate(capsule: Path, repository_dir: Path | None = None) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    if not capsule.is_file():
        return {"ok": False, "errors": [f"Capsule file not found: {capsule}"], "warnings": []}
    if repository_dir is not None and not repository_dir.is_dir():
        return {
            "ok": False,
            "errors": [f"Repository directory not found: {repository_dir}"],
            "warnings": [],
        }

    text = capsule.read_text(encoding="utf-8")
    if any(marker in text for marker in MOJIBAKE_MARKERS):
        errors.append("Capsule contains known mojibake in required Chinese headings.")
    try:
        fields, body = parse_frontmatter(text)
    except ValueError as exc:
        return {"ok": False, "errors": [str(exc)], "warnings": []}

    for field in REQUIRED_FIELDS:
        if not fields.get(field):
            errors.append(f"Missing frontmatter field: {field}")
    for field in sorted(FORBIDDEN_INFERRED_FIELDS.intersection(fields)):
        errors.append(
            f'Frontmatter field "{field}" is forbidden; omit unverified repository metadata.'
        )

    if fields.get("type") != "repository-capsule":
        errors.append('Frontmatter "type" must be "repository-capsule".')
    if fields.get("report_contract") != "repository-framework-v2":
        errors.append('Frontmatter "report_contract" must be "repository-framework-v2".')
    if fields.get("analysis_scope") != "framework":
        errors.append('Frontmatter "analysis_scope" must be "framework".')

    evidence_mode = fields.get("evidence_mode")
    if evidence_mode not in {"remote-api", "local-clone"}:
        errors.append('Frontmatter "evidence_mode" must be "remote-api" or "local-clone".')
    if evidence_mode == "local-clone" and repository_dir is None:
        errors.append('evidence_mode "local-clone" requires --repository-dir.')
    if fields.get("tree_inventory") not in {"complete", "truncated", "unknown"}:
        errors.append('Frontmatter "tree_inventory" must be complete, truncated, or unknown.')
    if fields.get("runtime_verification") not in {"not-run", "partial", "verified"}:
        errors.append('Frontmatter "runtime_verification" must be not-run, partial, or verified.')

    commit = fields.get("commit", "")
    if not re.fullmatch(r"[0-9a-fA-F]{40}", commit):
        errors.append("Frontmatter commit must be a full 40-character SHA.")
    try:
        date.fromisoformat(fields.get("retrieved_at", ""))
    except ValueError:
        errors.append("Frontmatter retrieved_at must be an ISO date (YYYY-MM-DD).")
    if not re.fullmatch(r"https?://[^\s/]+/.+/.+/?", fields.get("source_url", "")):
        errors.append("Frontmatter source_url must be a repository URL.")
    if fields.get("repository", "").count("/") != 1:
        errors.append('Frontmatter repository must use "owner/repository" form.')

    actual_commit = git_value(repository_dir, "rev-parse", "HEAD") if repository_dir else None
    if repository_dir:
        if actual_commit and commit and actual_commit.lower() != commit.lower():
            errors.append(f"Capsule commit {commit} does not match clone HEAD {actual_commit}.")
        elif actual_commit is None:
            warnings.append("Could not verify clone HEAD with git.")

    for heading in REQUIRED_HEADINGS:
        section = section_text(body, heading)
        if not section:
            errors.append(f"Missing or empty required heading: {heading}")
        elif len(section) < 40:
            errors.append(f"Section is too thin to establish coverage: {heading}")
    if PLACEHOLDER_RE.search(text):
        errors.append("Capsule contains unresolved placeholder text.")

    evidence_section = section_text(body, "## 9. 证据索引")
    evidence_entries: dict[str, dict[str, str]] = {}
    for match in EVIDENCE_LINE_RE.finditer(evidence_section):
        evidence_id, status, path, url, explanation = match.groups()
        if evidence_id in evidence_entries:
            errors.append(f"Duplicate evidence ID: {evidence_id}")
            continue
        if status not in EVIDENCE_STATUSES:
            errors.append(f"Unsupported evidence status for {evidence_id}: {status}")
        if any(part == ".." for part in path.replace("\\", "/").split("/")):
            errors.append(f"Unsafe repository-relative evidence path for {evidence_id}: {path}")
        if any(char in url for char in (" ", "(", ")")):
            errors.append(f"Evidence URL for {evidence_id} has an unencoded space or parenthesis.")
        if evidence_mode == "remote-api" and commit and not is_pinned_url(url, commit):
            errors.append(f"Evidence URL for {evidence_id} is not pinned to commit {commit}.")
        if evidence_mode == "local-clone" and repository_dir:
            candidate = repository_dir.joinpath(*path.replace("\\", "/").split("/"))
            if not candidate.exists():
                errors.append(f"Evidence path for {evidence_id} does not exist in clone: {path}")
        evidence_entries[evidence_id] = {
            "status": status, "path": path, "url": url, "explanation": explanation,
        }

    if len(evidence_entries) < 3:
        errors.append("Evidence index must contain at least three parseable evidence items.")
    body_without_index = body.split("## 9. 证据索引", 1)[0]
    used_ids = set(re.findall(r"\[(E\d{3,})\]", body_without_index))
    unknown_ids = sorted(used_ids.difference(evidence_entries))
    if unknown_ids:
        errors.append("Body references undefined evidence IDs: " + ", ".join(unknown_ids))
    if len(used_ids.intersection(evidence_entries)) < min(3, len(evidence_entries)):
        errors.append("Important body claims must reference at least three evidence IDs.")
    if "[E" not in section_text(body, "## 3. 能力与实现状态"):
        errors.append("Capability status section must cite evidence IDs.")
    warnings.extend(quality_warnings(body, evidence_entries))

    return {
        "ok": not errors,
        "capsule": str(capsule),
        "repository_dir": str(repository_dir) if repository_dir else None,
        "report_contract": fields.get("report_contract"),
        "evidence_mode": evidence_mode,
        "commit": commit or None,
        "tree_inventory": fields.get("tree_inventory"),
        "runtime_verification": fields.get("runtime_verification"),
        "body_characters": len(body),
        "evidence_count": len(evidence_entries),
        "used_evidence_ids": sorted(used_ids),
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("capsule")
    parser.add_argument("--repository-dir")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = validate(
        Path(args.capsule).expanduser().resolve(),
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
