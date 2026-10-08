"""Bounded anonymous video extraction and precise local-only clipping."""
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.parse import parse_qs, urlsplit, urlunsplit

from app.services.tiktok_network import ALLOWED_DOMAINS, allowed_host, install_network_guard, validate_url
from app.services.tiktok_extract import probe

SOURCE_BYTES = 256 * 1024 * 1024
LOCAL_BYTES = FINAL_BYTES = 50 * 1024 * 1024
GLOBAL_BYTES = 2 * 1024 * 1024 * 1024
PROGRESS_START, PROGRESS_END = 0, 99
DOMAINS = {
    "tiktok": ALLOWED_DOMAINS,
    "youtube": ("youtube.com", "youtu.be", "googlevideo.com", "ytimg.com", "youtube-nocookie.com", "youtubei.googleapis.com"),
    "instagram": ("instagram.com", "cdninstagram.com", "fbcdn.net"),
}


def validate_link(url):
    if not isinstance(url, str) or len(url) > 2048 or any(ord(c) < 33 for c in url):
        raise ValueError("Invalid video link")
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Use a public HTTPS video link")
    if host in ("www.tiktok.com", "tiktok.com", "m.tiktok.com", "vm.tiktok.com", "vt.tiktok.com"):
        return "tiktok", validate_url(url, initial=True)
    if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"):
        query = parse_qs(parsed.query)
        if "list" in query:
            raise ValueError("Playlists are not supported; paste a single video link")
        video_id = (parsed.path.strip("/") if host == "youtu.be" else
                    query.get("v", [""])[0] if parsed.path == "/watch" else
                    parsed.path.split("/")[2] if re.fullmatch(r"/shorts/[^/]+/?", parsed.path) else "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            raise ValueError("Paste a YouTube video or Shorts link")
        return "youtube", "https://www.youtube.com/watch?v=" + video_id
    if host in ("instagram.com", "www.instagram.com", "m.instagram.com") and re.fullmatch(r"/reel/[A-Za-z0-9_-]+/?", parsed.path):
        return "instagram", urlunsplit(("https", "www.instagram.com", parsed.path, "", ""))
    raise ValueError("Supported links: TikTok, YouTube, Shorts and Instagram Reels")


def source_duration(metadata):
    duration = float(metadata.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or not 0 < duration <= 1200:
        raise ValueError("Source video must be no longer than 20 minutes")
    return round(duration * 1000)


def validate_clip(duration_ms, start_ms, end_ms):
    if type(start_ms) is not int or type(end_ms) is not int or type(duration_ms) is not int:
        raise ValueError("Clip times must be integer milliseconds")
    if not 0 <= start_ms < end_ms <= duration_ms:
        raise ValueError("Select a passage inside the source video")
    length = end_ms - start_ms
    if duration_ms < 2000:
        if start_ms != 0 or end_ms != duration_ms:
            raise ValueError("Very short videos must stay complete")
    elif not 2000 <= length <= 30000:
        raise ValueError("Select between 2 and 30 seconds")
    return length


def run_ffmpeg(arguments, timeout):
    duration_ms = (round(float(arguments[arguments.index("-t") + 1]) * 1000) if "-t" in arguments
                   else source_duration(probe(Path(arguments[arguments.index("-i") + 1]))))
    with tempfile.TemporaryDirectory(prefix="ffmpeg-progress-") as temporary:
        progress_file = Path(temporary) / "progress.txt"
        process = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                                    "-progress", str(progress_file), "-stats_period", "0.5", *arguments],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        started, last = time.monotonic(), -1
        try:
            while True:
                if progress_file.exists():
                    values = re.findall(r"^out_time_us=(\d+)$", progress_file.read_text(), re.MULTILINE)
                    if values:
                        percent = min(PROGRESS_END, PROGRESS_START + int(int(values[-1]) / (duration_ms * 1000) * (PROGRESS_END - PROGRESS_START)))
                        if percent > last:
                            print(json.dumps({"phase": "optimizing", "progress_percent": percent}), flush=True)
                            last = percent
                if process.poll() is not None:
                    if process.returncode: raise subprocess.CalledProcessError(process.returncode, "ffmpeg")
                    break
                if time.monotonic() - started > timeout: raise subprocess.TimeoutExpired("ffmpeg", timeout)
                time.sleep(0.25)
        finally:
            if process.poll() is None: process.kill()
            process.wait()


def clip_video(source, final, start_ms, end_ms, volume=1.0):
    if not 0 <= volume <= 1:
        raise ValueError("Video volume must be between 0 and 1")
    duration = source_duration(probe(source))
    length = validate_clip(duration, start_ms, end_ms)
    run_ffmpeg(["-ss", str(start_ms / 1000), "-i", str(source), "-t", str(length / 1000),
                "-map", "0:v:0", "-map", "0:a:0?",
                "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-maxrate", "1200k", "-bufsize", "2400k",
                "-pix_fmt", "yuv420p", "-af", f"volume={volume}", "-c:a", "aac", "-b:a", "96k", "-threads", "2", "-movflags", "+faststart", "-y", str(final)], 170)
    result = source_duration(probe(final))
    if final.stat().st_size > FINAL_BYTES or abs(result - length) > 200:
        raise ValueError("Could not prepare an accurate clip within the size limit")
    return {"duration_ms": min(result, length)}


def prepare_source(source, final):
    metadata = probe(source)
    duration = source_duration(metadata)
    video = next((s for s in metadata["streams"] if s.get("codec_type") == "video"), None)
    if not video or int(video.get("width", 0)) * int(video.get("height", 0)) > 20_000_000:
        raise ValueError("Invalid video dimensions")
    audio = [s for s in metadata["streams"] if s.get("codec_type") == "audio"]
    compatible = (video.get("codec_name") == "h264" and video.get("pix_fmt") == "yuv420p"
                  and max(video["width"], video["height"]) <= 1280
                  and all(s.get("codec_name") == "aac" for s in audio))
    encoding = ["-c", "copy"] if compatible else [
        "-vf", "scale=w='min(854,iw)':h='min(854,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-maxrate", "1200k", "-bufsize", "2400k",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-threads", "2"]
    run_ffmpeg(["-i", str(source), "-map", "0:v:0", "-map", "0:a:0?", *encoding,
                "-movflags", "+faststart", "-y", str(final)], 500)
    if final.stat().st_size > SOURCE_BYTES or abs(source_duration(probe(final)) - duration) > 200:
        raise ValueError("Source preview exceeds the processing limits")
    return duration


def fetch_source(url, directory):
    platform, url = validate_link(url)
    for key in list(os.environ):
        if key.lower().endswith("_proxy"):
            del os.environ[key]
    install_network_guard(DOMAINS[platform])
    from yt_dlp import YoutubeDL
    from yt_dlp.extractor.tiktok import TikTokIE, TikTokVMIE
    from yt_dlp.extractor.youtube import YoutubeIE
    from yt_dlp.extractor.instagram import InstagramIE
    from yt_dlp.networking import Request
    from yt_dlp.utils import ExtractorError

    class PublicTikTokIE(TikTokIE):
        @classmethod
        def ie_key(cls): return "TikTok"
        def _solve_challenge_and_set_cookies(self, webpage):
            raise ExtractorError("Public access unavailable", expected=True)

    class QuietLogger:
        def debug(self, *_): pass
        def warning(self, *_): pass
        def error(self, *_): pass

    options = {"quiet": True, "logger": QuietLogger(), "proxy": "", "socket_timeout": 15,
               "noplaylist": True, "cachedir": False, "extractor_retries": 0, "remote_components": [],
               "js_runtimes": {"node": {"path": "/usr/local/bin/node"}},
               "format": "best[ext=mp4][protocol=https][height<=1280][width<=1280]/bestvideo[ext=mp4][vcodec^=avc1][protocol=https][height<=1280][width<=1280]+bestaudio[ext=m4a][protocol=https]"}
    with YoutubeDL(options, auto_init=False) as ydl:
        for extractor in {"tiktok": [PublicTikTokIE(), TikTokVMIE()], "youtube": [YoutubeIE()], "instagram": [InstagramIE()]}[platform]:
            ydl.add_info_extractor(extractor)
        info = ydl.extract_info(url, download=False)
        if not info or info.get("_type") in ("playlist", "multi_video") or info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
            raise ValueError("Only public non-live videos are supported")
        duration = float(info.get("duration") or 0)
        if not math.isfinite(duration) or duration > 1200:
            raise ValueError("Source video must be no longer than 20 minutes")
        streams = info.get("requested_formats") or [info]
        if not 1 <= len(streams) <= 2:
            raise ValueError("Unsupported source streams")
        paths, total = [], 0
        for index, stream in enumerate(streams):
            media = urlsplit(stream.get("url", ""))
            if media.scheme != "https" or media.username or media.password or media.port not in (None, 443) or not allowed_host(media.hostname or "", DOMAINS[platform]):
                raise ValueError("Unsupported download destination")
            if stream.get("protocol") not in (None, "https"):
                raise ValueError("Unsupported source streams")
            path = directory / f"track-{index}.mp4"
            with ydl.urlopen(Request(stream["url"], headers=stream.get("http_headers") or info.get("http_headers") or {})) as response, path.open("wb") as output:
                while chunk := response.read(256 * 1024):
                    total += len(chunk)
                    if total > SOURCE_BYTES:
                        raise ValueError("Source video exceeds 256 MiB")
                    output.write(chunk)
            paths.append(path)
    source = paths[0]
    if len(paths) == 2:
        source = directory / "merged.mp4"
        run_ffmpeg(["-i", str(paths[0]), "-i", str(paths[1]), "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-y", str(source)], 60)
    title = str(info.get("title") or platform.title() + " video")
    creator = str(info.get("uploader") or info.get("creator") or "")
    return source, ((creator + " · " if creator and creator not in title else "") + title)[:300]


if __name__ == "__main__":
    try:
        mode, source_arg, directory_arg = sys.argv[1:4]
        directory = Path(directory_arg)
        if mode == "clip":
            result = clip_video(Path(source_arg), directory / "ready.mp4", int(sys.argv[4]), int(sys.argv[5]), float(sys.argv[6]) if len(sys.argv) > 6 else 1.0)
        else:
            source, title = (Path(source_arg), "Uploaded video") if mode == "local" else fetch_source(source_arg, directory)
            original_duration = source_duration(probe(source))
            PROGRESS_END = 80 if original_duration <= 30000 else 99
            print(json.dumps({"phase": "optimizing", "progress_percent": 0}), flush=True)
            duration = prepare_source(source, directory / "source.mp4")
            result = {"source_duration_ms": duration, "title": title}
            if duration <= 30000:
                PROGRESS_START, PROGRESS_END = 80, 99
                result.update(clip_video(directory / "source.mp4", directory / "ready.mp4", 0, duration))
        print(json.dumps(result), flush=True)
    except Exception as error:
        # Never expose signed source URLs, credentials or extractor diagnostics.
        safe = str(error) if isinstance(error, ValueError) else "This public video could not be prepared. Upload the file manually."
        print(json.dumps({"error": safe[:255]}), flush=True)
        sys.exit(1)
