from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import httpx
import chromadb
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv
import os
import uuid
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("/app/nourish.log")
    ]
)
logger = logging.getLogger(__name__)

load_dotenv()

app = FastAPI(title="Nourish API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize globals
chroma_client = None
collection = None
embedder = None

try:
    chroma_client = chromadb.PersistentClient(path="./chroma_data")
    collection = chroma_client.get_or_create_collection("nourish_knowledge")
except Exception as e:
    print(f"Warning: ChromaDB initialization failed: {e}")

@app.on_event("startup")
async def startup_event():
    global embedder
    try:
        embedder = SentenceTransformer("all-MiniLM-L6-v2")
        print("Sentence transformer model loaded successfully")
    except Exception as e:
        print(f"Warning: Sentence transformer initialization failed: {e}")

class GenerateRequest(BaseModel):
    provider: str
    model: str
    messages: list
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    max_tokens: Optional[int] = 4000

class KnowledgeTextRequest(BaseModel):
    name: str
    content: str

class QueryRequest(BaseModel):
    query: str
    n_results: Optional[int] = 5

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/api/models")
async def get_models():
    lmstudio_url = os.getenv("LMSTUDIO_URL", "http://localhost:1234")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{lmstudio_url}/v1/models")
            return res.json()
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))

@app.post("/api/generate")
async def generate(req: GenerateRequest):
    logger.info(f"Generate request - provider: {req.provider}, model: {req.model}")
    try:
        if req.provider == "lmstudio":
            url = f"{req.base_url or os.getenv('LMSTUDIO_URL', 'http://localhost:1234')}/v1/chat/completions"
            headers = {"Content-Type": "application/json"}
            body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens, "temperature": 0.7}
        elif req.provider == "openai":
            url = "https://api.openai.com/v1/chat/completions"
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {req.api_key}"}
            body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens}
        elif req.provider == "claude":
            url = "https://api.anthropic.com/v1/messages"
            headers = {"Content-Type": "application/json", "x-api-key": req.api_key, "anthropic-version": "2023-06-01"}
            body = {"model": req.model, "messages": req.messages, "max_tokens": req.max_tokens}
        else:
            logger.error(f"Generate error: Unknown provider {req.provider}")
            raise HTTPException(status_code=400, detail="Unknown provider")

        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(url, json=body, headers=headers)
            logger.info(f"Generate successful - provider: {req.provider}")
            return res.json()
    except Exception as e:
        logger.error(f"Generate error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/knowledge/add-text")
async def add_knowledge_text(req: KnowledgeTextRequest):
    logger.info(f"Add knowledge text - name: {req.name}, content length: {len(req.content)}")
    try:
        if not collection or not embedder:
            logger.error("Add knowledge text error: Knowledge base not initialized")
            raise HTTPException(status_code=503, detail="Knowledge base not initialized")
        chunks = [req.content[i:i+500] for i in range(0, len(req.content), 450)]
        embeddings = embedder.encode(chunks).tolist()
        ids = [str(uuid.uuid4()) for _ in chunks]
        metadatas = [{"name": req.name} for _ in chunks]
        collection.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)
        logger.info(f"Knowledge text added - name: {req.name}, chunks: {len(chunks)}")
        return {"added": len(chunks), "name": req.name, "chunks_created": len(chunks), "total_content_length": len(req.content)}
    except Exception as e:
        logger.error(f"Add knowledge text error: {str(e)}")
        raise

@app.post("/api/knowledge/add")
async def add_knowledge_file(file: UploadFile = File(...)):
    logger.info(f"Add knowledge file - name: {file.filename}")
    try:
        if not collection or not embedder:
            logger.error("Add knowledge file error: Knowledge base not initialized")
            raise HTTPException(status_code=503, detail="Knowledge base not initialized")
        content = await file.read()
        text = content.decode("utf-8", errors="ignore")
        name = file.filename
        chunks = [text[i:i+500] for i in range(0, len(text), 450)]
        embeddings = embedder.encode(chunks).tolist()
        ids = [str(uuid.uuid4()) for _ in chunks]
        metadatas = [{"name": name} for _ in chunks]
        collection.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)
        logger.info(f"Knowledge file added - name: {name}, chunks: {len(chunks)}")
        return {"added": len(chunks), "name": name, "chunks_created": len(chunks), "total_content_length": len(text)}
    except Exception as e:
        logger.error(f"Add knowledge file error: {str(e)}")
        raise

@app.post("/api/knowledge/query")
async def query_knowledge(req: QueryRequest):
    logger.info(f"Knowledge query - query: {req.query}")
    try:
        if not collection or not embedder:
            logger.error("Knowledge query error: Knowledge base not initialized")
            raise HTTPException(status_code=503, detail="Knowledge base not initialized")
        embedding = embedder.encode([req.query]).tolist()
        results = collection.query(query_embeddings=embedding, n_results=req.n_results)
        docs = results.get("documents", [[]])[0]
        logger.info(f"Knowledge query successful - returned {len(docs)} results")
        return {"context": "\n\n".join(docs)}
    except Exception as e:
        logger.error(f"Knowledge query error: {str(e)}")
        raise

@app.get("/api/knowledge")
async def list_knowledge():
    logger.info("List knowledge entries")
    try:
        if not collection:
            logger.error("List knowledge error: Knowledge base not initialized")
            raise HTTPException(status_code=503, detail="Knowledge base not initialized")
        results = collection.get()
        names = list(set(m.get("name") for m in results.get("metadatas", [])))
        logger.info(f"Listed {len(names)} knowledge entries")
        return {"entries": names}
    except Exception as e:
        logger.error(f"List knowledge error: {str(e)}")
        raise

@app.delete("/api/knowledge/{name}")
async def delete_knowledge(name: str):
    logger.info(f"Delete knowledge - name: {name}")
    try:
        if not collection:
            logger.error(f"Delete knowledge error: Knowledge base not initialized")
            raise HTTPException(status_code=503, detail="Knowledge base not initialized")
        results = collection.get(where={"name": name})
        if results["ids"]:
            collection.delete(ids=results["ids"])
            logger.info(f"Knowledge deleted - name: {name}, ids: {len(results['ids'])}")
        else:
            logger.warning(f"Delete knowledge - no entries found for: {name}")
        return {"deleted": name}
    except Exception as e:
        logger.error(f"Delete knowledge error: {str(e)}")
        raise

@app.get("/api/logs")
async def get_logs():
    try:
        with open("/app/nourish.log", "r") as f:
            lines = f.readlines()
        return {"logs": lines[-100:]}
    except Exception as e:
        logger.warning(f"Could not read logs: {str(e)}")
        return {"logs": ["No logs yet"]}

@app.delete("/api/logs")
async def clear_logs():
    try:
        open("/app/nourish.log", "w").close()
        logger.info("Logs cleared")
        return {"status": "logs cleared"}
    except Exception as e:
        logger.error(f"Clear logs error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
