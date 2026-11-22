"""Anonymous public photo posts; guarded downloads and local-only slideshow rendering."""
import html
import json
import math
import re
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

from PIL import Image, ImageOps

from app.services.tiktok_network import install_network_guard, validate_url

PHOTO_DOMAINS = ("tiktok.com", "tiktokv.com", "tiktokcdn.com", "tiktokcdn-us.com", "tiktokcdn-eu.com", "byteoversea.com", "ibytedtos.com")
MAX_PHOTOS = 100
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_TOTAL_BYTES = 256 * 1024 * 1024
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.tiktok.com/"}


def timing(count, seconds=3):
    if type(count) is not int or not 1 <= count <= MAX_PHOTOS:
        raise ValueError("Photo posts must contain between 1 and 100 images")
    if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or not 0.01 <= seconds <= 30:
        raise ValueError("Choose between 0.01 and 30 seconds per photo")
    total = min(900, max(60, count, round(seconds * count * 30)))
    frames = total // count
    return frames, min(7, frames // 4), round(total / 30 * 1000)


def photo_id(url):
    match = re.fullmatch(r"/@[^/]+/photo/(\d+)/?", urlsplit(url).path)
    return match.group(1) if match else None


def resolve_photo(url):
    """Resolve ordinary TikTok short links without accepting unrelated redirects."""
    validate_url(url, initial=True, allow_photo=True)
    if photo_id(url):
        return photo_id(url)
    if urlsplit(url).hostname in ("vm.tiktok.com", "vt.tiktok.com") or urlsplit(url).path.startswith("/t/"):
        try:
            with urlopen(Request(url, headers=HEADERS), timeout=15) as response:
                validate_url(response.url, initial=True, allow_photo=True)
                return photo_id(response.url)
        except Exception:
            # Preserve the existing video extractor's short-link behavior.
            return None
    return None


def parse_embed(page, identifier):
    match = re.search(r'<script\b[^>]*\bid=["\']__FRONTITY_CONNECT_STATE__["\'][^>]*>(.*?)</script>', page, re.S)
    try:
        state = json.loads(match.group(1)) if match else {}
        item = state["source"]["data"][f"/embed/v2/{identifier}"]["videoData"]
        photos = item["imagePostInfo"]["displayImages"]
    except (ValueError, KeyError, TypeError):
        raise ValueError("This TikTok photo post is not publicly accessible; upload its images manually") from None
    timing(len(photos))
    if any(not isinstance(p, dict) or not isinstance(p.get("urlList"), list) or not p["urlList"] for p in photos):
        raise ValueError("Some TikTok photos are unavailable; the whole post could not be imported")
    title = str(item.get("itemInfos", {}).get("text") or "TikTok slideshow")[:250]
    author = str(item.get("authorInfos", {}).get("uniqueId") or "")[:50]
    music = item.get("musicInfos", {}).get("playUrl") or []
    return photos, music if isinstance(music, list) else [], (f"@{author} · " if author else "") + title


def download(urls, destination, maximum, budget):
    # Alternative URLs belong to the same asset, never to a subset of the post.
    for url in urls[:3]:
        try:
            validate_url(url)
            with urlopen(Request(url, headers=HEADERS), timeout=15) as response, destination.open("wb") as output:
                size = 0
                while chunk := response.read(256 * 1024):
                    size += len(chunk); budget[0] += len(chunk)
                    if size > maximum or budget[0] > MAX_TOTAL_BYTES:
                        raise ValueError("TikTok photo source exceeds the download size limit")
                    output.write(chunk)
            if not size:
                raise OSError("Empty media")
            return
        except ValueError:
            destination.unlink(missing_ok=True)
            raise
        except Exception:
            destination.unlink(missing_ok=True)
    raise ValueError("Some TikTok media are unavailable; upload the images manually")


def fetch_photos(url, directory, enabled=False):
    install_network_guard(PHOTO_DOMAINS)
    identifier = resolve_photo(url)
    if not identifier:
        return None
    if not enabled:
        raise ValueError("TikTok photo import is currently unavailable; upload the images manually")
    with urlopen(Request(f"https://www.tiktok.com/embed/v2/{identifier}", headers=HEADERS), timeout=15) as response:
        page = response.read(2 * 1024 * 1024 + 1)
    if len(page) > 2 * 1024 * 1024:
        raise ValueError("TikTok photo metadata exceeds the size limit")
    photos, music_urls, title = parse_embed(page.decode("utf-8", "replace"), identifier)
    budget, images = [0], []
    for index, photo in enumerate(photos):
        raw = directory / f"photo-{index}.input"
        download(photo["urlList"], raw, MAX_IMAGE_BYTES, budget)
        target = directory / f"photo-{index}.png"
        with Image.open(raw) as image:
            if image.width * image.height > 20_000_000 or getattr(image, "n_frames", 1) != 1:
                raise ValueError("A TikTok photo has unsupported dimensions or animation")
            image = ImageOps.exif_transpose(image).convert("RGB")
            image.thumbnail((720, 1280), Image.Resampling.LANCZOS)
            image.save(target, "PNG")
        raw.unlink()
        images.append(str(target))
        if sum(Path(p).stat().st_size for p in images) > MAX_TOTAL_BYTES:
            raise ValueError("Decoded TikTok photos exceed the storage limit")
    music = None
    if music_urls:
        raw = directory / "music.input"
        try:
            download(music_urls, raw, 10 * 1024 * 1024, budget)
            from app.services.tiktok_extract import probe
            metadata = probe(raw)
            duration = float(metadata.get("format", {}).get("duration", 0))
            if not math.isfinite(duration) or not 0 < duration <= 180 or not any(s.get("codec_type") == "audio" for s in metadata["streams"]):
                raise ValueError("Public music unavailable")
            from app.services import video_import as video
            music = directory / "music.m4a"
            video.PROGRESS_START = video.PROGRESS_END = 0
            video.run_ffmpeg(["-i", str(raw), "-t", "30", "-vn", "-c:a", "aac", "-b:a", "96k", "-threads", "1", "-y", str(music)], 30)
        except Exception:
            if budget[0] > MAX_TOTAL_BYTES:
                raise ValueError("TikTok photo source exceeds the download size limit") from None
            music = None
        finally:
            raw.unlink(missing_ok=True)
    return {"images": images, "music": str(music) if music else None, "title": html.unescape(title)[:300]}


def fit_frame(image, width, height):
    fitted = image.convert("RGB")
    fitted.thumbnail((width, height), Image.Resampling.LANCZOS)
    # Even encoder dimensions can otherwise leave a one-pixel black seam.
    if width - fitted.width <= 1 and height - fitted.height <= 1:
        fitted = fitted.resize((width, height), Image.Resampling.LANCZOS)
    frame = Image.new("RGB", (width, height), "black")
    frame.paste(fitted, ((width-fitted.width)//2, (height-fitted.height)//2))
    return frame


def render_slideshow(assets, directory, seconds=3, volume=1):
    from app.services import video_import as video
    if not isinstance(volume, (int, float)) or not math.isfinite(volume) or not 0 <= volume <= 1:
        raise ValueError("Video volume must be between 0 and 1")
    images = [Path(p) for p in assets["images"]]
    base_frames, _, duration_ms = timing(len(images), seconds)
    total_frames = round(duration_ms * 30 / 1000)
    with Image.open(images[0]) as first:
        width, height = max(2, first.width // 2 * 2), max(2, first.height // 2 * 2)
    # Normalize one frame at a time; no giant filter graph holding every image.
    for index, image in enumerate(images):
        with Image.open(image) as opened:
            frame = fit_frame(opened, width, height)
            frame.save(directory / f"frame-{index}.png")
    parts = []
    for index in range(len(images)):
        # Distribute leftover frames so the chosen total duration stays exact.
        frames = base_frames + (index < total_frames % len(images))
        transition = min(7, frames // 4)
        part = directory / f"part-{index}.mp4"
        args = ["-loop", "1", "-framerate", "30", "-i", str(directory / f"frame-{index}.png")]
        if index + 1 < len(images) and transition:
            progress = f"clip((t-{(frames-transition)/30})/{transition/30},0,1)"
            eased = f"({progress})*({progress})*(3-2*({progress}))"
            args += ["-loop", "1", "-framerate", "30", "-i", str(directory / f"frame-{index+1}.png"),
                     "-filter_complex_threads", "1", "-filter_complex",
                     f"[0:v][1:v]hstack=inputs=2,crop=w=iw/2:h=ih:x='(iw/2)*({eased})':y=0:exact=1,format=yuv420p[v]", "-map", "[v]"]
        args += ["-t", str(frames/30), "-frames:v", str(frames), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-threads", "1", "-y", str(part)]
        video.PROGRESS_START = int(index / len(images) * 90)
        video.PROGRESS_END = max(video.PROGRESS_START, int((index+1) / len(images) * 90))
        video.run_ffmpeg(args, 45)
        parts.append(part)
    listing = directory / "parts.txt"
    listing.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
    final = directory / "ready.mp4"
    args = ["-f", "concat", "-safe", "1", "-i", str(listing)]
    if assets.get("music"):
        args += ["-stream_loop", "-1", "-i", assets["music"], "-map", "0:v:0", "-map", "1:a:0", "-af", f"volume={volume}", "-c:a", "aac", "-b:a", "96k"]
    args += ["-t", str(duration_ms / 1000), "-c:v", "copy", "-threads", "1", "-movflags", "+faststart", "-y", str(final)]
    video.PROGRESS_START, video.PROGRESS_END = 90, 99
    video.run_ffmpeg(args, 30)
    if final.stat().st_size > video.FINAL_BYTES:
        raise ValueError("Slideshow exceeds the 50 MiB result limit")
    actual = video.source_duration(video.probe(final))
    if abs(actual-duration_ms) > 100 or actual > 30100:
        raise ValueError("Could not prepare an accurate slideshow")
    return {"duration_ms": duration_ms, "source_duration_ms": duration_ms, "media_kind": "slideshow", "seconds_per_photo": seconds, "effective_seconds_per_photo": duration_ms/1000/len(images), "photo_count": len(images), "has_music": bool(assets.get("music"))}
