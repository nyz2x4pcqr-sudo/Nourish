"""The personal recipe library on the PC: two folders next to Nourish's data file
(Nourish/Recipe Books and Nourish/My Recipes) where people drop cookbooks and recipe files.
The app lists and reads them through /api/library and turns them into recipes (library.js)."""
import base64
import os
import subprocess
import sys
from pathlib import Path

import store

FOLDERS = ("Recipe Books", "My Recipes")
KINDS = {".txt": "text", ".text": "text", ".md": "text", ".markdown": "text", ".html": "html", ".htm": "html",
         ".mhtml": "html", ".webarchive": "html", ".pdf": "pdf", ".jpg": "image", ".jpeg": "image", ".png": "image",
         ".heic": "image", ".webp": "image"}
MAX_FILE_BYTES = 40 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000


class LibraryError(Exception):
    pass


def root() -> Path:
    base = os.getenv("NOURISH_LIBRARY_DIR")
    folder = Path(base) if base else store.DATA_FILE.resolve().parent / "Nourish"
    for name in FOLDERS:
        (folder / name).mkdir(parents=True, exist_ok=True)
    return folder


def list_files():
    base = root()
    files = []
    for name in FOLDERS:
        for path in sorted((base / name).rglob("*")):
            if path.is_file() and path.suffix.lower() in KINDS and not path.name.startswith("."):
                st = path.stat()
                files.append({"path": path.relative_to(base).as_posix(), "folder": name, "size": st.st_size, "mtime": int(st.st_mtime)})
    return {"folder": str(base), "files": files[:2000]}


def _resolve(rel: str) -> Path:
    base = root().resolve()
    path = (base / rel).resolve()
    if base not in path.parents or not path.is_file():   # nothing outside the library folders
        raise LibraryError("That file isn't in the recipe library.")
    return path


def pdf_text(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    reader = PdfReader(str(path))
    parts, size = [], 0
    for page in reader.pages[:600]:
        text = page.extract_text() or ""
        parts.append(text)
        size += len(text)
        if size > MAX_TEXT_CHARS:
            break
    return "\n".join(parts)


def read_file(rel: str):
    path = _resolve(rel)
    if path.stat().st_size > MAX_FILE_BYTES:
        raise LibraryError("That file is too big to read (over 40 MB).")
    kind = KINDS.get(path.suffix.lower())
    if kind == "text":
        return {"kind": "text", "text": path.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_CHARS]}
    if kind == "html":
        return {"kind": "html", "html": path.read_text(encoding="utf-8", errors="replace")[:MAX_TEXT_CHARS]}
    if kind == "pdf":
        text = pdf_text(path)
        return {"kind": "pdf", "text": text, "note": "" if text else "No text could be read from this PDF (a scanned book needs the iPhone app, which can read pictures)."}
    if kind == "image":
        return {"kind": "image", "image": base64.b64encode(path.read_bytes()).decode("ascii")}
    raise LibraryError("Nourish can't read that kind of file.")


def open_folder():
    """Shows the folder in the PC's file manager."""
    folder = str(root())
    if sys.platform.startswith("win"):
        os.startfile(folder)  # noqa: S606 (a folder we created)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", folder])
    else:
        subprocess.Popen(["xdg-open", folder])
    return {"folder": folder}
