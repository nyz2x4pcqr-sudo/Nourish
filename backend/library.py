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


README_NAME = "Read me.txt"
NOTE_NAMES = {"read me.txt", "readme.txt", "about these folders.txt"}   # Nourish's own notes, not recipes
READMES = {
    "Recipe Books": (
        "Recipe Books\n\n"
        "Drop cookbooks here: PDF files, text or Markdown files, saved web pages, or photos of pages.\n"
        "Nourish reads them in the background and learns from them: which ingredients go together,\n"
        "how dishes are seasoned and cooked. Their recipes can also turn up in your plans, next to\n"
        "recipes from other places.\n\n"
        "You can also add files from Nourish: Settings > Recipes > Add files.\n"
    ),
    "My Recipes": (
        "My Recipes\n\n"
        "Drop your own recipes here: family recipes, notes, saved web pages or photos of recipe cards.\n"
        "Each one needs a title, a list of ingredients and the steps.\n"
        "Nourish reads them in the background and can use them in your plans.\n\n"
        "You can also add files from Nourish: Settings > Recipes > Add files.\n"
    ),
}


def root() -> Path:
    base = os.getenv("NOURISH_LIBRARY_DIR")
    folder = Path(base) if base else store.DATA_FILE.resolve().parent / "Nourish"
    for name in FOLDERS:
        (folder / name).mkdir(parents=True, exist_ok=True)
        readme = folder / name / README_NAME
        if not readme.exists():
            try:
                readme.write_text(READMES[name], encoding="utf-8")
            except OSError:
                pass
    return folder


def add_file(name: str, data: bytes) -> str:
    """Saves a file chosen in the app (Settings > Recipes > Add files) into the library: big PDFs
    (probably books) into Recipe Books, everything else into My Recipes. Returns its library path."""
    clean = "".join("_" if c in '\\/:*?"<>|' or ord(c) < 32 else c for c in Path(str(name)).name).strip(" .")
    suffix = Path(clean).suffix.lower()
    if not clean or suffix not in KINDS:
        raise LibraryError("Nourish can't read that kind of file. Use PDF, text, Markdown, a saved web page or a photo.")
    if len(data) > MAX_FILE_BYTES:
        raise LibraryError("That file is too big (over 40 MB).")
    folder = root() / ("Recipe Books" if suffix == ".pdf" and len(data) > 3_000_000 else "My Recipes")
    dest, n = folder / clean, 2
    while dest.exists():
        dest = folder / f"{Path(clean).stem} {n}{suffix}"
        n += 1
    dest.write_bytes(data)
    return dest.relative_to(root()).as_posix()


def list_files():
    base = root()
    files = []
    for name in FOLDERS:
        for path in sorted((base / name).rglob("*")):
            if path.is_file() and path.suffix.lower() in KINDS and not path.name.startswith(".") and path.name.lower() not in NOTE_NAMES:
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
