"""Checks GitHub Releases for a newer Nourish and, in the Windows .exe, installs it.

Installing: download the new .exe next to the running one, check its SHA-256 against the
digest GitHub publishes, swap the files (Windows allows renaming a running .exe), start the
new copy and exit. The new copy waits for the port to be free, then deletes the old file.
"""
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

import httpx

REPO = "nyz2x4pcqr-sudo/Nourish"
API_URL = os.getenv("NOURISH_UPDATE_API", f"https://api.github.com/repos/{REPO}/releases")
ASSET_NAME = os.getenv("NOURISH_UPDATE_ASSET", "Nourish.exe")
FROZEN = getattr(sys, "frozen", False)
# Self-install only makes sense for the packaged Windows app. (The override exists for testing.)
INSTALL_SUPPORTED = FROZEN and (sys.platform == "win32" or os.getenv("NOURISH_UPDATE_ANY_OS") == "1")
MAX_DOWNLOAD_BYTES = 300 * 1024 * 1024
PRERELEASE_RANK = {"dev": 0, "pre-alpha": 1, "prealpha": 1, "alpha": 2, "beta": 3, "rc": 4}


def parse_version(text: str) -> Optional[tuple]:
    """'v0.2.0-pre-alpha' -> comparable tuple. Final releases sort after their pre-releases."""
    m = re.match(r"^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$", (text or "").strip())
    if not m:
        return None
    major, minor, patch, pre = m.groups()
    if pre is None:
        pre_key = (99, "")
    else:
        label = pre.lower()
        rank = next((r for k, r in sorted(PRERELEASE_RANK.items(), key=lambda kv: -len(kv[0])) if label.startswith(k)), 0)
        pre_key = (rank, label)
    return int(major), int(minor), int(patch), pre_key


class UpdateError(Exception):
    pass


async def fetch_latest(current: str, include_prereleases: bool = True) -> dict:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Nourish-updater"}
    try:
        async with httpx.AsyncClient(timeout=15, headers=headers) as client:
            res = await client.get(API_URL, params={"per_page": 30})
    except httpx.HTTPError as e:
        raise UpdateError(f"Couldn't reach GitHub to check for updates ({type(e).__name__})")
    if res.status_code == 403:
        raise UpdateError("GitHub's rate limit was hit. Try again in an hour.")
    if res.status_code >= 400:
        raise UpdateError(f"GitHub returned {res.status_code} while checking for updates")

    releases = []
    for release in res.json() or []:
        if release.get("draft") or (release.get("prerelease") and not include_prereleases):
            continue
        version = parse_version(release.get("tag_name", ""))
        if version:
            releases.append((version, release))

    info = {"current": current, "update_available": False, "can_install": False}
    cur = parse_version(current)
    if not releases:
        return info
    # Version numbers were reset once (0.7.0 was followed by 0.1.7), so the latest release is the
    # one published last, and an update is one published after this version's own release.
    # Without dates (or for a version that was never released) the highest number wins.
    dated = all(r.get("published_at") for _, r in releases)
    best = max(releases, key=(lambda vr: vr[1]["published_at"]) if dated else (lambda vr: vr[0]))
    release = best[1]
    info.update(latest=release["tag_name"].lstrip("vV"), url=release.get("html_url"),
                notes=(release.get("body") or "")[:4000], published=release.get("published_at"))
    if cur is None:
        return info
    mine = next((r for v, r in releases if v[:3] == cur[:3]), None)
    if dated and mine is not None:
        newer = release["published_at"] > mine["published_at"]
    else:
        newer = best[0] > cur
    if not newer:
        return info
    asset = next((a for a in release.get("assets") or [] if a.get("name") == ASSET_NAME), None)
    digest = (asset or {}).get("digest") or ""
    info["update_available"] = True
    if asset and digest.startswith("sha256:"):
        info["asset"] = {"url": asset["browser_download_url"], "size": asset.get("size"), "sha256": digest.split(":", 1)[1].lower()}
        info["can_install"] = INSTALL_SUPPORTED
    return info


async def download_and_swap(asset: dict) -> Path:
    """Downloads the new .exe, verifies it, and swaps it in place of the running one."""
    if not INSTALL_SUPPORTED:
        raise UpdateError("Automatic install only works in the Windows app. Download the new version from GitHub.")
    url = asset["url"]
    if not (url.startswith("https://") or os.getenv("NOURISH_UPDATE_API")):
        raise UpdateError("Refusing to download an update over an insecure connection")
    exe = Path(sys.executable).resolve()
    new = exe.with_name(f"{exe.stem}.new{exe.suffix}")
    old = exe.with_name(f"{exe.stem}.old{exe.suffix}")
    sha = hashlib.sha256()
    size = 0
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120, connect=15), follow_redirects=True,
                                     headers={"User-Agent": "Nourish-updater"}) as client:
            async with client.stream("GET", url) as res:
                if res.status_code >= 400:
                    raise UpdateError(f"Download failed: HTTP {res.status_code}")
                with open(new, "wb") as f:
                    async for chunk in res.aiter_bytes(1 << 16):
                        size += len(chunk)
                        if size > MAX_DOWNLOAD_BYTES:
                            raise UpdateError("Download is unexpectedly large; stopped")
                        sha.update(chunk)
                        f.write(chunk)
        if sha.hexdigest() != asset["sha256"]:
            raise UpdateError("The download didn't match GitHub's fingerprint, so it wasn't installed. Try again.")
        new.chmod(exe.stat().st_mode)  # keep the "executable" permission (matters outside Windows)
        if old.exists():
            old.unlink()
        exe.rename(old)
        new.rename(exe)
    except httpx.HTTPError as e:
        raise UpdateError(f"Download failed ({type(e).__name__})")
    finally:
        if new.exists():
            try:
                new.unlink()
            except OSError:
                pass
    return exe


def restart(exe: Path):
    """Starts the freshly installed copy in its own window; the caller then exits."""
    env = dict(os.environ, NOURISH_RESTARTED="1", NOURISH_NO_BROWSER="1", PYINSTALLER_RESET_ENVIRONMENT="1")
    env.pop("FRONTEND_DIR", None)  # points into this copy's temporary folder, which is deleted on exit
    kwargs = {"env": env, "cwd": str(exe.parent), "close_fds": True}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_CONSOLE
    else:
        # No console to open here, and the old one closes when this process exits: log to a file instead.
        out = open(exe.parent / "nourish-console.log", "ab")
        kwargs.update(start_new_session=True, stdin=subprocess.DEVNULL, stdout=out, stderr=subprocess.STDOUT)
    subprocess.Popen([str(exe)], **kwargs)
