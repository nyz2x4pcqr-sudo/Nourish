from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional
import asyncio
import logging
import os
import sys
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import httpx

load_dotenv()

# Chroma sends anonymous usage telemetry by default; this app promises nothing leaves the machine.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")

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

LMSTUDIO_URL = os.getenv("LMSTUDIO_URL", "http://localhost:1234").rstrip("/")
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
THEMEALDB_URL = os.getenv("THEMEALDB_URL", "https://www.themealdb.com/api/json/v1/1").rstrip("/")
SPOONACULAR_URL = os.getenv("SPOONACULAR_URL", "https://api.spoonacular.com").rstrip("/")
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", Path(__file__).resolve().parent.parent))
# Only these files are served. Never mount the repo root as a static directory:
# it would expose backend/.env and .git to anyone on the network.
FRONTEND_FILES = {"index.html", "app.js", "json-repair.js", "styles.css"}

# Knowledge base (optional). Heavy imports and the embedding-model download happen
# lazily so the rest of the app starts instantly and works offline.
collection = None
embedder = None
_kb_lock = asyncio.Lock()


def _init_kb():
    global collection, embedder
    import chromadb
    from chromadb.config import Settings
    from sentence_transformers import SentenceTransformer

    if collection is None:
        client = chromadb.PersistentClient(path="./chroma_data", settings=Settings(anonymized_telemetry=False))
        collection = client.get_or_create_collection("nourish_knowledge")
    if embedder is None:
        embedder = SentenceTransformer("all-MiniLM-L6-v2")


async def require_kb(need_embedder: bool = True):
    async with _kb_lock:
        if collection is None or (need_embedder and embedder is None):
            try:
                await asyncio.to_thread(_init_kb)
            except Exception as e:
                logger.error(f"Knowledge base init failed: {type(e).__name__}: {e}")
                raise HTTPException(status_code=503, detail="Knowledge base unavailable (see server log)")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Nourish starting. LM Studio: {LMSTUDIO_URL}  Ollama: {OLLAMA_URL}  Frontend: {FRONTEND_DIR}")
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
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


class GenerateRequest(BaseModel):
    provider: str
    model: str
    messages: list
    api_key: Optional[str] = None
    max_tokens: Optional[int] = 8000


class KnowledgeTextRequest(BaseModel):
    name: str
    content: str


class QueryRequest(BaseModel):
    query: str
    n_results: Optional[int] = 5


class RecipeSearchRequest(BaseModel):
    query: str
    exclude: Optional[str] = ""
    number: Optional[int] = 21
    api_key: Optional[str] = None


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


@app.get("/api/models")
async def get_models():
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{LMSTUDIO_URL}/v1/models")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"LM Studio not reachable at {LMSTUDIO_URL} ({type(e).__name__})")
    if res.status_code >= 400:
        raise upstream_error(res, "LM Studio")
    return res.json()


@app.post("/api/generate")
async def generate(req: GenerateRequest):
    logger.info(f"Generate request - provider: {req.provider}, model: {req.model}, messages: {len(req.messages)}")
    if req.provider in ("lmstudio", "ollama"):
        base = LMSTUDIO_URL if req.provider == "lmstudio" else OLLAMA_URL
        who = "LM Studio" if req.provider == "lmstudio" else "Ollama"
        url = f"{base}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens, "temperature": 0.7}
    elif req.provider == "openai":
        key = req.api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise HTTPException(status_code=400, detail="No OpenAI API key. Add one in Settings.")
        who, url = "OpenAI", "https://api.openai.com/v1/chat/completions"
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
        body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens}
    elif req.provider == "claude":
        key = req.api_key or os.getenv("ANTHROPIC_API_KEY")
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

    try:
        async with httpx.AsyncClient(timeout=300) as client:
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
    key = req.api_key or os.getenv("SPOONACULAR_API_KEY")
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
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            # Key goes in a header, not the URL, so it never appears in access logs.
            res = await client.get(f"{SPOONACULAR_URL}/recipes/complexSearch", params=params, headers={"x-api-key": key})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=503, detail=f"Spoonacular not reachable ({type(e).__name__})")
    if res.status_code >= 400:
        raise upstream_error(res, "Spoonacular")
    return res.json()


@app.post("/api/knowledge/add-text")
async def add_knowledge_text(req: KnowledgeTextRequest):
    logger.info(f"Add knowledge text - name: {req.name}, content length: {len(req.content)}")
    await require_kb()
    chunks = [req.content[i:i+500] for i in range(0, len(req.content), 450)]
    if not chunks:
        raise HTTPException(status_code=400, detail="Content is empty")
    embeddings = embedder.encode(chunks).tolist()
    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"name": req.name} for _ in chunks]
    collection.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)
    logger.info(f"Knowledge text added - name: {req.name}, chunks: {len(chunks)}")
    return {"added": len(chunks), "name": req.name, "chunks_created": len(chunks), "total_content_length": len(req.content)}


@app.post("/api/knowledge/add")
async def add_knowledge_file(file: UploadFile = File(...)):
    logger.info(f"Add knowledge file - name: {file.filename}")
    await require_kb()
    content = await file.read()
    text = content.decode("utf-8", errors="ignore")
    name = file.filename
    chunks = [text[i:i+500] for i in range(0, len(text), 450)]
    if not chunks:
        raise HTTPException(status_code=400, detail="File is empty")
    embeddings = embedder.encode(chunks).tolist()
    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"name": name} for _ in chunks]
    collection.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)
    logger.info(f"Knowledge file added - name: {name}, chunks: {len(chunks)}")
    return {"added": len(chunks), "name": name, "chunks_created": len(chunks), "total_content_length": len(text)}


@app.post("/api/knowledge/query")
async def query_knowledge(req: QueryRequest):
    logger.info(f"Knowledge query - query length: {len(req.query)}")
    await require_kb()
    embedding = embedder.encode([req.query]).tolist()
    results = collection.query(query_embeddings=embedding, n_results=req.n_results)
    docs = (results.get("documents") or [[]])[0]
    logger.info(f"Knowledge query successful - returned {len(docs)} results")
    return {"context": "\n\n".join(docs)}


@app.get("/api/knowledge")
async def list_knowledge():
    await require_kb(need_embedder=False)
    results = collection.get()
    names = sorted({(m or {}).get("name") for m in results.get("metadatas") or []} - {None})
    return {"entries": names}


@app.delete("/api/knowledge/{name}")
async def delete_knowledge(name: str):
    logger.info(f"Delete knowledge - name: {name}")
    await require_kb(need_embedder=False)
    results = collection.get(where={"name": name})
    if results["ids"]:
        collection.delete(ids=results["ids"])
        logger.info(f"Knowledge deleted - name: {name}, ids: {len(results['ids'])}")
    else:
        logger.warning(f"Delete knowledge - no entries found for: {name}")
    return {"deleted": name}
