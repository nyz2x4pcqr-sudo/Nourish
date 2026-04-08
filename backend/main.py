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

load_dotenv()

app = FastAPI(title="Nourish API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

chroma_client = chromadb.PersistentClient(path="/data/chroma")
collection = chroma_client.get_or_create_collection("nourish_knowledge")
embedder = SentenceTransformer("all-MiniLM-L6-v2")

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
            raise HTTPException(status_code=400, detail="Unknown provider")

        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(url, json=body, headers=headers)
            return res.json()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/knowledge/add-text")
async def add_knowledge_text(req: KnowledgeTextRequest):
    chunks = [req.content[i:i+500] for i in range(0, len(req.content), 450)]
    embeddings = embedder.encode(chunks).tolist()
    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"name": req.name} for _ in chunks]
    collection.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)
    return {"added": len(chunks), "name": req.name}

@app.post("/api/knowledge/add")
async def add_knowledge_file(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8", errors="ignore")
    name = file.filename
    chunks = [text[i:i+500] for i in range(0, len(text), 450)]
    embeddings = embedder.encode(chunks).tolist()
    ids = [str(uuid.uuid4()) for _ in chunks]
    metadatas = [{"name": name} for _ in chunks]
    collection.add(documents=chunks, embeddings=embeddings, ids=ids, metadatas=metadatas)
    return {"added": len(chunks), "name": name}

@app.post("/api/knowledge/query")
async def query_knowledge(req: QueryRequest):
    embedding = embedder.encode([req.query]).tolist()
    results = collection.query(query_embeddings=embedding, n_results=req.n_results)
    docs = results.get("documents", [[]])[0]
    return {"context": "\n\n".join(docs)}

@app.get("/api/knowledge")
async def list_knowledge():
    results = collection.get()
    names = list(set(m.get("name") for m in results.get("metadatas", [])))
    return {"entries": names}

@app.delete("/api/knowledge/{name}")
async def delete_knowledge(name: str):
    results = collection.get(where={"name": name})
    if results["ids"]:
        collection.delete(ids=results["ids"])
    return {"deleted": name}
