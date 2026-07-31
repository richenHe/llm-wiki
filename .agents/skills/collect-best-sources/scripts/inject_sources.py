#!/usr/bin/env python3
"""Inject an original source file/tree into the active LLM Wiki project."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Iterable


class InjectError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def request_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, method="GET", headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise InjectError("clip_server_error", f"LLM Wiki returned HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise InjectError("clip_server_unavailable", f"LLM Wiki is unavailable: {exc}") from exc


def safe_name(value: str, fallback: str) -> str:
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "-", value)
    value = re.sub(r"\s+", "-", value.strip())
    value = re.sub(r"-{2,}", "-", value).strip(".-")
    return value[:120] or fallback


def iter_files(source: Path) -> Iterable[tuple[Path, str]]:
    if source.is_file():
        yield source, source.name
        return
    for root, dirs, files in os.walk(source, followlinks=False):
        dirs[:] = sorted(
            name
            for name in dirs
            if name != ".git" and not (Path(root) / name).is_symlink()
        )
        for name in sorted(files):
            path = Path(root) / name
            if not path.is_symlink():
                yield path, path.relative_to(source).as_posix()


def content_digest(source: Path) -> str:
    digest = hashlib.sha256()
    if source.is_file():
        digest.update(b"FILE\0")
        with source.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    for path, relative in iter_files(source):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def copy_source(source: Path, destination: Path) -> list[str]:
    skipped_symlinks: list[str] = []
    if source.is_file():
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        return skipped_symlinks

    destination.mkdir(parents=True, exist_ok=False)
    for root, dirs, files in os.walk(source, followlinks=False):
        root_path = Path(root)
        kept_dirs: list[str] = []
        for name in sorted(dirs):
            child = root_path / name
            relative = child.relative_to(source).as_posix()
            if name == ".git":
                continue
            if child.is_symlink():
                skipped_symlinks.append(relative)
                continue
            kept_dirs.append(name)
            (destination / relative).mkdir(parents=True, exist_ok=True)
        dirs[:] = kept_dirs
        for name in sorted(files):
            child = root_path / name
            relative = child.relative_to(source).as_posix()
            if child.is_symlink():
                skipped_symlinks.append(relative)
                continue
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(child, target)
    return skipped_symlinks


def ensure_cleanup_target(source: Path, temporary_root: Path, project: Path) -> None:
    source = source.resolve()
    temporary_root = temporary_root.resolve()
    project = project.resolve()
    if source == temporary_root or temporary_root not in source.parents:
        raise InjectError("unsafe_cleanup_target", "Cleanup source must be strictly below --temporary-root.")
    if source == project or project in source.parents or source in project.parents:
        raise InjectError("unsafe_cleanup_target", "Cleanup source must not overlap the active LLM Wiki project.")
    if temporary_root.parent == temporary_root:
        raise InjectError("unsafe_cleanup_root", "A drive/filesystem root cannot be used as --temporary-root.")


def remove_tree_with_readonly_retry(path: Path) -> None:
    """Remove a verified temporary tree, retrying Windows read-only Git files."""

    def clear_readonly_and_retry(function: Any, failed_path: str, _error: Any) -> None:
        os.chmod(failed_path, stat.S_IWRITE | stat.S_IREAD)
        function(failed_path)

    shutil.rmtree(path, onerror=clear_readonly_and_retry)


def inject(args: argparse.Namespace) -> dict[str, Any]:
    source = Path(args.source).expanduser().resolve()
    if not source.exists() or source.is_symlink():
        raise InjectError("source_missing", f"Source not found or is a symlink: {source}")

    current = request_json(f"{args.clip_url.rstrip('/')}/project")
    project_value = str(current.get("path") or "")
    if not project_value:
        raise InjectError("no_current_project", "Open the target project in LLM Wiki first.")
    project = Path(project_value).resolve()
    if project == source or project in source.parents or source in project.parents:
        raise InjectError("source_project_overlap", "Source and target LLM Wiki project must not overlap.")

    digest = content_digest(source)
    topic = safe_name(args.topic, "collected")
    source_name = safe_name(args.name or source.name, "source")
    root = project / "raw" / "sources" / "collected" / topic
    destination = root / source_name
    if destination.exists():
        if content_digest(destination) == digest:
            skipped_existing = True
        else:
            destination = root / f"{source_name}-{digest[:10]}"
            skipped_existing = destination.exists() and content_digest(destination) == digest
    else:
        skipped_existing = False

    skipped_symlinks: list[str] = []
    if not skipped_existing:
        root.mkdir(parents=True, exist_ok=True)
        staging_root = root / ".cache"
        staging_root.mkdir(parents=True, exist_ok=True)
        temporary_destination = staging_root / f"{destination.name}.tmp-{uuid.uuid4().hex}"
        try:
            skipped_symlinks = copy_source(source, temporary_destination)
            if content_digest(temporary_destination) != digest:
                raise InjectError("copy_verification_failed", "Injected copy hash does not match the staged source.")
            os.replace(temporary_destination, destination)
        except Exception:
            if temporary_destination.exists():
                if temporary_destination.is_dir():
                    shutil.rmtree(temporary_destination)
                else:
                    temporary_destination.unlink()
            raise
        finally:
            try:
                staging_root.rmdir()
            except OSError:
                pass

    if not destination.exists() or content_digest(destination) != digest:
        raise InjectError("destination_verification_failed", "Destination verification failed after injection.")

    cleaned_source = False
    cleaned_job_root = False
    cleanup_error: str | None = None
    if args.cleanup_source and args.cleanup_job_root:
        raise InjectError(
            "conflicting_cleanup_modes",
            "Use either --cleanup-source or --cleanup-job-root, not both.",
        )
    if args.cleanup_job_root:
        if not args.temporary_root:
            raise InjectError("temporary_root_required", "--cleanup-job-root requires --temporary-root.")
        job_root = Path(args.cleanup_job_root).expanduser().resolve()
        ensure_cleanup_target(job_root, Path(args.temporary_root), project)
        if job_root not in source.parents:
            raise InjectError(
                "unsafe_cleanup_target",
                "Injected source must be strictly below --cleanup-job-root.",
            )
        try:
            remove_tree_with_readonly_retry(job_root)
            cleaned_job_root = not job_root.exists()
            if not cleaned_job_root:
                cleanup_error = "Temporary job root still exists after cleanup."
        except OSError as exc:
            cleanup_error = str(exc)
    elif args.cleanup_source:
        if not args.temporary_root:
            raise InjectError("temporary_root_required", "--cleanup-source requires --temporary-root.")
        ensure_cleanup_target(source, Path(args.temporary_root), project)
        try:
            if source.is_dir():
                remove_tree_with_readonly_retry(source)
            else:
                source.unlink()
            cleaned_source = not source.exists()
            if not cleaned_source:
                cleanup_error = "Temporary source still exists after cleanup."
        except OSError as exc:
            cleanup_error = str(exc)

    return {
        "ok": True,
        "project_path": str(project),
        "destination": str(destination),
        "sha256": digest,
        "skipped_existing": skipped_existing,
        "cleaned_source": cleaned_source,
        "cleaned_job_root": cleaned_job_root,
        "cleanup_error": cleanup_error,
        "skipped_symlinks": skipped_symlinks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("--topic", required=True)
    parser.add_argument("--name")
    parser.add_argument("--temporary-root")
    parser.add_argument("--cleanup-source", action="store_true")
    parser.add_argument(
        "--cleanup-job-root",
        help="Delete this bounded staging job after verified injection; source must be below it.",
    )
    parser.add_argument(
        "--clip-url",
        default=os.environ.get("LLM_WIKI_CLIP_URL", "http://127.0.0.1:19827"),
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    try:
        result = inject(args)
    except InjectError as exc:
        result = {"ok": False, "error": exc.code, "message": exc.message}
    except Exception as exc:
        result = {"ok": False, "error": "unexpected_error", "message": str(exc)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
