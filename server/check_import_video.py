"""Offline release check: real codecs/compression and complete long videos."""
from pathlib import Path
import subprocess
import tempfile

from app.services.tiktok_extract import prepare_video, probe

with tempfile.TemporaryDirectory(prefix="screenping-codec-check-") as temporary:
    root = Path(temporary)
    for name, size, seconds in (("vertical", "360x640", 35), ("horizontal", "1920x1080", 3)):
        source, final = root / f"{name}-source.mp4", root / f"{name}-ready.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"color=c=blue:s={size}:r=30",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", str(seconds),
                        "-c:v", "mpeg4", "-q:v", "8", "-c:a", "aac", "-threads", "2", str(source)], check=True, timeout=40)
        result = prepare_video(source, final)
        meta = probe(final)
        video = next(s for s in meta["streams"] if s["codec_type"] == "video")
        audio = next(s for s in meta["streams"] if s["codec_type"] == "audio")
        assert abs(result["duration_ms"] - seconds * 1000) < 200
        assert video["codec_name"] == "h264" and audio["codec_name"] == "aac"
        assert max(video["width"], video["height"]) <= 1280
        assert final.stat().st_size < 50 * 1024 * 1024
        # Compatible input is kept without another lossy re-encode.
        remuxed = root / f"{name}-remuxed.mp4"
        assert prepare_video(final, remuxed)["duration_ms"] == result["duration_ms"]
        print(f"PASS {name}: complete {seconds}s, H.264/AAC, {video['width']}x{video['height']}, {final.stat().st_size} bytes", flush=True)
