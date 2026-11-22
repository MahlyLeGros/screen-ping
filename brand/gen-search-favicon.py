"""Recolor the original tab icon without changing its alpha silhouette."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
original = Image.open(root / "web/public/favicon.png").convert("RGBA")
pink, purple = (244, 114, 182), (167, 139, 250)
for size, name in ((original.width, "favicon-pink.png"), (96, "favicon-search.png")):
    alpha = original.getchannel("A").resize((size, size), Image.Resampling.LANCZOS)
    result = Image.new("RGBA", (size, size))
    for y in range(size):
        for x in range(size):
            t = x / (size - 1)
            rgb = tuple(round(a + (b-a)*t) for a,b in zip(pink,purple))
            opacity = alpha.getpixel((x,y))
            result.putpixel((x,y), (*(rgb if opacity else (0, 0, 0)), opacity))
    result.save(root / "web/public" / name)
    saved = Image.open(root / "web/public" / name).convert("RGBA")
    assert saved.getchannel("A").tobytes() == alpha.tobytes()
    assert alpha.getextrema() == (0, 255)
    print(f"VERIFIED {name}: {size}px, original alpha preserved")
