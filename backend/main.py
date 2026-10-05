from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
import asyncio
import base64
import binascii
import logging
import os
import socket
import sys
import time
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import httpx

import library
import services
import store
import updater
import web_recipes

load_dotenv()

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("./nourish.log", mode="a"),
    ],
)
logger = logging.getLogger("nourish")
# httpx logs full request URLs at INFO, which can include query-string API keys.
logging.getLogger("httpx").setLevel(logging.WARNING)

VERSION = "0.1.13-pre-alpha"
PORT = int(os.getenv("NOURISH_PORT", "8000"))
LMSTUDIO_URL = os.getenv("LMSTUDIO_URL", "http://localhost:1234").rstrip("/")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
THEMEALDB_URL = os.getenv("THEMEALDB_URL", "https://www.themealdb.com/api/json/v1/1").rstrip("/")
SPOONACULAR_URL = os.getenv("SPOONACULAR_URL", "https://api.spoonacular.com").rstrip("/")
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", Path(__file__).resolve().parent.parent))
# Only these files are served. Never mount the repo root as a static directory:
# it would expose backend/.env and .git to anyone on the network.
FRONTEND_FILES = {"index.html", "app.js", "ondevice.js", "json-repair.js", "grocery.js", "units.js", "recipes.js", "importer.js", "nutrition-data.js", "nutrition.js", "services.js", "crosscheck.js", "prefs.js", "planner.js", "sources.js", "finder.js", "library.js", "books.js", "recipedb.js", "foodlog.js", "taste.js", "builtins.js", "theme.js", "font-inter.woff2", "font-source-serif.woff2", "font-source-sans.woff2", "font-nunito.woff2", "font-manrope.woff2", "app-icon-default.png", "app-icon-midnight.png", "app-icon-forest.png", "app-icon-plum.png", "app-icon-paper.png", "app-icon-oled.png", "styles.css", "font-fraunces.woff2", "font-figtree.woff2",
                  "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"}

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Nourish starting. LM Studio: {LMSTUDIO_URL}  Ollama: {OLLAMA_URL}  Frontend: {FRONTEND_DIR}")
    asyncio.get_running_loop().run_in_executor(None, lan_urls)  # warm the cache without delaying startup
    yield


app = FastAPI(title="Nourish API", lifespan=lifespan)

# Allow the page when it is opened from this PC or from another device on the home
# network (phone), on any port. Everything else (random websites) is refused.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^https?://("
        r"localhost|127\.0\.0\.1|\[::1\]"
        r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
        r"|192\.168\.\d{1,3}\.\d{1,3}"
        r"|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
        r"|[A-Za-z0-9-]+\.local"
        r")(:\d+)?$"
    ),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)


class GenerateRequest(BaseModel):
    provider: str
    model: str
    messages: list
    api_key: Optional[str] = None
    max_tokens: Optional[int] = 8000
    temperature: Optional[float] = None


class WebRecipeRequest(BaseModel):
    query: str
    exclude: Optional[str] = ""
    number: Optional[int] = 7
    brave_key: Optional[str] = None
    engine: Optional[str] = None  # "duckduckgo" skips a Brave key saved on the PC


class ImportRequest(BaseModel):
    url: str


class LibraryReadRequest(BaseModel):
    path: str


class FetchRequest(BaseModel):
    url: str
    browser: bool = True


class RecipeSearchRequest(BaseModel):
    query: str
    exclude: Optional[str] = ""
    number: Optional[int] = 21
    api_key: Optional[str] = None
    diet: Optional[str] = None
    intolerances: Optional[str] = None
    max_ready_time: Optional[int] = None


def upstream_error(res: httpx.Response, who: str) -> HTTPException:
    """Turn a provider's error response into a short message the UI can show."""
    try:
        body = res.json()
        err = body.get("error") if isinstance(body, dict) else None
        msg = (err.get("message") if isinstance(err, dict) else err) or body.get("message") or body.get("detail")
    except Exception:
        msg = None
    msg = str(msg or res.text[:200] or res.reason_phrase)
    status = res.status_code if res.status_code in (400, 401, 402, 403, 404, 429) else 502
    return HTTPException(status_code=status, detail=f"{who} returned {res.status_code}: {msg}")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/{name}")
def frontend_file(name: str):
    if name not in FRONTEND_FILES:
        raise HTTPException(status_code=404)
    return FileResponse(FRONTEND_DIR / name)


_lan_cache = {"at": 0.0, "urls": []}


def lan_urls() -> list:
    """Addresses a phone on the same Wi-Fi can use to open the app (cached for a minute)."""
    if time.time() - _lan_cache["at"] > 60:
        _lan_cache.update(at=time.time(), urls=_find_lan_urls())
    return _lan_cache["urls"]


def _find_lan_urls() -> list:
    if os.path.exists("/.dockerenv"):
        return []  # inside Docker we only see the container's own address
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))  # no packet is sent; this just picks the LAN interface
            ips.add(sock.getsockname()[0])
    except OSError:
        pass
    # Looking up our own hostname can stall for ~5 s on some machines (mDNS), so only do it
    # when the quick method above found nothing.
    if not ips:
        try:
            ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
        except OSError:
            pass
    private = [ip for ip in ips if ip.startswith(("192.168.", "10.")) or
               (ip.startswith("172.") and 16 <= int(ip.split(".")[1]) <= 31)]
    return [f"http://{ip}:{PORT}" for ip in sorted(private)]


@app.get("/api/info")
def info():
    return {
        "version": VERSION,
        "lmstudio_url": LMSTUDIO_URL,
        "ollama_url": OLLAMA_URL,
        "in_docker": os.path.exists("/.dockerenv"),
        "can_self_update": updater.INSTALL_SUPPORTED,
        "lan_urls": lan_urls(),
    }


@app.get("/api/models")
async def get_models(provider: str = "lmstudio"):
    """Models the local AI app has available, as {"data": [{"id": ...}]}."""
    if provider not in ("lmstudio", "ollama"):
        raise HTTPException(status_code=400, detail="Model lists are only available for LM Studio and Ollama")
    who, url = ("LM Studio", f"{LMSTUDIO_URL}/v1/models") if provider == "lmstudio" else ("Ollama", f"{OLLAMA_URL}/api/tags")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(url)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"{who} not reachable at {url.rsplit('/', 2)[0]} ({type(e).__name__})")
    if res.status_code >= 400:
        raise upstream_error(res, who)
    data = res.json()
    if provider == "ollama":
        data = {"data": [{"id": m.get("name")} for m in data.get("models") or [] if m.get("name")]}
    return data


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    return await call_provider(req)


async def call_provider(req: GenerateRequest) -> dict:
    logger.info(f"Generate request - provider: {req.provider}, model: {req.model}, messages: {len(req.messages)}")
    if req.provider in ("lmstudio", "ollama"):
        base = LMSTUDIO_URL if req.provider == "lmstudio" else OLLAMA_URL
        who = "LM Studio" if req.provider == "lmstudio" else "Ollama"
        url = f"{base}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens}
    elif req.provider == "openai":
        key = req.api_key or store.secret("openai_api_key") or os.getenv("OPENAI_API_KEY")
        if not key:
            raise HTTPException(status_code=400, detail="No OpenAI API key. Add one in Settings.")
        who, url = "OpenAI", "https://api.openai.com/v1/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
        body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens}
    elif req.provider == "claude":
        key = req.api_key or store.secret("claude_api_key") or os.getenv("ANTHROPIC_API_KEY")
        if not key:
            raise HTTPException(status_code=400, detail="No Claude API key. Add one in Settings.")
        who, url = "Claude", "https://api.anthropic.com/v1/messages"
        headers = {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"}
        # The Messages API takes the system prompt as a top-level field, not as a message.
        system = "\n\n".join(m.get("content", "") for m in req.messages if m.get("role") == "system")
        body = {"model": req.model, "max_tokens": req.max_tokens,
                "messages": [m for m in req.messages if m.get("role") != "system"]}
        if system:
            body["system"] = system
    else:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {req.provider}")
    body["temperature"] = 0.7 if req.temperature is None else max(0.0, min(req.temperature, 1.0 if req.provider == "claude" else 2.0))

    try:
        # Local models can take many minutes for a full week of recipes.
        async with httpx.AsyncClient(timeout=httpx.Timeout(900, connect=10)) as client:
            res = await client.post(url, json=body, headers=headers)
    except httpx.HTTPError as e:
        # Never include headers here; the message can end up in the UI.
        logger.error(f"Generate error - {who} unreachable: {type(e).__name__}: {e}")
        raise HTTPException(status_code=503, detail=f"{who} not reachable at {url.rsplit('/v1/', 1)[0]} ({type(e).__name__})")
    if res.status_code >= 400:
        logger.error(f"Generate error - {who} status {res.status_code}")
        raise upstream_error(res, who)
    logger.info(f"Generate successful - provider: {req.provider}")
    return res.json()


# Background jobs: generation can take minutes with a local model, longer than a phone
# keeps a single request alive when the screen locks. The app starts a job, then polls.
JOBS: dict = {}
JOB_TTL_SECONDS = 3600


def _prune_jobs():
    now = time.time()
    for job_id in [j for j, job in JOBS.items() if job.get("finished") and now - job["finished"] > JOB_TTL_SECONDS]:
        JOBS.pop(job_id, None)


@app.post("/api/jobs")
async def start_job(req: GenerateRequest):
    _prune_jobs()
    job_id = uuid.uuid4().hex
    job = {"status": "running", "started": time.time()}
    JOBS[job_id] = job

    async def run():
        try:
            job["result"] = await call_provider(req)
            job["status"] = "done"
        except HTTPException as e:
            job.update(status="error", status_code=e.status_code, detail=e.detail)
        except asyncio.CancelledError:
            job.update(status="error", status_code=499, detail="Cancelled")
        except Exception as e:
            logger.error(f"Job {job_id} failed: {type(e).__name__}: {e}")
            job.update(status="error", status_code=500, detail="Unexpected server error (see server log)")
        finally:
            job["finished"] = time.time()

    job["task"] = asyncio.create_task(run())  # keep a reference so it isn't garbage-collected
    return {"job_id": job_id}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="That request is no longer on the server (was it restarted?). Please try again.")
    out = {"status": job["status"], "elapsed": round((job.get("finished") or time.time()) - job["started"], 1)}
    for key in ("result", "detail", "status_code"):
        if key in job:
            out[key] = job[key]
    return out


@app.delete("/api/jobs/{job_id}")
def cancel_job(job_id: str):
    job = JOBS.get(job_id)
    if job and job["status"] == "running":
        job["task"].cancel()
    return {"cancelled": job_id}


class ServiceRequest(BaseModel):
    service: str
    method: str = "GET"
    url: str
    query: Optional[dict] = None
    body: Optional[object] = None
    headers: Optional[dict] = None


@app.post("/api/services/request")
async def service_request(req: ServiceRequest):
    """One request to a free recipe or nutrition service, with the key the PC keeps (services.py).
    The answer comes back as it is ({status, body, headers}); the app reads it."""
    if req.method.upper() not in ("GET", "POST"):
        raise HTTPException(status_code=400, detail="Only GET and POST")
    keys = {name: store.secret(name) for name in services.KEYS.get(req.service, ())}
    try:
        url, query, headers = services.prepare(req.service, req.method, req.url, req.query, req.headers, keys)
    except services.ServiceError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            if req.method.upper() == "POST":
                res = await client.post(url, params=query, json=req.body, headers=headers)
            else:
                res = await client.get(url, params=query, headers=headers)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"{req.service} not reachable ({type(e).__name__})")
    # Logged without the query (it holds keys or signatures).
    logger.info("service %s %s %s → %s", req.service, req.method.upper(), url, res.status_code)
    return {"status": res.status_code, "body": res.text[:2_000_000],
            "headers": {k: res.headers[k] for k in services.PASS_HEADERS if k in res.headers}}


@app.post("/api/recipes/themealdb")
async def recipes_themealdb(req: RecipeSearchRequest):
    terms = [t.strip() for t in req.query.split(",") if t.strip()] or ["chicken"]
    meals, seen = [], set()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            for term in terms[:5]:
                res = await client.get(f"{THEMEALDB_URL}/search.php", params={"s": term})
                if res.status_code >= 400:
                    raise upstream_error(res, "TheMealDB")
                for m in (res.json() or {}).get("meals") or []:
                    if m.get("idMeal") not in seen:
                        seen.add(m.get("idMeal"))
                        meals.append(m)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"TheMealDB not reachable ({type(e).__name__})")
    avoid = [t.strip().lower() for t in (req.exclude or "").split(",") if t.strip()]
    if avoid:
        meals = [m for m in meals if not any(a in str(m).lower() for a in avoid)]
    return {"meals": meals[: req.number]}


@app.post("/api/recipes/spoonacular")
async def recipes_spoonacular(req: RecipeSearchRequest):
    key = req.api_key or store.secret("spoonacular_api_key") or os.getenv("SPOONACULAR_API_KEY")
    if not key:
        raise HTTPException(status_code=400, detail="Spoonacular needs a free API key. Add one in Settings.")
    params = {
        "query": req.query.split(",")[0].strip() or "chicken",
        "excludeIngredients": req.exclude or "",
        "number": req.number,
        "addRecipeInformation": "true",
        "addRecipeNutrition": "true",
        "fillIngredients": "true",
    }
    if req.diet:
        params["diet"] = req.diet
    if req.intolerances:
        params["intolerances"] = req.intolerances
    if req.max_ready_time:
        params["maxReadyTime"] = req.max_ready_time
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            # Key goes in a header, not the URL, so it never appears in access logs.
            res = await client.get(f"{SPOONACULAR_URL}/recipes/complexSearch", params=params, headers={"x-api-key": key})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"Spoonacular not reachable ({type(e).__name__})")
    if res.status_code >= 400:
        raise upstream_error(res, "Spoonacular")
    return res.json()


@app.post("/api/recipes/web")
async def recipes_web(req: WebRecipeRequest):
    logger.info(f"Web recipe search - query length: {len(req.query)}")
    exclude = [w.strip().lower() for w in (req.exclude or "").split(",") if w.strip()]
    try:
        return await web_recipes.search_recipes(req.query, exclude, max(1, min(req.number or 7, 21)),
                                                None if req.engine == "duckduckgo" else
                                                req.brave_key or store.secret("brave_api_key") or os.getenv("BRAVE_API_KEY"))
    except web_recipes.WebRecipeError as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/api/recipes/import")
async def recipes_import(req: ImportRequest):
    url = req.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    try:
        async with web_recipes.new_client() as client:
            return await web_recipes.fetch_recipe(client, url)
    except web_recipes.WebRecipeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Couldn't load that page ({type(e).__name__})")


@app.post("/api/web/fetch")
async def web_fetch(req: FetchRequest):
    """A public web page for the app's recipe importer (importer.js), which reads it in the browser:
    the same code then works on the PC and on the phone, which fetches pages itself."""
    url = req.url.strip()
    if not url.lower().startswith(("http://", "https://")):
        url = "https://" + url
    try:
        async with web_recipes.new_client() as client:
            return await web_recipes.fetch_raw(client, url, browser=req.browser)
    except web_recipes.WebRecipeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Couldn't load that page ({type(e).__name__})")


# --- the personal recipe library (folders next to the data file) ------------------------------------

@app.get("/api/library")
def library_list():
    return library.list_files()


@app.post("/api/library/read")
def library_read(req: LibraryReadRequest):
    try:
        return library.read_file(req.path)
    except library.LibraryError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't read that file ({type(e).__name__})")


class LibraryRangeRequest(BaseModel):
    path: str = Field(max_length=2000)
    offset: int = Field(ge=0)
    length: int = Field(ge=0, le=8 * 1024 * 1024)


@app.post("/api/library/range")
def library_range(req: LibraryRangeRequest):
    try:
        return library.read_range(req.path, req.offset, req.length)
    except library.LibraryError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't read that file ({type(e).__name__})")


class LibraryPdfRequest(BaseModel):
    path: str = Field(max_length=2000)
    start: int = Field(default=0, ge=0, alias="from")
    count: int = Field(default=0, ge=0, le=40)
    ocr: bool = True


@app.post("/api/library/pdf")
def library_pdf(req: LibraryPdfRequest):
    try:
        return library.read_pdf_pages(req.path, req.start, req.count)
    except library.LibraryError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't read that file ({type(e).__name__})")


class LibraryAddRequest(BaseModel):
    name: str = Field(max_length=300)
    data: str = Field(max_length=560_000_000)   # base64 of at most 400 MB (a book; other files 40 MB)


@app.post("/api/library/add")
def library_add(req: LibraryAddRequest):
    try:
        raw = base64.b64decode(req.data, validate=True)
    except (ValueError, binascii.Error):
        raise HTTPException(status_code=400, detail="That file didn't arrive in one piece. Try again.")
    try:
        return {"added": 1, "path": library.add_file(req.name, raw), "folder": str(library.root())}
    except library.LibraryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't save that file ({type(e).__name__})")


@app.post("/api/library/open")
def library_open(request: Request):
    # Only for someone sitting at the PC: a phone can't see the PC's screen.
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        return {"folder": str(library.root()), "opened": False}
    try:
        return dict(library.open_folder(), opened=True)
    except OSError:
        return {"folder": str(library.root()), "opened": False}


# --- shared data (settings, plan, grocery list, chat, cookbook) --------------------------------------

@app.get("/api/state")
def state_get():
    return store.get_all()


@app.put("/api/state/{section}")
async def state_put(section: str, request: Request):
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(status_code=400, detail="Expected JSON")
    if not isinstance(body, dict) or "value" not in body:
        raise HTTPException(status_code=400, detail='Expected {"value": ...}')
    try:
        return store.put(section, body["value"])
    except store.StoreError as e:
        raise HTTPException(status_code=400, detail=str(e))


# --- updates ------------------------------------------------------------------------------
_last_update_info: dict = {}


@app.get("/api/update/check")
async def update_check(prereleases: bool = True):
    try:
        info = await updater.fetch_latest(VERSION, include_prereleases=prereleases)
    except updater.UpdateError as e:
        raise HTTPException(status_code=502, detail=str(e))
    _last_update_info.clear()
    _last_update_info.update(info)
    return {k: v for k, v in info.items() if k != "asset"}


@app.post("/api/update/install")
async def update_install():
    info = dict(_last_update_info)
    if not info.get("update_available") or not info.get("asset"):
        raise HTTPException(status_code=409, detail="Check for updates first")
    if not info.get("can_install"):
        raise HTTPException(status_code=400, detail="This copy of Nourish can't update itself. Download the new version from GitHub.")
    try:
        exe = await updater.download_and_swap(info["asset"])
    except updater.UpdateError as e:
        raise HTTPException(status_code=502, detail=str(e))
    logger.info(f"Update to {info.get('latest')} installed; restarting")

    def restart_and_exit():
        try:
            updater.restart(exe)
        finally:
            os._exit(0)

    asyncio.get_running_loop().call_later(1.0, restart_and_exit)
    return {"status": "restarting", "version": info.get("latest")}
