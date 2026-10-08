"""Offline release checks; uses synthetic media, never users' videos."""
import subprocess
import tempfile
from pathlib import Path
from app.services.video_import import clip_video, prepare_source, probe, source_duration

with tempfile.TemporaryDirectory(prefix="screenping-clips-qa-") as directory:
    root = Path(directory)
    for seconds in (0.5, 30, 35, 1200):
        source = root / "input.mp4"
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000", "-t", str(seconds),
                        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-y", str(source)], check=True, timeout=120)
        prepared = root / "source.mp4"
        duration = prepare_source(source, prepared)
        assert abs(duration - seconds * 1000) <= 100
        starts = (0, 600000, 1170000) if seconds == 1200 else (0,)
        for start in starts:
            end = min(start + 30000, duration)
            result = clip_video(prepared, root / "clip.mp4", start, end)
            assert abs(result["duration_ms"] - (end - start)) <= 200
            info = probe(root / "clip.mp4")
            assert any(s.get("codec_name") == "h264" for s in info["streams"])
            assert any(s.get("codec_name") == "aac" for s in info["streams"])
            print("PASS source", seconds, "seconds; excerpt", start, end, "ms; H264/AAC", flush=True)
