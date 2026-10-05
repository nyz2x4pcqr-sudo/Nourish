"""Makes a "scanned" cookbook PDF: each page is only a picture of printed text (no text inside the
PDF), the way a book scanned on a copier or phone comes out. Used by make-test-books.js.
    python make-scanned-pdf.py pages.json out.pdf      (needs Pillow)
pages.json: {"title", "author", "pages": [[[text, size, bold], ...], ...]}"""
import json
import random
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont


def font(size, bold):
    names = ["arialbd.ttf", "DejaVuSans-Bold.ttf"] if bold else ["arial.ttf", "DejaVuSans.ttf"]
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main(spec_path, out_path):
    spec = json.load(open(spec_path, encoding="utf-8"))
    random.seed(7)
    images = []
    for lines in spec["pages"]:
        # 150 dpi letter page, slightly off-white and slightly rotated, like a real scan.
        img = Image.new("L", (1275, 1650), 246)
        draw = ImageDraw.Draw(img)
        y = 90
        for text, size, bold in lines:
            px = int(size * 2.1)
            if text:
                draw.text((105, y), text, fill=25, font=font(px, bold))
            y += px + 12
        img = img.rotate(random.uniform(-0.6, 0.6), fillcolor=246).filter(ImageFilter.GaussianBlur(0.6))
        images.append(img.convert("RGB"))
    images[0].save(out_path, save_all=True, append_images=images[1:], resolution=150,
                   title=spec.get("title", ""), author=spec.get("author", ""))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
