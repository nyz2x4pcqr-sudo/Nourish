"""Draws the Nourish app icon (a plate on orange) as PNGs, using only the standard library.
Run from the repo root:  python mobile/make_icons.py"""
import struct
import zlib
from pathlib import Path

ORANGE, PLATE, RIM, LEAF = (255, 112, 67), (255, 255, 255), (255, 224, 214), (124, 179, 66)


def pixel(x, y):
    """Colour at (x, y) in a 0..1 square."""
    dx, dy = x - 0.5, y - 0.5
    r2 = dx * dx + dy * dy
    lx, ly = (x - 0.68) / 0.11, (y - 0.30) / 0.055   # leaf: a tilted ellipse
    lx, ly = (lx + ly) * 0.7071, (ly - lx) * 0.7071
    if lx * lx + ly * ly <= 1:
        return LEAF
    if r2 <= 0.20 ** 2:
        return RIM
    if r2 <= 0.33 ** 2:
        return PLATE
    return ORANGE


def png(size, path, ss=3):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            acc = [0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = pixel((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    acc = [a + b for a, b in zip(acc, c)]
            row += bytes(v // (ss * ss) for v in acc)
        rows.append(bytes(row))
    raw = zlib.compress(b"".join(rows), 9)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
                           + chunk(b"IDAT", raw) + chunk(b"IEND", b""))


if __name__ == "__main__":
    png(192, "icon-192.png")
    png(512, "icon-512.png")
    png(180, "apple-touch-icon.png")
    png(1024, "mobile/ios/Nourish/Assets.xcassets/AppIcon.appiconset/icon-1024.png", ss=2)
    print("icons written")
