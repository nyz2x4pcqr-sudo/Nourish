"""The free recipe and nutrition services (Settings → Recipe and nutrition services), called by the
PC on behalf of the app so the keys stay on the PC (store.py keeps them encrypted).

The app (crosscheck.js, finder.js) builds each request; this module only checks that it goes to
the service's own address and adds the key the way that service wants it:
- Edamam Nutrition Analysis: app_id and app_key in the query.
- FatSecret Platform (Basic): an OAuth 1.0 signature (HMAC-SHA1). OAuth 2.0 would need the PC's
  internet address registered with FatSecret, which changes at home; OAuth 1.0 doesn't.
- USDA FoodData Central: api_key in the query (the public DEMO_KEY when none is set).
- Spoonacular: the x-api-key header.
Only recipe and ingredient text is ever sent.
"""
import base64
import hashlib
import hmac
import secrets
import time
from urllib.parse import quote, urlsplit

HOSTS = {
    "edamam": {"api.edamam.com"},
    "fatsecret": {"platform.fatsecret.com"},
    "usda": {"api.nal.usda.gov"},
    "spoonacular": {"api.spoonacular.com"},
}
KEYS = {
    "edamam": ("edamam_app_id", "edamam_app_key"),
    "fatsecret": ("fatsecret_key", "fatsecret_secret"),
    "usda": ("usda_api_key",),
    "spoonacular": ("spoonacular_api_key",),
}


class ServiceError(Exception):
    pass


def check_url(service: str, url: str) -> str:
    parts = urlsplit(url)
    if service not in HOSTS:
        raise ServiceError(f"Unknown service: {service}")
    if parts.scheme != "https" or parts.hostname not in HOSTS[service] or parts.username or parts.port not in (None, 443):
        raise ServiceError(f"{service} requests can only go to {', '.join(sorted(HOSTS[service]))}")
    return f"https://{parts.hostname}{parts.path}"


def pct(s) -> str:
    return quote(str(s), safe="~-._")


def oauth1_sign(method: str, url: str, params: dict, consumer_key: str, consumer_secret: str, nonce: str = None, timestamp: str = None) -> dict:
    """The request's parameters with the OAuth 1.0 fields and signature added (RFC 5849, HMAC-SHA1)."""
    out = {k: str(v) for k, v in params.items() if v is not None}
    out.update({
        "oauth_consumer_key": consumer_key,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": timestamp or str(int(time.time())),
        "oauth_nonce": nonce or secrets.token_hex(12),
        "oauth_version": "1.0",
    })
    normalized = "&".join(f"{pct(k)}={pct(v)}" for k, v in sorted((pct(k), pct(v)) for k, v in out.items()))
    base = "&".join([method.upper(), pct(url), pct(normalized)])
    digest = hmac.new(f"{pct(consumer_secret)}&".encode(), base.encode(), hashlib.sha1).digest()
    out["oauth_signature"] = base64.b64encode(digest).decode()
    return out


def prepare(service: str, method: str, url: str, query: dict, headers: dict, keys: dict):
    """(url, query, headers) with the service's key added. keys: name → value from the store."""
    url = check_url(service, url)
    query = dict(query or {})
    headers = {k: v for k, v in (headers or {}).items() if k.lower() in ("content-type", "accept")}
    if service == "edamam":
        if not (keys.get("edamam_app_id") and keys.get("edamam_app_key")):
            raise ServiceError("Add your free Edamam Application ID and Key in Settings.")
        query.update({"app_id": keys["edamam_app_id"], "app_key": keys["edamam_app_key"]})
    elif service == "fatsecret":
        if not (keys.get("fatsecret_key") and keys.get("fatsecret_secret")):
            raise ServiceError("Add your free FatSecret Consumer Key and Consumer Secret in Settings.")
        query = oauth1_sign(method, url, query, keys["fatsecret_key"], keys["fatsecret_secret"])
    elif service == "usda":
        query["api_key"] = keys.get("usda_api_key") or "DEMO_KEY"
    elif service == "spoonacular":
        if not keys.get("spoonacular_api_key"):
            raise ServiceError("Add your free Spoonacular key in Settings.")
        headers["x-api-key"] = keys["spoonacular_api_key"]
    return url, query, headers


# Quota headers worth passing back (Spoonacular reports its daily points this way).
PASS_HEADERS = ("x-api-quota-used", "x-api-quota-left", "x-api-quota-request", "retry-after")
