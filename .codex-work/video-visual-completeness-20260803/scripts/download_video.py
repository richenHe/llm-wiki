#!/usr/bin/env python3
"""Download public YouTube, Douyin, or Bilibili videos without cookies."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable


UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)
SUPPORTED_URL_RE = re.compile(
    r"https?://(?:"
    r"(?:www\.)?douyin\.com/[^\s<>\"']+|"
    r"v\.douyin\.com/[^\s<>\"']+|"
    r"(?:www\.)?bilibili\.com/[^\s<>\"']+|"
    r"b23\.tv/[^\s<>\"']+|"
    r"(?:(?:www|m|music)\.)?youtube\.com/[^\s<>\"']+|"
    r"youtu\.be/[^\s<>\"']+"
    r")",
    re.IGNORECASE,
)
INVALID_FS_CHARS = re.compile(r'[\\/:*?"<>|\x00-\x1f]')
ProgressCallback = Callable[[str, int, int], None]
_progress_callback: ProgressCallback | None = None


def set_progress_callback(callback: ProgressCallback | None) -> None:
    """Expose byte progress to callers without mixing it into JSON stdout."""
    global _progress_callback
    _progress_callback = callback


def report_progress(label: str, downloaded: int, total: int = 0) -> None:
    if _progress_callback is not None:
        _progress_callback(label, max(0, downloaded), max(0, total))


class DownloadError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def log(message: str, quiet: bool = False) -> None:
    if not quiet:
        print(message, file=sys.stderr, flush=True)


def safe_filename(value: str, max_len: int = 120) -> str:
    value = INVALID_FS_CHARS.sub("_", value or "").strip().strip(".")
    value = re.sub(r"\s+", " ", value)
    value = value[:max_len].rstrip(" .")
    return value or "video"


def extract_url(text: str) -> str:
    match = SUPPORTED_URL_RE.search(text)
    if not match:
        raise DownloadError(
            "no_supported_url",
            "No Douyin or Bilibili URL was found in the supplied text.",
        )
    return match.group(0).rstrip("，。！？、；：,!?;:)]}")


def http_request(
    url: str,
    *,
    referer: str | None = None,
    range_value: str | None = None,
    timeout: int = 30,
) -> urllib.request.Request:
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    if range_value:
        headers["Range"] = range_value
    return urllib.request.Request(url, headers=headers)


def read_json(url: str, *, referer: str | None = None) -> dict[str, Any]:
    request = http_request(url, referer=referer)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        raise DownloadError("network_or_api_error", f"Failed to read platform API: {exc}") from exc


def resolve_redirect(url: str) -> str:
    request = http_request(url)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.geturl()
    except urllib.error.URLError as exc:
        raise DownloadError("short_link_resolution_failed", str(exc)) from exc


def stream_download(
    url: str,
    destination: Path,
    *,
    referer: str,
    quiet: bool,
) -> int:
    request = http_request(url, referer=referer)
    destination.parent.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    try:
        with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
            total = int(response.headers.get("Content-Length") or 0)
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                downloaded += len(chunk)
                report_progress(destination.name, downloaded, total)
                if total:
                    log(
                        f"Downloading {destination.name}: "
                        f"{downloaded / 1048576:.1f}/{total / 1048576:.1f} MiB",
                        quiet,
                    )
    except urllib.error.URLError as exc:
        destination.unlink(missing_ok=True)
        raise DownloadError("media_download_failed", f"{url}: {exc}") from exc
    if downloaded == 0:
        destination.unlink(missing_ok=True)
        raise DownloadError("empty_media", "The media server returned an empty file.")
    return downloaded


def find_executable(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    app_data = os.environ.get("APPDATA")
    if name == "opencli" and app_data:
        for candidate in (
            Path(app_data) / "npm" / "opencli.cmd",
            Path(app_data) / "npm" / "opencli.exe",
            Path(app_data) / "npm" / "opencli",
        ):
            try:
                if candidate.is_file():
                    return str(candidate)
            except OSError:
                continue
        package_entries = [
            Path(app_data)
            / "npm"
            / "node_modules"
            / "@jackwener"
            / "opencli"
            / "dist"
            / "src"
            / "main.js"
        ]
        user_profile = os.environ.get("USERPROFILE")
        if user_profile:
            package_entries.append(
                Path(user_profile)
                / ".opencli"
                / "node_modules"
                / "@jackwener"
                / "opencli"
                / "dist"
                / "src"
                / "main.js"
            )
        bridge = Path(__file__).with_name("opencli_bridge.cmd")
        try:
            if bridge.is_file() and any(entry.is_file() for entry in package_entries):
                return str(bridge)
        except OSError:
            pass
    local_app_data = os.environ.get("LOCALAPPDATA")
    if name in {"ffmpeg", "ffprobe"} and local_app_data:
        base = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages"
        matches = sorted(base.glob(f"**/{name}.exe"), reverse=True)
        if matches:
            return str(matches[0])
    return None


def yt_dlp_command() -> list[str]:
    executable = find_executable("yt-dlp")
    if executable:
        return [executable]
    try:
        import yt_dlp  # noqa: F401
    except ImportError as exc:
        raise DownloadError(
            "yt_dlp_missing",
            "Run scripts/bootstrap.ps1 once to install the skill-local YouTube runtime.",
        ) from exc
    return [sys.executable, "-m", "yt_dlp"]


def yt_dlp_common_args() -> list[str]:
    args = ["--no-playlist", "--no-warnings"]
    if find_executable("node"):
        args.extend(["--js-runtimes", "node"])
    return args


def find_browser(explicit: str | None = None) -> str:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    local_app_data = os.environ.get("LOCALAPPDATA")
    program_files = os.environ.get("PROGRAMFILES")
    program_files_x86 = os.environ.get("PROGRAMFILES(X86)")
    if local_app_data:
        local = Path(local_app_data)
        candidates.extend(sorted(
            (local / "ms-playwright").glob("chromium-*/chrome-win64/chrome.exe"),
            reverse=True,
        ))
        candidates.append(local / "Google/Chrome/Application/chrome.exe")
    if program_files:
        pf = Path(program_files)
        candidates.extend([
            pf / "Google/Chrome/Application/chrome.exe",
            pf / "Microsoft/Edge/Application/msedge.exe",
        ])
    if program_files_x86:
        pfx = Path(program_files_x86)
        candidates.extend([
            pfx / "Google/Chrome/Application/chrome.exe",
            pfx / "Microsoft/Edge/Application/msedge.exe",
        ])
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise DownloadError(
        "browser_missing",
        "No installed Chromium, Chrome, or Edge browser executable was found.",
    )


def ffprobe_media(path: Path, *, require_video: bool = True) -> dict[str, Any]:
    ffprobe = find_executable("ffprobe")
    if not ffprobe:
        raise DownloadError("ffprobe_missing", "FFprobe is required to verify the downloaded file.")
    command = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration,size,format_name:stream=codec_name,codec_type,width,height,r_frame_rate",
        "-of",
        "json",
        str(path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
    if completed.returncode:
        raise DownloadError("verification_failed", completed.stderr.strip() or "FFprobe failed.")
    data = json.loads(completed.stdout)
    streams = data.get("streams") or []
    if require_video and not any(item.get("codec_type") == "video" for item in streams):
        raise DownloadError("verification_failed", "The output contains no video stream.")
    return data


def require_media_streams(
    probe: dict[str, Any],
    *,
    video: bool = True,
    audio: bool = False,
) -> None:
    stream_types = {
        str(item.get("codec_type") or "")
        for item in probe.get("streams") or []
    }
    if video and "video" not in stream_types:
        raise DownloadError("missing_video_stream", "The downloaded file contains no video stream.")
    if audio and "audio" not in stream_types:
        raise DownloadError(
            "missing_audio_stream",
            "The downloaded file contains video but no usable audio stream.",
        )


def media_duration(probe: dict[str, Any]) -> float:
    return float((probe.get("format") or {}).get("duration") or 0)


def merge_audio_video(
    video_path: Path,
    audio_path: Path,
    destination: Path,
) -> None:
    video_probe = ffprobe_media(video_path)
    audio_probe = ffprobe_media(audio_path, require_video=False)
    require_media_streams(video_probe, video=True)
    require_media_streams(audio_probe, video=False, audio=True)
    video_duration = media_duration(video_probe)
    audio_duration = media_duration(audio_probe)
    if video_duration > 0 and audio_duration > 0:
        tolerance = max(3.0, video_duration * 0.05)
        if abs(video_duration - audio_duration) > tolerance:
            raise DownloadError(
                "media_duration_mismatch",
                "The selected video and audio streams have different durations and cannot be safely merged.",
            )

    ffmpeg = find_executable("ffmpeg")
    if not ffmpeg:
        raise DownloadError("ffmpeg_missing", "FFmpeg is required to merge video and audio streams.")
    merged = destination.with_name(f".{destination.stem}.merged{destination.suffix}")
    merged.unlink(missing_ok=True)
    try:
        command = [
            ffmpeg,
            "-y",
            "-i",
            str(video_path),
            "-i",
            str(audio_path),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(merged),
        ]
        completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
        if completed.returncode:
            raise DownloadError("ffmpeg_merge_failed", completed.stderr[-2000:])
        merged_probe = ffprobe_media(merged)
        require_media_streams(merged_probe, video=True, audio=True)
        merged.replace(destination)
    finally:
        merged.unlink(missing_ok=True)


def media_summary(probe: dict[str, Any]) -> dict[str, Any]:
    streams = probe.get("streams") or []
    video = next((item for item in streams if item.get("codec_type") == "video"), {})
    audio = next((item for item in streams if item.get("codec_type") == "audio"), {})
    fmt = probe.get("format") or {}
    return {
        "duration": float(fmt.get("duration") or 0),
        "size": int(fmt.get("size") or 0),
        "width": video.get("width"),
        "height": video.get("height"),
        "fps": video.get("r_frame_rate"),
        "video_codec": video.get("codec_name"),
        "audio_codec": audio.get("codec_name"),
    }


def output_result(
    *,
    platform: str,
    title: str,
    author: str,
    identifier: str,
    file_path: Path,
    source_url: str,
    skipped: bool = False,
) -> dict[str, Any]:
    probe = ffprobe_media(file_path)
    return {
        "ok": True,
        "platform": platform,
        "title": title,
        "author": author,
        "id": identifier,
        "file": str(file_path.resolve()),
        "source_url": source_url,
        "skipped_existing": skipped,
        "media": media_summary(probe),
    }


def bilibili_info(url: str) -> dict[str, Any]:
    resolved = resolve_redirect(url) if "b23.tv" in urllib.parse.urlparse(url).netloc else url
    match = re.search(r"(BV[0-9A-Za-z]{10})", resolved)
    if not match:
        raise DownloadError("invalid_bilibili_url", "No BV identifier was found in the URL.")
    bvid = match.group(1)
    view_url = "https://api.bilibili.com/x/web-interface/view?" + urllib.parse.urlencode({"bvid": bvid})
    view = read_json(view_url, referer="https://www.bilibili.com/")
    if view.get("code") != 0:
        raise DownloadError("bilibili_view_error", view.get("message") or str(view.get("code")))
    data = view["data"]
    pages = data.get("pages") or []
    if not pages:
        raise DownloadError("no_public_stream", "The video has no publicly visible page.")
    parsed = urllib.parse.urlparse(resolved)
    try:
        requested_page = int((urllib.parse.parse_qs(parsed.query).get("p") or ["1"])[0] or 1)
    except ValueError:
        requested_page = 1
    requested_page = min(max(1, requested_page), len(pages))
    first_page = pages[requested_page - 1]
    resolved_url = f"https://www.bilibili.com/video/{bvid}"
    if len(pages) > 1:
        resolved_url += "?" + urllib.parse.urlencode({"p": requested_page})
    return {
        "resolved_url": resolved_url,
        "bvid": bvid,
        "cid": first_page["cid"],
        "page": requested_page,
        "page_count": len(pages),
        "title": data.get("title") or bvid,
        "author": (data.get("owner") or {}).get("name") or "",
        "duration": first_page.get("duration") or data.get("duration"),
        "page_title": first_page.get("part") or "",
    }


def bilibili_play_info(info: dict[str, Any]) -> dict[str, Any]:
    params = {
        "bvid": info["bvid"],
        "cid": info["cid"],
        "qn": 127,
        "fnver": 0,
        "fnval": 4048,
        "fourk": 1,
    }
    api_url = "https://api.bilibili.com/x/player/playurl?" + urllib.parse.urlencode(params)
    response = read_json(api_url, referer=info["resolved_url"])
    if response.get("code") != 0:
        message = response.get("message") or str(response.get("code"))
        code = "authentication_required" if response.get("code") in {-101, -10403} else "bilibili_play_error"
        raise DownloadError(code, message)
    return response["data"]


def choose_dash_stream(streams: list[dict[str, Any]]) -> dict[str, Any]:
    if not streams:
        raise DownloadError("no_public_stream", "No anonymously accessible stream is available.")
    return max(
        streams,
        key=lambda item: (
            int(item.get("id") or 0),
            int(item.get("bandwidth") or 0),
            int(item.get("width") or 0) * int(item.get("height") or 0),
        ),
    )


def download_bilibili(
    url: str,
    output_dir: Path,
    *,
    overwrite: bool,
    probe_only: bool,
    quiet: bool,
    allow_incomplete: bool = False,
) -> dict[str, Any]:
    info = bilibili_info(url)
    play = bilibili_play_info(info)
    if probe_only:
        dash = play.get("dash") or {}
        video = choose_dash_stream(dash.get("video") or []) if dash else None
        return {
            "ok": True,
            "probe_only": True,
            "platform": "bilibili",
            **info,
            "anonymous_quality": {
                "quality_id": video.get("id") if video else play.get("quality"),
                "width": video.get("width") if video else None,
                "height": video.get("height") if video else None,
            },
        }

    output_dir.mkdir(parents=True, exist_ok=True)
    page_suffix = f"P{info['page']}" if info.get("page_count", 1) > 1 else ""
    item_title = info["title"]
    if page_suffix:
        item_title = f"{item_title} - {page_suffix}"
        if info.get("page_title"):
            item_title += f" {info['page_title']}"
    identifier = info["bvid"] + (f"-p{info['page']}" if page_suffix else "")
    base = safe_filename(
        "_".join(
            part
            for part in ("Bilibili", info["author"], info["title"], page_suffix, info["page_title"], info["bvid"])
            if part
        )
    )
    destination = output_dir / f"{base}.mp4"

    def verified_result(*, skipped: bool = False) -> dict[str, Any]:
        expected_duration = float(info.get("duration") or 0)
        verified_duration = float(media_summary(ffprobe_media(destination)).get("duration") or 0)
        tolerance = max(15.0, expected_duration * 0.02)
        complete = verified_duration >= expected_duration - tolerance
        if expected_duration > 0 and not complete and not allow_incomplete:
            raise DownloadError(
                "incomplete_media",
                f"Bilibili P{info.get('page', 1)} metadata reports about "
                f"{expected_duration:.1f}s, but the downloaded stream is only "
                f"{verified_duration:.1f}s. The file was retained for diagnosis and "
                "must not be treated as complete.",
            )
        result = output_result(
            platform="bilibili",
            title=item_title,
            author=info["author"],
            identifier=identifier,
            file_path=destination,
            source_url=info["resolved_url"],
            skipped=skipped,
        )
        result["expected_duration"] = expected_duration
        result["verified_duration"] = verified_duration
        result["duration_complete"] = complete
        return result

    if destination.exists() and not overwrite:
        return verified_result(skipped=True)

    dash = play.get("dash") or {}
    if dash.get("video") and dash.get("audio"):
        video = choose_dash_stream(dash["video"])
        audio = max(dash["audio"], key=lambda item: int(item.get("bandwidth") or 0))
        video_url = video.get("baseUrl") or video.get("base_url")
        audio_url = audio.get("baseUrl") or audio.get("base_url")
        temp_video = output_dir / f".{base}.video.m4s"
        temp_audio = output_dir / f".{base}.audio.m4s"
        ffmpeg = find_executable("ffmpeg")
        if not ffmpeg:
            raise DownloadError("ffmpeg_missing", "FFmpeg is required to merge Bilibili DASH streams.")
        try:
            stream_download(video_url, temp_video, referer=info["resolved_url"], quiet=quiet)
            stream_download(audio_url, temp_audio, referer=info["resolved_url"], quiet=quiet)
            command = [
                ffmpeg,
                "-y" if overwrite else "-n",
                "-i",
                str(temp_video),
                "-i",
                str(temp_audio),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c",
                "copy",
                "-movflags",
                "+faststart",
                str(destination),
            ]
            completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8")
            if completed.returncode:
                destination.unlink(missing_ok=True)
                raise DownloadError("ffmpeg_merge_failed", completed.stderr[-2000:])
        finally:
            temp_video.unlink(missing_ok=True)
            temp_audio.unlink(missing_ok=True)
    elif play.get("durl"):
        stream_download(
            play["durl"][0]["url"],
            destination,
            referer=info["resolved_url"],
            quiet=quiet,
        )
    else:
        raise DownloadError("no_public_stream", "No anonymously accessible media URL was returned.")

    return verified_result()


def youtube_info(url: str) -> dict[str, Any]:
    command = [
        *yt_dlp_command(),
        *yt_dlp_common_args(),
        "--skip-download",
        "--dump-single-json",
        url,
    ]
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=120,
    )
    if completed.returncode:
        message = (completed.stderr or completed.stdout)[-2500:].strip()
        lowered = message.lower()
        code = (
            "authentication_required"
            if any(term in lowered for term in ("sign in", "login", "private video", "age-restricted"))
            else "youtube_metadata_error"
        )
        raise DownloadError(code, message)
    try:
        data = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise DownloadError("youtube_metadata_error", "yt-dlp returned invalid metadata JSON.") from exc
    identifier = str(data.get("id") or "")
    if not identifier:
        raise DownloadError("youtube_metadata_error", "YouTube metadata did not include a video ID.")
    return {
        "platform": "youtube",
        "resolved_url": data.get("webpage_url") or f"https://www.youtube.com/watch?v={identifier}",
        "id": identifier,
        "title": data.get("title") or identifier,
        "author": data.get("uploader") or data.get("channel") or "",
        "duration": float(data.get("duration") or 0),
        "language": data.get("language") or "",
        "subtitles": data.get("subtitles") or {},
        "automatic_captions": data.get("automatic_captions") or {},
    }


def download_youtube(
    url: str,
    output_dir: Path,
    *,
    overwrite: bool,
    probe_only: bool,
    quiet: bool,
    max_height: int,
) -> dict[str, Any]:
    info = youtube_info(url)
    if probe_only:
        return {
            "ok": True,
            "probe_only": True,
            **{
                key: value
                for key, value in info.items()
                if key not in {"subtitles", "automatic_captions"}
            },
            "manual_subtitle_languages": sorted(info["subtitles"].keys()),
            "automatic_subtitle_languages": sorted(info["automatic_captions"].keys()),
        }

    output_dir.mkdir(parents=True, exist_ok=True)
    base = safe_filename(
        "_".join(part for part in ("YouTube", info["author"], info["title"], info["id"]) if part)
    )
    destination = output_dir / f"{base}.mp4"
    if destination.exists() and not overwrite:
        require_media_streams(ffprobe_media(destination), video=True, audio=True)
        return output_result(
            platform="youtube",
            title=info["title"],
            author=info["author"],
            identifier=info["id"],
            file_path=destination,
            source_url=info["resolved_url"],
            skipped=True,
        )

    temp_template = output_dir / f".{base}.%(ext)s"
    format_selector = (
        f"bv*[height<={max_height}][ext=mp4]+ba[ext=m4a]/"
        f"b[height<={max_height}][ext=mp4]/"
        f"bv*[height<={max_height}]+ba/b[height<={max_height}]"
    )
    command = [
        *yt_dlp_command(),
        *yt_dlp_common_args(),
        "--newline",
        "--no-colors",
        "--progress",
        "--progress-template",
        "download:VIDEO_DOWNLOAD\t%(progress.downloaded_bytes)s\t%(progress.total_bytes_estimate)s",
        "--format",
        format_selector,
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--output",
        str(temp_template),
        info["resolved_url"],
    ]
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    output_lines: list[str] = []
    assert process.stdout is not None
    for raw_line in process.stdout:
        line = raw_line.rstrip("\r\n")
        output_lines.append(line)
        if len(output_lines) > 120:
            del output_lines[:40]
        if line.startswith("VIDEO_DOWNLOAD\t"):
            parts = line.split("\t")
            try:
                downloaded = int(float(parts[1]))
                total = int(float(parts[2])) if len(parts) > 2 and parts[2] not in {"", "NA", "None"} else 0
                report_progress("YouTube", downloaded, total)
            except (ValueError, IndexError):
                pass
        elif not quiet and line:
            log(line, quiet=False)
    return_code = process.wait()
    if return_code:
        message = "\n".join(output_lines)[-3000:].strip()
        raise DownloadError("youtube_download_failed", message)

    candidates = [
        path
        for path in output_dir.glob(f".{base}.*")
        if path.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov", ".m4v"}
    ]
    if not candidates:
        raise DownloadError("youtube_download_failed", "yt-dlp completed without a media file.")
    downloaded = max(candidates, key=lambda path: path.stat().st_size)
    try:
        require_media_streams(ffprobe_media(downloaded), video=True, audio=True)
        downloaded.replace(destination)
    except Exception:
        downloaded.unlink(missing_ok=True)
        raise

    return output_result(
        platform="youtube",
        title=info["title"],
        author=info["author"],
        identifier=info["id"],
        file_path=destination,
        source_url=info["resolved_url"],
    )


def douyin_video_url(url: str, content_type: str = "") -> bool:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    if "uuu_265.mp4" in url or "douyinstatic.com" in host:
        return False
    if "video/mp4" in content_type and (
        "douyinvod.com" in host or "ixigua.com" in host or "pstatp.com" in host
    ):
        return True
    return (
        host.endswith(".douyinvod.com")
        or host.endswith(".ixigua.com")
        or host.endswith(".pstatp.com")
    ) and ("video" in parsed.path or "mp4" in parsed.path)


def douyin_media_kind(url: str, content_type: str = "") -> str:
    lowered = urllib.parse.unquote(url).lower()
    normalized_type = content_type.lower()
    if normalized_type.startswith("audio/") or any(
        marker in lowered for marker in ("media-audio", "audio-und", "mp4a")
    ):
        return "audio"
    if normalized_type.startswith("video/") and any(
        marker in lowered for marker in ("media-video", "video-avc", "avc1", "hevc", "h264", "h265")
    ):
        return "video"
    if any(marker in lowered for marker in ("media-video", "video-avc", "avc1", "hevc", "h264", "h265")):
        return "video"
    return "unknown"


def playwright_total_size(request_context: Any, url: str, referer: str) -> int:
    response = request_context.get(
        url,
        headers={
            "Referer": referer,
            "User-Agent": UA,
            "Accept": "*/*",
            "Accept-Encoding": "identity",
            "Range": "bytes=0-0",
        },
        timeout=60000,
    )
    content_range = response.headers.get("content-range") or ""
    if "/" in content_range:
        try:
            return int(content_range.rsplit("/", 1)[1])
        except ValueError:
            pass
    return int(response.headers.get("content-length") or 0)


def playwright_download(
    request_context: Any,
    url: str,
    destination: Path,
    referer: str,
    *,
    quiet: bool,
) -> int:
    headers = {
        "Referer": referer,
        "User-Agent": UA,
        "Accept": "*/*",
        "Accept-Encoding": "identity",
    }
    probe = request_context.get(
        url,
        headers={**headers, "Range": "bytes=0-0"},
        timeout=60000,
    )
    if probe.status not in {200, 206}:
        raise DownloadError("media_probe_failed", f"Douyin CDN returned HTTP {probe.status}.")
    content_range = probe.headers.get("content-range") or ""
    total = 0
    if "/" in content_range:
        try:
            total = int(content_range.rsplit("/", 1)[1])
        except ValueError:
            pass
    if not total:
        total = int(probe.headers.get("content-length") or 0)
    if not total:
        raise DownloadError("media_probe_failed", "Douyin CDN did not provide media size.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    position = 0
    with destination.open("wb") as output:
        while position < total:
            end = min(position + 1024 * 1024 - 1, total - 1)
            response = request_context.get(
                url,
                headers={**headers, "Range": f"bytes={position}-{end}"},
                timeout=60000,
            )
            if response.status not in {200, 206}:
                destination.unlink(missing_ok=True)
                raise DownloadError("media_download_failed", f"Douyin CDN returned HTTP {response.status}.")
            body = response.body()
            if not body:
                destination.unlink(missing_ok=True)
                raise DownloadError("empty_media", "Douyin CDN returned an empty chunk.")
            output.write(body)
            position += len(body)
            log(
                f"Downloading {destination.name}: "
                f"{min(position, total) / 1048576:.1f}/{total / 1048576:.1f} MiB",
                quiet,
            )
    return total


def extract_douyin_metadata(page: Any) -> tuple[str, str]:
    title = page.evaluate(
        """() => {
            const node = document.querySelector('meta[property="og:title"]');
            return node ? (node.content || '') : '';
        }"""
    ) or ""
    if not title:
        title = page.title() or "douyin_video"
    author = ""
    for selector in (".screener-nickname", ".author-name", '[class*="nickname"]'):
        try:
            text = page.locator(selector).first.text_content(timeout=1000)
            if text:
                author = text.strip()
                break
        except Exception:
            continue
    title = title.strip()
    if title.endswith(" - 抖音"):
        title = title[:-5].strip()
    return title or "douyin_video", author


def download_douyin(
    url: str,
    output_dir: Path,
    *,
    overwrite: bool,
    probe_only: bool,
    quiet: bool,
    browser_path: str | None,
) -> dict[str, Any]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise DownloadError(
            "playwright_missing",
            "Run scripts/bootstrap.ps1 once to install the skill-local runtime.",
        ) from exc

    browser_executable = find_browser(browser_path)
    captured: list[tuple[str, str]] = []
    seen: set[str] = set()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=browser_executable,
            args=["--disable-blink-features=AutomationControlled", "--no-sandbox"],
        )
        context = browser.new_context(
            user_agent=UA,
            viewport={"width": 1280, "height": 720},
            locale="zh-CN",
        )
        page = context.new_page()

        def on_response(response: Any) -> None:
            content_type = response.headers.get("content-type", "")
            if douyin_video_url(response.url, content_type) and response.url not in seen:
                seen.add(response.url)
                captured.append((response.url, douyin_media_kind(response.url, content_type)))

        page.on("response", on_response)
        try:
            page.goto(url, timeout=60000, wait_until="domcontentloaded")
            page.wait_for_timeout(5000)
            for _ in range(3):
                page.evaluate("window.scrollBy(0, 400)")
                page.wait_for_timeout(500)
            deadline = time.time() + 15
            unchanged_since = time.time()
            previous_count = len(captured)
            while time.time() < deadline:
                page.wait_for_timeout(700)
                if len(captured) != previous_count:
                    previous_count = len(captured)
                    unchanged_since = time.time()
                elif captured and time.time() - unchanged_since > 4:
                    break

            title, author = extract_douyin_metadata(page)
            final_url = page.url
            identifier_match = re.search(r"/(?:video|note)/(\d+)", final_url)
            identifier = identifier_match.group(1) if identifier_match else "public"
            if not captured:
                raise DownloadError(
                    "captcha_or_no_public_stream",
                    "No public video stream was visible without login; the page may require verification.",
                )
            ranked = sorted(
                (
                    (playwright_total_size(context.request, media_url, final_url), media_url, kind)
                    for media_url, kind in captured
                ),
                reverse=True,
            )
            video_candidates = [item for item in ranked if item[2] == "video"]
            if not video_candidates:
                video_candidates = [item for item in ranked if item[2] == "unknown"]
            if not video_candidates:
                raise DownloadError("no_public_video_stream", "No public Douyin video stream was found.")
            total, media_url, _ = video_candidates[0]
            audio_candidates = [item for item in ranked if item[2] == "audio"]
            if probe_only:
                return {
                    "ok": True,
                    "probe_only": True,
                    "platform": "douyin",
                    "title": title,
                    "author": author,
                    "id": identifier,
                    "resolved_url": final_url,
                    "anonymous_media_size": total,
                }

            output_dir.mkdir(parents=True, exist_ok=True)
            base = safe_filename(
                "_".join(part for part in ("Douyin", author, title, identifier) if part)
            )
            destination = output_dir / f"{base}.mp4"
            if destination.exists() and not overwrite:
                require_media_streams(ffprobe_media(destination), video=True, audio=True)
                return output_result(
                    platform="douyin",
                    title=title,
                    author=author,
                    identifier=identifier,
                    file_path=destination,
                    source_url=final_url,
                    skipped=True,
                )
            temp_video = output_dir / f".{base}.video.mp4"
            temp_audio = output_dir / f".{base}.audio.m4a"
            temp_video.unlink(missing_ok=True)
            temp_audio.unlink(missing_ok=True)
            try:
                playwright_download(
                    context.request,
                    media_url,
                    temp_video,
                    final_url,
                    quiet=quiet,
                )
                video_probe = ffprobe_media(temp_video)
                require_media_streams(video_probe, video=True)
                has_audio = any(
                    item.get("codec_type") == "audio"
                    for item in video_probe.get("streams") or []
                )
                if has_audio:
                    temp_video.replace(destination)
                else:
                    if not audio_candidates:
                        raise DownloadError(
                            "missing_audio_stream",
                            "Douyin returned a video-only stream and no public audio stream was found.",
                        )
                    _, audio_url, _ = audio_candidates[0]
                    playwright_download(
                        context.request,
                        audio_url,
                        temp_audio,
                        final_url,
                        quiet=quiet,
                    )
                    merge_audio_video(temp_video, temp_audio, destination)
            finally:
                temp_video.unlink(missing_ok=True)
                temp_audio.unlink(missing_ok=True)
            return output_result(
                platform="douyin",
                title=title,
                author=author,
                identifier=identifier,
                file_path=destination,
                source_url=final_url,
            )
        finally:
            browser.close()


def detect_platform(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    if "douyin.com" in host:
        return "douyin"
    if "bilibili.com" in host or host == "b23.tv":
        return "bilibili"
    if "youtube.com" in host or host == "youtu.be":
        return "youtube"
    raise DownloadError("unsupported_platform", f"Unsupported host: {host}")


def run(args: argparse.Namespace) -> dict[str, Any]:
    url = extract_url(args.input)
    output_dir = Path(args.output).expanduser().resolve()
    platform = detect_platform(url)
    if platform == "douyin":
        return download_douyin(
            url,
            output_dir,
            overwrite=args.overwrite,
            probe_only=args.probe,
            quiet=args.json,
            browser_path=args.browser_path,
        )
    if platform == "youtube":
        return download_youtube(
            url,
            output_dir,
            overwrite=args.overwrite,
            probe_only=args.probe,
            quiet=args.json,
            max_height=args.youtube_max_height,
        )
    return download_bilibili(
        url,
        output_dir,
        overwrite=args.overwrite,
        probe_only=args.probe,
        quiet=args.json,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Download public YouTube, Douyin, and Bilibili videos without cookies."
    )
    parser.add_argument("input", help="A supported URL or complete share text.")
    parser.add_argument(
        "--output",
        default=r"D:\video",
        help=r"Destination directory (default: D:\video).",
    )
    parser.add_argument("--probe", action="store_true", help="Inspect without downloading.")
    parser.add_argument("--overwrite", action="store_true", help="Replace an existing output.")
    parser.add_argument("--browser-path", help="Explicit Chromium/Chrome/Edge executable.")
    parser.add_argument(
        "--youtube-max-height",
        type=int,
        default=720,
        help="Maximum YouTube video height for lightweight knowledge capture (default: 720).",
    )
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = parser.parse_args()
    try:
        result = run(args)
    except DownloadError as exc:
        result = {"ok": False, "error": exc.code, "message": exc.message}
    except Exception as exc:
        result = {"ok": False, "error": "unexpected_error", "message": str(exc)}
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif result.get("ok"):
        print(result.get("file") or json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"{result['error']}: {result['message']}", file=sys.stderr)
    return 0 if result.get("ok") else 2


if __name__ == "__main__":
    raise SystemExit(main())
