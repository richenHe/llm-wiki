from __future__ import annotations

import concurrent.futures
import csv
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from PIL import Image
from pypdf import PdfReader
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(r"D:\video")
STAGE = ROOT / "package" / ".staging" / "official-page-images-20260803"
SMARTEDU_JSON_DIR = Path(r"C:\tmp")
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138 Safari/537.36"
HOSTS = ("r1-ndr.ykt.cbern.com.cn", "r2-ndr.ykt.cbern.com.cn", "r3-ndr.ykt.cbern.com.cn")

BOOKS = [
    # 数学（北京师范大学出版社）
    ("数学", "数学_七年级上册_北师大版_官方页图合成.pdf", "8376191d-2d32-4c68-aba9-2f6c9dbfdf4a"),
    ("数学", "数学_七年级下册_北师大版_官方页图合成.pdf", "547e13ff-e4c3-4542-b793-2c43dedb77c5"),
    ("数学", "数学_八年级上册_北师大版_官方页图合成.pdf", "85ac3198-7050-441c-a614-493ea53e8d4a"),
    ("数学", "数学_八年级下册_北师大版_官方页图合成.pdf", "146b5d39-425a-46ee-a645-f62f4a61e1c1"),
    ("数学", "数学_九年级上册_北师大版_官方页图合成.pdf", "4f797247-0ec5-4a00-9ad5-9942d4ff32c6"),
    ("数学", "数学_九年级下册_北师大版_官方页图合成.pdf", "fafe7c85-616a-4932-94d3-d6287b346e6b"),
    # 英语（上海教育出版社，深圳/广州用沪教牛津版）
    ("英语", "英语_七年级上册_沪教版_官方页图合成.pdf", "dcba2daf-0832-7ef4-2490-ceb47ff8fa2a"),
    ("英语", "英语_七年级下册_沪教版_官方页图合成.pdf", "65a59980-6e5c-7f76-82e8-ab16222baafb"),
    ("英语", "英语_八年级上册_沪教版_官方页图合成.pdf", "01fb75fc-776a-43cc-a974-b03d61679125"),
    ("英语", "英语_八年级下册_沪教版_官方页图合成.pdf", "d9587713-66bd-4f85-806f-cc2fa5619cd3"),
    ("英语", "英语_九年级上册_沪教版_官方页图合成.pdf", "b1a19b7a-5a7f-4d0e-9f9d-b5e59dafc979"),
    ("英语", "英语_九年级下册_沪教版_官方页图合成.pdf", "8a9962e7-f8e6-4f5f-8e2a-df9bf874bf0c"),
    # 地理（湖南教育出版社）
    ("地理", "地理_七年级上册_湘教版_官方页图合成.pdf", "d12dd595-2e94-4f79-a0f3-443bef0285fc"),
    ("地理", "地理_七年级下册_湘教版_官方页图合成.pdf", "1b4deb32-19c1-4b39-b132-caaf343710e5"),
    ("地理", "地理_八年级上册_湘教版_官方页图合成.pdf", "8149a882-4108-4888-892a-e1d0ce64d770"),
    ("地理", "地理_八年级下册_湘教版_官方页图合成.pdf", "661e0653-99ef-4673-b512-a6625fed5ea6"),
]


def load_metadata() -> dict[str, dict]:
    targets = {book_id for _, _, book_id in BOOKS}
    found: dict[str, dict] = {}
    for path in sorted(SMARTEDU_JSON_DIR.glob("smartedu-part-*.json")):
        with path.open("r", encoding="utf-8") as f:
            for item in json.load(f):
                if item.get("id") in targets:
                    found[item["id"]] = item
    missing = targets - found.keys()
    if missing:
        raise RuntimeError(f"Missing Smart Education metadata: {sorted(missing)}")
    return found


def page_base(metadata: dict) -> str:
    preview = metadata.get("custom_properties", {}).get("preview", {})
    urls = [value for value in preview.values() if isinstance(value, str) and "/transcode/image/" in value]
    if not urls:
        raise RuntimeError(f"No official preview URL for {metadata.get('id')}")
    parts = urlsplit(urls[0])
    path = re.sub(r"/\d+\.jpg(?:$|\?.*)", "", parts.path)
    return urlunsplit(("https", HOSTS[0], path, "", ""))


def candidate_urls(base: str, page: int):
    parts = urlsplit(base)
    for host in HOSTS:
        yield urlunsplit((parts.scheme, host, f"{parts.path}/{page}.jpg", "", ""))


def probe_page(base: str, page: int) -> bool:
    missing_codes = []
    other_errors = []
    for url in candidate_urls(base, page):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Range": "bytes=0-15"})
        try:
            with urllib.request.urlopen(req, timeout=25) as response:
                data = response.read(16)
                if response.status in (200, 206) and data[:2] == b"\xff\xd8":
                    return True
                other_errors.append(f"{response.status}:{data[:8]!r}")
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404):
                missing_codes.append(exc.code)
            else:
                other_errors.append(f"HTTP {exc.code}")
        except Exception as exc:  # transient network failure
            other_errors.append(repr(exc))
    if len(missing_codes) == len(HOSTS):
        return False
    if other_errors:
        raise RuntimeError(f"Unable to probe page {page}: {other_errors}")
    return False


def find_page_count(base: str) -> int:
    low, high = 1, 64
    if not probe_page(base, low):
        raise RuntimeError("Page 1 is unavailable")
    while probe_page(base, high):
        low, high = high, high * 2
        if high > 1024:
            raise RuntimeError("Unexpectedly more than 1024 pages")
    while low + 1 < high:
        mid = (low + high) // 2
        if probe_page(base, mid):
            low = mid
        else:
            high = mid
    return low


def verify_jpeg(path: Path) -> None:
    if path.stat().st_size < 10_000:
        raise RuntimeError(f"Image too small: {path}")
    with Image.open(path) as img:
        img.verify()
    with Image.open(path) as img:
        if img.format != "JPEG" or img.width < 500 or img.height < 500:
            raise RuntimeError(f"Unexpected image: {path}, {img.format}, {img.size}")


def download_page(base: str, page: int, destination: Path) -> None:
    if destination.exists():
        try:
            verify_jpeg(destination)
            return
        except Exception:
            destination.unlink()
    errors = []
    for attempt in range(5):
        for url in candidate_urls(base, page):
            partial = destination.with_suffix(".jpg.part")
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            try:
                with urllib.request.urlopen(req, timeout=90) as response, partial.open("wb") as out:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        out.write(chunk)
                verify_jpeg(partial)
                os.replace(partial, destination)
                return
            except Exception as exc:
                errors.append(f"{url}: {exc!r}")
                if partial.exists():
                    partial.unlink()
        time.sleep(min(8, 2 ** attempt))
    raise RuntimeError(f"Failed page {page}: {errors[-6:]}")


def make_pdf(image_dir: Path, page_count: int, output_path: Path, title: str) -> None:
    temp_pdf = output_path.with_suffix(".pdf.part")
    if temp_pdf.exists():
        temp_pdf.unlink()
    first_path = image_dir / "0001.jpg"
    with Image.open(first_path) as first:
        first_size = first.size
    pdf = canvas.Canvas(str(temp_pdf), pagesize=first_size, pageCompression=0)
    pdf.setTitle(title)
    pdf.setAuthor("国家中小学智慧教育平台官方页图")
    pdf.setSubject("由国家平台公开教材页图按原页序无损合成")
    for page in range(1, page_count + 1):
        path = image_dir / f"{page:04d}.jpg"
        with Image.open(path) as img:
            width, height = img.size
        pdf.setPageSize((width, height))
        pdf.drawImage(ImageReader(str(path)), 0, 0, width=width, height=height, preserveAspectRatio=True)
        pdf.showPage()
    pdf.save()
    reader = PdfReader(str(temp_pdf))
    if len(reader.pages) != page_count:
        raise RuntimeError(f"PDF page mismatch: {len(reader.pages)} != {page_count}")
    os.replace(temp_pdf, output_path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    STAGE.mkdir(parents=True, exist_ok=True)
    metadata_by_id = load_metadata()
    records = []
    for index, (subject, filename, book_id) in enumerate(BOOKS, 1):
        metadata = metadata_by_id[book_id]
        title = metadata.get("global_title", {}).get("zh-CN") or metadata.get("title") or filename
        base = page_base(metadata)
        subject_dir = ROOT / subject
        subject_dir.mkdir(parents=True, exist_ok=True)
        output_path = subject_dir / filename
        image_dir = STAGE / subject / book_id
        image_dir.mkdir(parents=True, exist_ok=True)
        state_path = image_dir / "state.json"

        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
            page_count = int(state["page_count"])
        else:
            page_count = find_page_count(base)
            state_path.write_text(json.dumps({"page_count": page_count, "base": base}, ensure_ascii=False, indent=2), encoding="utf-8")

        if output_path.exists():
            try:
                if len(PdfReader(str(output_path)).pages) == page_count:
                    print(f"[{index}/{len(BOOKS)}] EXISTS {subject} {filename} pages={page_count}", flush=True)
                    records.append((subject, filename, book_id, title, page_count, output_path.stat().st_size, sha256(output_path), base))
                    continue
            except Exception:
                output_path.unlink()

        missing_pages = []
        for page in range(1, page_count + 1):
            path = image_dir / f"{page:04d}.jpg"
            try:
                verify_jpeg(path)
            except Exception:
                missing_pages.append(page)
        print(f"[{index}/{len(BOOKS)}] DOWNLOAD {subject} {filename} pages={page_count} missing={len(missing_pages)}", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            futures = {pool.submit(download_page, base, page, image_dir / f"{page:04d}.jpg"): page for page in missing_pages}
            completed = 0
            for future in concurrent.futures.as_completed(futures):
                future.result()
                completed += 1
                if completed % 25 == 0 or completed == len(missing_pages):
                    print(f"  pages {completed}/{len(missing_pages)}", flush=True)

        print(f"[{index}/{len(BOOKS)}] BUILD {filename}", flush=True)
        make_pdf(image_dir, page_count, output_path, title)
        records.append((subject, filename, book_id, title, page_count, output_path.stat().st_size, sha256(output_path), base))
        print(f"[{index}/{len(BOOKS)}] OK {output_path} bytes={output_path.stat().st_size}", flush=True)

    manifest = ROOT / "官方页图合成教材清单.csv"
    with manifest.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(("科目", "文件名", "国家平台内容ID", "官方标题", "页数", "字节数", "SHA256", "官方页图地址模板", "官方详情页"))
        for row in records:
            detail = f"https://basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId={row[2]}&catalogType=tchMaterial&subCatalog=dzjc"
            writer.writerow((*row, detail))
    print(f"COMPLETE books={len(records)} manifest={manifest}", flush=True)


if __name__ == "__main__":
    main()
