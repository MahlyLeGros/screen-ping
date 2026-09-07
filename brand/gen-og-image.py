"""Generate web/public/og-image.png (1200x630) for Discord / Open Graph embeds."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
LOGO = ROOT / "desktop" / "assets" / "icon.png"
OUT = ROOT / "web" / "public" / "og-image.png"

WIDTH, HEIGHT = 1200, 630
BG = (3, 3, 4, 255)


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    names = (
        ("seguisb.ttf", "segoeuib.ttf", "segoeui.ttf")
        if bold
        else ("segoeui.ttf", "calibri.ttf", "arial.ttf")
    )
    for name in names:
        path = Path(r"C:\Windows\Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def _glow(size: tuple[int, int], color: tuple[int, int, int], radius: int, blur: int) -> Image.Image:
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    cx, cy = size[0] // 2, size[1] // 2
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=(*color, 255))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def main() -> None:
    if not LOGO.exists():
        raise SystemExit(f"Missing logo: {LOGO}")

    canvas = Image.new("RGBA", (WIDTH, HEIGHT), BG)

    glows = [
        ((-80, -120), (34, 211, 238), 280, 90, 0.22),
        ((760, -80), (167, 139, 250), 340, 110, 0.28),
        ((420, 380), (244, 114, 182), 260, 100, 0.16),
        ((980, 420), (96, 165, 250), 220, 80, 0.18),
    ]
    for (x, y), color, radius, blur, alpha in glows:
        blob = _glow((radius * 2 + blur * 4, radius * 2 + blur * 4), color, radius, blur)
        faded = Image.new("RGBA", blob.size, (0, 0, 0, 0))
        faded = Image.blend(faded, blob, alpha)
        canvas.alpha_composite(faded, (x, y))

    logo = Image.open(LOGO).convert("RGBA")
    logo_size = 236
    logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
    logo_x, logo_y = 96, (HEIGHT - logo_size) // 2
    canvas.alpha_composite(logo, (logo_x, logo_y))

    draw = ImageDraw.Draw(canvas)
    title_font = _font(84, bold=True)
    tag_font = _font(28, bold=False)
    url_font = _font(22, bold=False)

    text_x = logo_x + logo_size + 36
    title = "Screen Ping"
    title_bbox = draw.textbbox((0, 0), title, font=title_font)
    title_h = title_bbox[3] - title_bbox[1]
    tag = "Send images, videos and sounds\nto your friends' screens."
    url = "screenping.xyz"

    block_h = title_h + 22 + 72 + 28
    text_y = (HEIGHT - block_h) // 2 - 8

    draw.text((text_x, text_y), title, font=title_font, fill=(248, 250, 252, 255))
    draw.multiline_text(
        (text_x, text_y + title_h + 18),
        tag,
        font=tag_font,
        fill=(148, 163, 184, 255),
        spacing=8,
    )
    draw.text((text_x, text_y + title_h + 18 + 78), url, font=url_font, fill=(167, 139, 250, 255))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
