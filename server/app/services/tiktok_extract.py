"""Child process: no database, credentials, shell commands or external downloaders."""
import json
import math
import os
from pathlib import Path
import subprocess
import sys

from app.services.tiktok_network import install_network_guard, validate_url

MAX_BYTES = 50 * 1024 * 1024


def probe(path: Path) -> dict:
    result = subprocess.run([
        "ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format", "-show_streams",
        "-of", "json", str(path),
    ], capture_output=True, check=True, timeout=15)
    return json.loads(result.stdout)


def duration_of(info: dict) -> float:
    duration = float(info.get("format", {}).get("duration", 0))
    if not math.isfinite(duration) or not 0 < duration <= 180:
        raise ValueError("Video must be no longer than three minutes")
    return duration


def import_video(url: str, directory: Path) -> dict:
    url = validate_url(url, initial=True)
    # No proxy from environment, personal cookie store, configuration or plugins.
    for key in list(os.environ):
        if key.lower().endswith("_proxy"):
            del os.environ[key]
    install_network_guard()
    from yt_dlp import YoutubeDL
    from yt_dlp.extractor.tiktok import TikTokIE, TikTokVMIE
    from yt_dlp.utils import ExtractorError
    from yt_dlp.networking import Request

    class PublicTikTokIE(TikTokIE):
        @classmethod
        def ie_key(cls):
            return "TikTok"

        def _solve_challenge_and_set_cookies(self, webpage):
            # Respect the product's no-bypass policy even if yt-dlp adds a solver.
            raise ExtractorError("TikTok restricted this request; manual upload required", expected=True)

    class QuietLogger:
        def debug(self, *_): pass
        def warning(self, *_): pass
        def error(self, *_): pass

    with YoutubeDL({"quiet": True, "logger": QuietLogger(), "proxy": "", "socket_timeout": 12,
                     "noplaylist": True, "cachedir": False, "extractor_retries": 0,
                     "format": "best[ext=mp4][protocol=https]/best[ext=mp4][protocol=http]"}, auto_init=False) as ydl:
        ydl.add_info_extractor(PublicTikTokIE())
        ydl.add_info_extractor(TikTokVMIE())
        info = ydl.extract_info(url, download=False)
        if not info or info.get("_type") in ("playlist", "multi_video") or info.get("is_live"):
            raise ValueError("Only public video posts are supported")
        from app.services.video_import import remote_duration
        remote_duration(info, "tiktok")
        if info.get("duration") and float(info["duration"]) > 180:
            raise ValueError("Video must be no longer than three minutes")
        media_url = validate_url(info.get("url", ""))
        if info.get("filesize", 0) and info["filesize"] > MAX_BYTES:
            raise ValueError("Source video is too large (50 MiB maximum)")
        # Only a single progressive file; never pass remote manifests to FFmpeg.
        source = directory / "source.mp4"
        # Preserve the extractor's normal request headers and fresh anonymous
        # session. A generic User-Agent alone causes valid CDN links to return 403.
        with ydl.urlopen(Request(media_url, headers=info.get("http_headers") or {})) as response, source.open("wb") as output:
            size = 0
            while chunk := response.read(256 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError("Source video is too large (50 MiB maximum)")
                output.write(chunk)
    print("optimizing", flush=True)
    return prepare_video(source, directory / "ready.mp4")


def prepare_video(source: Path, final: Path) -> dict:
    metadata = probe(source)
    duration = duration_of(metadata)
    video = next((s for s in metadata["streams"] if s.get("codec_type") == "video"), None)
    if not video or int(video.get("width", 0)) * int(video.get("height", 0)) > 20_000_000:
        raise ValueError("Invalid video dimensions")
    # Remux compatible, already-small videos for fast start; otherwise compress once.
    audio = [s for s in metadata["streams"] if s.get("codec_type") == "audio"]
    rate = video.get("avg_frame_rate", "0/1").split("/")
    fps = float(rate[0]) / max(float(rate[1]), 1)
    compatible = (video.get("codec_name") == "h264" and video.get("pix_fmt") == "yuv420p"
                  and max(video["width"], video["height"]) <= 1280 and fps <= 30
                  and all(s.get("codec_name") == "aac" for s in audio)
                  and source.stat().st_size <= duration * 200_000)
    encoding = ["-c", "copy"] if compatible else [
        "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-maxrate", "1200k", "-bufsize", "2400k",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-threads", "2",
    ]
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(source),
                    "-map", "0:v:0", "-map", "0:a:0?", *encoding, "-movflags", "+faststart", "-y", str(final)],
                   check=True, timeout=150, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    final_duration = duration_of(probe(final))
    if final.stat().st_size > MAX_BYTES or abs(final_duration - duration) > 1:
        raise ValueError("Could not prepare the complete video within the size limit")
    return {"duration_ms": round(final_duration * 1000)}


def import_error_message(error: Exception) -> str:
    detail = str(error)
    safe_messages = ("Video must be no longer than three minutes", "Source video is too large (50 MiB maximum)",
                     "Only public video posts are supported", "Invalid video dimensions",
                     "Could not prepare the complete video within the size limit")
    if detail in safe_messages:
        return detail + ". Upload a different video."
    if "restricted this request" in detail or "requiring login" in detail:
        return "TikTok restricted access to this video from the server. Upload the file manually."
    if "blocked" in detail or "Unsupported download destination" in detail:
        return "TikTok used a download destination that is not approved. Upload the file manually."
    return "TikTok could not be imported. Use a public video under three minutes or upload the file manually."


if __name__ == "__main__":
    try:
        print(json.dumps(import_video(sys.argv[1], Path(sys.argv[2]))), flush=True)
    except Exception as error:
        # Never expose CDN URLs, query tokens or extractor diagnostics to clients.
        print(json.dumps({"error": import_error_message(error)}), flush=True)
        sys.exit(1)
