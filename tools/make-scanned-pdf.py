"""Writes a "scanned" PDF: each page is only a picture of printed text, like a cookbook run through a
scanner, so there is no text inside the file to read. Used by tools/make-audit-books.js.
    python3 tools/make-scanned-pdf.py out.pdf < pages.json   ([[title, [lines...]], ...])
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont


def font(size, bold=False):
    for name in (("DejaVuSerif-Bold.ttf" if bold else "DejaVuSerif.ttf"), "/usr/share/fonts/truetype/dejavu/" + ("DejaVuSerif-Bold.ttf" if bold else "DejaVuSerif.ttf"), "Georgia.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    pages = json.load(sys.stdin)
    images = []
    for i, (title, lines) in enumerate(pages):
        img = Image.new("L", (1275, 1650), 246)   # a letter page at 150 dpi, slightly grey paper
        d = ImageDraw.Draw(img)
        d.text((90, 90), title, font=font(40, True), fill=20)
        y = 170
        for line in lines:
            bold = line in ("Ingredients", "Method")
            d.text((90, y), line, font=font(24, bold), fill=30)
            y += 38
        d.text((620, 1560), str(i + 1), font=font(22), fill=60)
        images.append(img.rotate(0.4, fillcolor=246))   # scans are never quite straight
    images[0].save(sys.argv[1], "PDF", resolution=150, save_all=True, append_images=images[1:])


if __name__ == "__main__":
    main()
