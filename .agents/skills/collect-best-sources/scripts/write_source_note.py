#!/usr/bin/env python3
"""Write a minimal, factual Markdown provenance note for an original source."""

from __future__ import annotations

import argparse
import json
import os
from datetime import date
from pathlib import Path


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build_note(args: argparse.Namespace) -> str:
    fields = [
        ("type", f"{args.kind}-source"),
        ("title", args.title),
        ("source_url", args.source_url),
        ("author", args.author),
        ("retrieved_at", args.retrieved_at),
        ("license", args.license),
        ("commit", args.commit),
    ]
    frontmatter = ["---"]
    for key, value in fields:
        if value:
            frontmatter.append(f"{key}: {yaml_string(value)}")
    frontmatter.extend(["---", "", f"# {args.title}", ""])

    body: list[str] = []
    if args.asset:
        if any(char.isspace() for char in args.asset):
            raise ValueError("Use a safe asset filename without whitespace so LLM Wiki can resolve it.")
        body.append(f"![Original source asset]({args.asset})")
    elif args.source_url:
        body.append(f"Original source: {args.source_url}")
    if args.commit:
        body.extend(["", f"Pinned repository commit: `{args.commit}`"])
    return "\n".join(frontmatter + body).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--kind",
        choices=["image", "repository", "web", "document", "data", "other"],
        required=True,
    )
    parser.add_argument("--title", required=True)
    parser.add_argument("--source-url", default="")
    parser.add_argument("--author", default="")
    parser.add_argument("--license", default="unknown")
    parser.add_argument("--commit", default="")
    parser.add_argument("--asset", default="")
    parser.add_argument("--retrieved-at", default=date.today().isoformat())
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temp = output.with_name(f".{output.name}.tmp")
    temp.write_text(build_note(args), encoding="utf-8")
    os.replace(temp, output)
    result = {"ok": True, "output": str(output)}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else str(output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
