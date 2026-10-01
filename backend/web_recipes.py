"""Recipes from the web.

Search: DuckDuckGo's HTML endpoint (no key), or the Brave Search API (free key, more reliable).
Reading: most recipe sites embed a schema.org "Recipe" as JSON-LD for search engines; we read
that rather than scraping page layouts, so it works across thousands of sites.

Every fetched address is checked to be a public internet host, so a pasted link (or a redirect)
can't be used to reach devices on the home network.
"""
import asyncio
import html
import ipaddress
import json
import os
import re
import socket
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import parse_qs, urljoin, urlparse

import httpx

DDG_URL = os.getenv("NOURISH_DDG_URL", "https://html.duckduckgo.com/html/")
BRAVE_URL = "https://api.search.brave.com/res/v1/web/search"
USER_AGENT = "Mozilla/5.0 (compatible; Nourish meal planner; +https://github.com/nyz2x4pcqr-sudo/Nourish)"
MAX_PAGE_BYTES = 3 * 1024 * 1024
# Testing only: lets the test suite serve recipe pages from 127.0.0.1.
ALLOW_PRIVATE = os.getenv("NOURISH_ALLOW_PRIVATE_FETCH") == "1"
SKIP_HOSTS = ("youtube.com", "pinterest.", "facebook.com", "instagram.com", "tiktok.com", "reddit.com", "amazon.")


class WebRecipeError(Exception):
    pass


# --- safety -------------------------------------------------------------------------------

async def check_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise WebRecipeError("Only http(s) web addresses are supported")
    if ALLOW_PRIVATE:
        return
    try:
        infos = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, None)
    except OSError:
        raise WebRecipeError(f"Couldn't find the website {parsed.hostname}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if not ip.is_global:
            raise WebRecipeError("That address points to a private network, so it was blocked")


async def fetch_page(client: httpx.AsyncClient, url: str) -> tuple:
    """GET with manual redirects so every hop is checked. Returns (final_url, text)."""
    for _ in range(5):
        await check_public_url(url)
        async with client.stream("GET", url) as res:
            if res.status_code in (301, 302, 303, 307, 308) and res.headers.get("location"):
                url = urljoin(url, res.headers["location"])
                continue
            if res.status_code >= 400:
                raise WebRecipeError(f"The page returned HTTP {res.status_code}")
            body = bytearray()
            async for chunk in res.aiter_bytes():
                body += chunk
                if len(body) > MAX_PAGE_BYTES:
                    break
            return url, body.decode(res.encoding or "utf-8", errors="replace")
    raise WebRecipeError("Too many redirects")


# --- search -------------------------------------------------------------------------------

class _DDGParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "a" and "result__a" in (a.get("class") or "") and a.get("href"):
            href = a["href"]
            if "uddg=" in href:  # DuckDuckGo wraps results: //duckduckgo.com/l/?uddg=<real url>
                href = parse_qs(urlparse(href).query).get("uddg", [href])[0]
            if href.startswith("//"):
                href = "https:" + href
            self.links.append(href)


async def search(client: httpx.AsyncClient, query: str, brave_key: Optional[str] = None, count: int = 15) -> list:
    if brave_key:
        res = await client.get(BRAVE_URL, params={"q": query, "count": min(count, 20)},
                               headers={"X-Subscription-Token": brave_key, "Accept": "application/json"})
        if res.status_code in (401, 403, 422):
            raise WebRecipeError("Brave Search rejected the API key. Check it in Settings → Recipe sources.")
        if res.status_code == 429:
            raise WebRecipeError("Brave Search rate limit reached. Try again in a minute.")
        if res.status_code >= 400:
            raise WebRecipeError(f"Brave Search returned {res.status_code}")
        urls = [r.get("url") for r in (res.json().get("web") or {}).get("results") or []]
    else:
        res = await client.post(DDG_URL, data={"q": query}, headers={"Referer": "https://html.duckduckgo.com/"})
        if res.status_code in (202, 403, 429):
            raise WebRecipeError("DuckDuckGo is limiting searches right now. Wait a few minutes, or add a free Brave Search key in Settings.")
        if res.status_code >= 400:
            raise WebRecipeError(f"DuckDuckGo returned {res.status_code}")
        parser = _DDGParser()
        parser.feed(res.text)
        urls = parser.links
    seen, out = set(), []
    for u in urls:
        host = (urlparse(u or "").hostname or "").lower()
        if not host or any(s in host for s in SKIP_HOSTS) or u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out[:count]


# --- reading a recipe page ----------------------------------------------------------------

class _JsonLdParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.blocks, self._in, self._buf = [], False, []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and (dict(attrs).get("type") or "").lower().strip() == "application/ld+json":
            self._in, self._buf = True, []

    def handle_data(self, data):
        if self._in:
            self._buf.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self._in:
            self.blocks.append("".join(self._buf))
            self._in = False


def _is_recipe(node) -> bool:
    t = node.get("@type") if isinstance(node, dict) else None
    return t == "Recipe" or (isinstance(t, list) and "Recipe" in t)


def _find_recipe(data):
    if isinstance(data, list):
        for item in data:
            found = _find_recipe(item)
            if found:
                return found
    elif isinstance(data, dict):
        if _is_recipe(data):
            return data
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in data:
                found = _find_recipe(data[key])
                if found:
                    return found
    return None


def _clean(text) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", str(text or "")))
    return re.sub(r"\s+", " ", text).strip()


def _minutes(iso) -> Optional[int]:
    m = re.match(r"^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?", str(iso or "").strip().upper())
    if not m or not any(m.groups()):
        return None
    d, h, mins = (int(x or 0) for x in m.groups())
    return d * 1440 + h * 60 + mins or None


def _number(value) -> Optional[float]:
    m = re.search(r"\d+(?:\.\d+)?", str(value or "").replace(",", ""))
    return float(m.group()) if m else None


def _steps(instr) -> list:
    out = []
    if isinstance(instr, str):
        parts = re.split(r"\n+|(?<=\.)\s+(?=[A-Z])", _clean_keep_lines(instr))
        return [p.strip() for p in parts if len(p.strip()) > 3]
    for item in instr or []:
        if isinstance(item, str):
            out.append(_clean(item))
        elif isinstance(item, dict):
            if item.get("itemListElement"):
                out.extend(_steps(item["itemListElement"]))
            else:
                out.append(_clean(item.get("text") or item.get("name")))
    return [s for s in out if s]


def _clean_keep_lines(text) -> str:
    text = re.sub(r"<br\s*/?>|</p>|</li>", "\n", str(text), flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", text))


def parse_recipe(page_html: str, url: str) -> Optional[dict]:
    parser = _JsonLdParser()
    parser.feed(page_html)
    recipe = None
    for block in parser.blocks:
        try:
            data = json.loads(block.strip())
        except ValueError:
            try:  # some sites leave trailing commas or control characters
                data = json.loads(re.sub(r",\s*([}\]])", r"\1", block.strip()), strict=False)
            except ValueError:
                continue
        recipe = _find_recipe(data)
        if recipe:
            break
    if not recipe or not recipe.get("name"):
        return None
    ingredients = [_clean(i) for i in (recipe.get("recipeIngredient") or recipe.get("ingredients") or []) if _clean(i)]
    steps = _steps(recipe.get("recipeInstructions"))
    if not ingredients and not steps:
        return None
    total = _minutes(recipe.get("totalTime")) or ((_minutes(recipe.get("prepTime")) or 0) + (_minutes(recipe.get("cookTime")) or 0)) or None
    n = recipe.get("nutrition") if isinstance(recipe.get("nutrition"), dict) else {}
    nutrition = {"calories": _number(n.get("calories")), "protein_g": _number(n.get("proteinContent")),
                 "carbs_g": _number(n.get("carbohydrateContent")), "fat_g": _number(n.get("fatContent"))}
    return {
        "name": _clean(recipe["name"])[:150],
        "time_minutes": total,
        "nutrition": nutrition if any(v is not None for v in nutrition.values()) else None,
        "ingredients": ingredients[:40],
        "steps": steps[:30],
        "source_url": url,
        "source_name": (urlparse(url).hostname or "").removeprefix("www."),
    }


async def fetch_recipe(client: httpx.AsyncClient, url: str) -> dict:
    final_url, text = await fetch_page(client, url)
    recipe = parse_recipe(text, final_url)
    if not recipe:
        raise WebRecipeError("No recipe was found on that page (it needs to be a single recipe, not a list or a video).")
    return recipe


def new_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(12, connect=8), follow_redirects=False,
                             headers={"User-Agent": USER_AGENT, "Accept-Language": "en"})


async def search_recipes(query: str, exclude: list, number: int = 7, brave_key: Optional[str] = None) -> dict:
    async with new_client() as client:
        try:
            urls = await search(client, query, brave_key, count=max(number * 2, 10))
        except httpx.HTTPError as e:
            raise WebRecipeError(f"The search engine couldn't be reached ({type(e).__name__})")
        if not urls:
            raise WebRecipeError("The web search found nothing. Try different foods.")
        sem = asyncio.Semaphore(6)

        async def one(u):
            async with sem:
                try:
                    return await asyncio.wait_for(fetch_recipe(client, u), 20)
                except (WebRecipeError, httpx.HTTPError, asyncio.TimeoutError, ValueError):
                    return None

        results = await asyncio.gather(*(one(u) for u in urls))
    recipes, names = [], set()
    for r in results:
        if not r or r["name"].lower() in names:
            continue
        text = (r["name"] + " " + " ".join(r["ingredients"])).lower()
        if any(word in text for word in exclude):
            continue
        names.add(r["name"].lower())
        recipes.append(r)
    return {"recipes": recipes[:number], "pages_checked": len(urls)}
