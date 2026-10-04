"""Shared app data kept on the PC, so every device (browser, iPhone app, Android app) sees the
same settings, meal plan, grocery list and chat.

Each section has a revision number that goes up on every save. Devices compare revision numbers
instead of clocks (a phone's clock and the PC's clock rarely agree).

API keys are stored here but never sent back out: devices only learn whether a key is set.
"""
import json
import os
import threading
import time
from pathlib import Path

SECTIONS = {"settings", "prefs", "plan", "grocery", "chat", "cookbook", "log", "taste", "books"}
SECRET_FIELDS = {"claude_api_key", "openai_api_key", "spoonacular_api_key", "brave_api_key"}
MAX_SECTION_BYTES = 2 * 1024 * 1024
# The recipes saved from the person's books (thousands of full recipes) are allowed more room.
MAX_SECTION_BYTES_FOR = {"books": 60 * 1024 * 1024}
DATA_FILE = Path(os.getenv("NOURISH_DATA_FILE", "nourish-data.json"))

_lock = threading.Lock()
_data = {}  # section -> {"rev": int, "updated": float, "value": any}


class StoreError(Exception):
    pass


def _load():
    global _data
    try:
        raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        _data = {k: v for k, v in raw.items() if k in SECTIONS and isinstance(v, dict)}
    except FileNotFoundError:
        _data = {}
    except (OSError, ValueError):
        # A damaged file shouldn't stop the app; keep it for inspection and start fresh.
        try:
            DATA_FILE.rename(DATA_FILE.with_suffix(".damaged.json"))
        except OSError:
            pass
        _data = {}


def _save():
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, DATA_FILE)  # atomic: a crash mid-save never leaves a half-written file


def _public(section: str, entry: dict) -> dict:
    value = entry.get("value")
    if section == "settings" and isinstance(value, dict):
        secrets = value.get("_secrets", {})
        value = {k: v for k, v in value.items() if k != "_secrets"}
        value["_secrets_set"] = {name: bool(secrets.get(name)) for name in SECRET_FIELDS}
    return {"rev": entry.get("rev", 0), "updated": entry.get("updated"), "value": value}


def get_all() -> dict:
    with _lock:
        return {name: _public(name, entry) for name, entry in _data.items()}


def put(section: str, value) -> dict:
    if section not in SECTIONS:
        raise StoreError(f"Unknown section: {section}")
    if len(json.dumps(value)) > MAX_SECTION_BYTES_FOR.get(section, MAX_SECTION_BYTES):
        raise StoreError("That's too much data to save")
    with _lock:
        entry = _data.get(section, {"rev": 0})
        if section == "settings":
            if not isinstance(value, dict):
                raise StoreError("Settings must be an object")
            old = entry.get("value") or {}
            secrets = dict(old.get("_secrets", {}))
            value = dict(value)
            value.pop("_secrets_set", None)
            value.pop("_secrets", None)
            for name in SECRET_FIELDS:
                new = value.pop(name, None)
                if isinstance(new, str) and new.strip():
                    secrets[name] = new.strip()  # an empty or missing key means "keep what's saved"
            for name in value.pop("_clear", None) or []:  # explicit "remove this key"
                if name in SECRET_FIELDS:
                    secrets.pop(name, None)
            value["_secrets"] = secrets
        entry = {"rev": entry.get("rev", 0) + 1, "updated": time.time(), "value": value}
        _data[section] = entry
        _save()
        return _public(section, entry)


def secret(name: str) -> str:
    with _lock:
        return ((_data.get("settings") or {}).get("value") or {}).get("_secrets", {}).get(name, "")


def reset_for_tests(path: Path):
    global DATA_FILE
    with _lock:
        DATA_FILE = path
        _load()


_load()
