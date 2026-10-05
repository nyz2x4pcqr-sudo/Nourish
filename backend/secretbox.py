"""API keys at rest on the PC: never in nourish-data.json in plain text.

Each key is encrypted with a random 256-bit key kept in a separate file next to the data file
(".nourish-key", readable only by you), so copying or syncing nourish-data.json never carries a
usable key. Standard library only: a SHA-256 keystream (counter mode) for the encryption and
HMAC-SHA256 so a damaged or altered value is refused instead of read wrongly.
"""
import base64
import hashlib
import hmac
import os
import secrets as _secrets
from pathlib import Path

PREFIX = "enc1:"


def _master(path: Path) -> bytes:
    try:
        key = path.read_bytes()
        if len(key) == 32:
            return key
    except OSError:
        pass
    key = _secrets.token_bytes(32)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(key)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return key


def _keys(path: Path):
    m = _master(path)
    return hashlib.sha256(b"nourish-enc" + m).digest(), hashlib.sha256(b"nourish-mac" + m).digest()


def _stream(key: bytes, nonce: bytes, n: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < n:
        out += hashlib.sha256(key + nonce + counter.to_bytes(8, "big")).digest()
        counter += 1
    return bytes(out[:n])


def seal(text: str, keyfile: Path) -> str:
    if not text:
        return ""
    if text.startswith(PREFIX):
        return text
    enc, mac = _keys(keyfile)
    nonce = _secrets.token_bytes(16)
    data = text.encode("utf-8")
    body = bytes(a ^ b for a, b in zip(data, _stream(enc, nonce, len(data))))
    tag = hmac.new(mac, nonce + body, hashlib.sha256).digest()
    return PREFIX + base64.b64encode(nonce + body + tag).decode("ascii")


def open_(token: str, keyfile: Path) -> str:
    """The plain key, or "" when the value can't be opened (a different PC's key file, damage)."""
    if not token:
        return ""
    if not token.startswith(PREFIX):
        return token  # saved by an older version, before keys were encrypted
    try:
        raw = base64.b64decode(token[len(PREFIX):])
        nonce, body, tag = raw[:16], raw[16:-32], raw[-32:]
        enc, mac = _keys(keyfile)
        if not hmac.compare_digest(tag, hmac.new(mac, nonce + body, hashlib.sha256).digest()):
            return ""
        return bytes(a ^ b for a, b in zip(body, _stream(enc, nonce, len(body)))).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        return ""
