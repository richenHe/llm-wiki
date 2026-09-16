from __future__ import annotations

import csv
import hashlib
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(r"D:\video")
MAIN_SUBJECTS = (
    "语文",
    "数学",
    "英语",
    "道德与法治",
    "物理",
    "化学",
    "生物",
    "历史",
    "地理",
)
DIRECT_MANIFEST = ROOT / "教材下载清单.csv"
COMPOSITE_MANIFEST = ROOT / "官方页图合成教材清单.csv"
OUTPUT_MANIFEST = ROOT / "主科教材完整清单.csv"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest().upper()


def load_direct() -> dict[tuple[str, str], dict[str, str]]:
    result: dict[tuple[str, str], dict[str, str]] = {}
    with DIRECT_MANIFEST.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            subject = row["Subject"]
            if subject in MAIN_SUBJECTS:
                result[(subject, row["File"])] = row
    return result


def load_composites() -> dict[tuple[str, str], dict[str, str]]:
    result: dict[tuple[str, str], dict[str, str]] = {}
    with COMPOSITE_MANIFEST.open("r", encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            result[(row["科目"], row["文件名"])] = row
    return result


def main() -> None:
    direct = load_direct()
    composites = load_composites()
    rows: list[dict[str, str | int]] = []
    errors: list[str] = []

    for subject in MAIN_SUBJECTS:
        folder = ROOT / subject
        if not folder.is_dir():
            errors.append(f"缺少科目目录：{folder}")
            continue
        for path in sorted(folder.glob("*.pdf"), key=lambda item: item.name):
            with path.open("rb") as stream:
                if stream.read(5) != b"%PDF-":
                    errors.append(f"文件头不是 PDF：{path}")
                    continue
            try:
                pages = len(PdfReader(str(path)).pages)
            except Exception as exc:
                errors.append(f"无法解析 PDF：{path}：{exc}")
                continue
            if pages <= 0:
                errors.append(f"PDF 页数为零：{path}")
                continue

            key = (subject, path.name)
            actual_hash = sha256(path)
            if key in direct:
                source = direct[key]
                expected_hash = source["SHA256"].upper()
                if actual_hash != expected_hash:
                    errors.append(f"SHA256 不匹配：{path}")
                kind = "官方原始PDF"
                source_name = source["Source"]
                source_page = source["SourcePage"]
                source_file = source["DownloadUrl"]
            elif key in composites:
                source = composites[key]
                expected_hash = source["SHA256"].upper()
                if actual_hash != expected_hash:
                    errors.append(f"SHA256 不匹配：{path}")
                expected_pages = int(source["页数"])
                if pages != expected_pages:
                    errors.append(
                        f"页数不匹配：{path}，实际 {pages}，应为 {expected_pages}"
                    )
                kind = "国家平台官方页图合成PDF（图像型）"
                source_name = "国家中小学智慧教育平台"
                source_page = source["官方详情页"]
                source_file = source["官方页图地址模板"]
            else:
                errors.append(f"清单中没有此文件：{path}")
                continue

            rows.append(
                {
                    "科目": subject,
                    "文件名": path.name,
                    "PDF类型": kind,
                    "页数": pages,
                    "字节数": path.stat().st_size,
                    "SHA256": actual_hash,
                    "官方来源": source_name,
                    "官方说明页": source_page,
                    "官方文件或页图地址": source_file,
                    "本地路径": str(path),
                    "校验结果": "通过",
                }
            )

    if len(rows) != 43:
        errors.append(f"主科 PDF 数量不是 43，本次找到 {len(rows)} 本")
    if errors:
        raise SystemExit("\n".join(errors))

    with OUTPUT_MANIFEST.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)

    print(f"VALID books={len(rows)} manifest={OUTPUT_MANIFEST}")
    for subject in MAIN_SUBJECTS:
        count = sum(row["科目"] == subject for row in rows)
        print(f"{subject}: {count}")


if __name__ == "__main__":
    main()
