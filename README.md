# 🍽️ Nourish

**Free. Open source. Runs on your own PC.**

Nourish makes a 7-day meal plan (breakfast, lunch, dinner) with recipes, calories and macros, and builds a grocery list from it. You run a small server on your PC, and then use the app in a browser on the PC or on your phone over home Wi-Fi.

---

## What it does today

- **Meal plans** from an AI of your choice:
  - **LM Studio** (local, free) — the default
  - **Ollama** (local, free)
  - **Claude** or **OpenAI** (needs your own API key)
- **Real recipes instead of AI ones**: **TheMealDB** (free, no key) or **Spoonacular** (free key). TheMealDB has no nutrition data, so calories show as "—" for those recipes.
- **Chat with the chef**: describe what you want in plain words ("cheap high-protein dinners, nothing spicy"), go back and forth, then tap **Make plan** to turn the conversation into your 7-day plan. You can also ask about any recipe.
- **Detailed settings**: pick the exact AI model, creativity and response length, and test the AI. Your profile (calorie and protein targets, diet, allergies, cuisines, maximum cooking time, servings, skill, budget, units) is used in every plan and chat. Settings save automatically.
- **Today screen**: calories and protein/carbs/fat for each day against your targets, with meal cards you can tap for the full recipe.
- **Grocery list**: built from every ingredient in the plan, grouped by category. Your ticks are saved.
- **Saved on the device**: your plan, grocery ticks and settings are kept in the browser (`localStorage`). They survive a reload and work even while the server is off. Only making a new plan needs the server.

Making a plan with a local model can take a few minutes. It runs in the background on your PC, so you can lock your phone or switch apps and the plan still arrives. The backend also has a knowledge-base (RAG) API, but the current UI doesn't use it (see `AUDIT.md`).

---

## Requirements

- **Python 3.12** exactly — not 3.13 or newer.
  Why: the knowledge-base library (`chromadb` 0.5.x) needs `numpy` 1.26.x, and numpy 1.26 has **no prebuilt wheels for Python 3.13+**. On 3.13, pip tries to compile numpy from source and fails on most machines. (Checked: `uv pip compile -p 3.13 --only-binary :all:` fails; `-p 3.12` works.)
- About **3–4 GB of disk** for the Python packages (PyTorch comes along with `sentence-transformers`).
- For AI plans, one of: [LM Studio](https://lmstudio.ai) with a model loaded and its **server started**, [Ollama](https://ollama.com), or a Claude/OpenAI API key.

Or use Docker instead of installing Python (see Option 2).

---

## 🚀 Quick start

### Option 0 — Windows app (easiest)

1. Download **Nourish.exe** from the repo's **Releases** page. (Or: **Actions** tab → latest "Build Windows app" run → **Nourish-windows**.)
2. Put it in its own folder and double-click it. A black window opens: **keep it open** while you use Nourish. Your browser opens the app.
3. Windows may say "Windows protected your PC", because the app isn't signed. Click **More info → Run anyway**.
4. The first time you use the phone address, Windows asks about network access. Allow **Private networks**.

The `.exe` doesn't include the knowledge base; nothing in the app uses it yet. Settings files (`.env`) and the log go in the same folder as the `.exe`.

### Option 1 — Python 3.12

**Windows (PowerShell):**
```powershell
git clone https://github.com/nyz2x4pcqr-sudo/Nourish
cd Nourish\backend
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

**macOS / Linux:**
```bash
git clone https://github.com/nyz2x4pcqr-sudo/Nourish
cd Nourish/backend
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000**. The server hosts the app itself, so you don't need a separate web server.

Don't need the knowledge base? Install `requirements-core.txt` instead of `requirements.txt`. It's a much smaller download, with no PyTorch, and it works on newer Python versions too. `python nourish_app.py` starts the server and opens the browser for you, the same way the `.exe` does.

### Option 2 — Docker

Start **Docker Desktop** first, then:
```bash
docker compose up --build
```
Open **http://localhost:8000**. Inside Docker, the server reaches LM Studio or Ollama on your PC through `host.docker.internal` (this is already set up in `docker-compose.yml`).

### Using it on your iPhone

1. Keep the server running on the PC. The PC and phone must be on the same Wi-Fi.
2. Find the address: it's printed in the Nourish window, and shown in **Settings → Server & phone**. (Or on Windows: `ipconfig` → "IPv4 Address", e.g. `192.168.1.23`.)
3. On the iPhone, open Safari and go to `http://192.168.1.23:8000`.
4. Optional: tap Share → **Add to Home Screen** to get an app icon.

Windows may ask whether Python can accept network connections. Allow it on **Private networks**.

---

## 🔧 Configuration

Everything can be set in the app under **⚙️ Settings**: the AI provider and model, creativity, response length, API keys, your profile, and your Spoonacular key. Keys are stored only on that device and sent only to your own Nourish server.

The address the *server* uses to reach LM Studio or Ollama is set on the server, not in the app: `LMSTUDIO_URL` / `OLLAMA_URL` in `backend/.env`. The defaults are right for the `.exe` and Python (`localhost`) and for Docker (`host.docker.internal`, set in `docker-compose.yml`). Settings shows the current value.

You can also put keys on the server instead. Copy `backend/.env.example` to `backend/.env`:

```env
LMSTUDIO_URL=http://localhost:1234
OLLAMA_URL=http://localhost:11434
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
SPOONACULAR_API_KEY=
```

If a key is set in the app, it's used; if not, the server falls back to the one in `.env`. `.env` is git-ignored. Never commit it.

---

## 🏗️ How it fits together

```
Nourish/
├── index.html        # the app (one page, four tabs)
├── app.js            # app logic
├── json-repair.js    # reads messy AI output as JSON
├── styles.css
├── tests/            # frontend tests:  node --test
├── docker-compose.yml
├── .github/workflows/build-exe.yml  # builds Nourish.exe on GitHub
└── backend/
    ├── main.py       # FastAPI server: hosts the app + /api/*
    ├── nourish_app.py  # launcher used by the .exe
    ├── main_test.py  # backend tests:  python -m unittest -v main_test
    ├── requirements-core.txt  # what the app needs
    ├── requirements.txt       # core + knowledge base
    ├── Dockerfile
    └── .env.example
```

**Browser** → **FastAPI server (port 8000)** → LM Studio / Ollama / Claude / OpenAI / TheMealDB / Spoonacular.

API endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /` and `/app.js`, `/styles.css`, `/json-repair.js` | the app |
| `GET /health` | server check |
| `GET /api/info` | server version, AI addresses, phone addresses |
| `GET /api/models?provider=lmstudio\|ollama` | models available locally |
| `POST /api/jobs`, `GET/DELETE /api/jobs/{id}` | run an AI request in the background, check on it, cancel it (what the app uses) |
| `POST /api/generate` | send a request to the AI and wait for the answer |
| `POST /api/recipes/themealdb`, `/api/recipes/spoonacular` | recipe search |
| `/api/knowledge/*` | knowledge base (not used by the UI yet) |

The server only accepts browser requests from `localhost`, private home-network addresses (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and `*.local` names.

---

## 🧪 Tests

```bash
node --test                                   # JSON parser (from repo root)
cd backend && python -m unittest -v main_test # API (no network or keys needed)
```

---

## 📍 Roadmap

- [x] AI meal plans (LM Studio, Ollama, Claude, OpenAI)
- [x] TheMealDB and Spoonacular recipes
- [x] Grocery list with saved ticks
- [x] Chat with the chef, and make a plan from the chat
- [x] Windows .exe
- [ ] Knowledge base in the UI (the backend is ready)
- [ ] USDA nutrition lookup for recipes without nutrition data
- [ ] Offline iPhone app (see `AUDIT.md`, section 5)

Having problems? See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

---

## 📄 License

AGPL v3: free forever, open forever.
