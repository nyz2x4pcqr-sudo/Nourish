# 🍽️ Nourish

**Free. Open source. Runs on your own PC.**

Nourish makes a 7-day meal plan (breakfast, lunch, dinner) with recipes, calories and macros, and builds a grocery list from it. You run a small server on your PC, and then use the app in a browser on the PC or on your phone over home Wi-Fi.

---

## What it does today

- **Meal plans** from an AI of your choice:
  - **LM Studio** (local, free) — the default
  - **Ollama** (local, free)
  - **Claude** or **OpenAI** (needs your own API key)
- **Real recipes instead of AI ones**:
  - **Web search**: finds recipes on recipe websites and reads them in full. It works without a key through DuckDuckGo, or with a free Brave Search key.
  - **TheMealDB**: free, no key. It has no nutrition data, so calories show as "—".
  - **Spoonacular**: needs a free key.
- **Add any recipe** (the link button on the Plan tab): from a recipe website, a YouTube, TikTok, Reddit or Pinterest post, pasted text, or a screenshot.
  - Recipe sites' own recipe data is read directly; otherwise the AI reads the page, caption, description or transcript.
  - Pages that are blocked or need a login (often Instagram and Facebook) say so, and offer pasting the text or a screenshot instead. Screenshots are read on the iPhone itself, or by Claude/OpenAI.
  - You check and edit the recipe before saving. Missing nutrition is estimated by the AI and labelled "Estimated".
- **Cookbook** (the book button on the Plan tab): tap the heart on any recipe to keep it. Search, filter by meal and by "made by Nourish" or "imported", add a saved recipe to any day and meal, edit or remove it. New plans and swaps never touch it.
- **Checked recipes**: every AI recipe has a serving count, specific ingredients with amounts, and full steps from prep to plating. It's checked before you see it (amounts, seasoning, enough steps, every ingredient used, calories matching the macros) and made again when something's wrong.
- **Chat with the chef**: describe what you want in plain words ("cheap high-protein dinners, nothing spicy") and go back and forth.
  - Say **"make me a plan"** and the plan goes straight into the Plan tab (or tap **Make plan**).
  - Say **"swap Wednesday dinner for something vegetarian"** and just that meal changes.
  - You can also ask about any recipe. Every recipe also has a **Swap meal** button.
- **Settings, organized into pages**: Appearance, AI model, Chat, Your profile, Recipe sources, Grocery list, Server & devices, Updates, and Data & privacy.
  - Theme (dark, light or auto), accent colour, text size, which tab opens first, which day the week starts, show/hide nutrition, reduce motion.
  - Pick the exact AI model, creativity and plan length, and test the AI. Choose the chef's style and reply length, and whether chat may change your plan.
  - Your profile (name, goal, calorie and protein targets, diet, allergies, foods you love and avoid, cuisines, maximum cooking time, servings, skill, budget, units) is used in every plan and chat.
  - Settings save automatically.
- **Updates itself**: the Windows app checks GitHub for new releases. One tap downloads, verifies, installs and restarts.
- **Phone apps** for Android (`.apk`) and iPhone (`.ipa`, sideloaded). They find your PC on the Wi-Fi and open Nourish from it.
- **Today screen**: calories and protein/carbs/fat for each day against your targets, with meal cards you can tap for the full recipe.
- **Grocery list**: built from every ingredient in the plan, grouped by aisle, with a progress bar. Add your own items, hide ticked ones, and share or copy the list.
- **The same everywhere**: your settings, plan, grocery list, chat and Cookbook are kept on the PC (in `nourish-data.json`, next to Nourish) and synced to every browser and phone app connected to it, within a few seconds. Each device also keeps a copy, so a saved plan still shows while the PC is off. API keys are stored on the PC and never sent back to phones.

Making a plan with a local model can take a few minutes. It runs in the background on your PC, so you can lock your phone or switch apps and the plan still arrives.

---

## Requirements

- **Python 3.11 or newer** (tested with 3.11 and 3.12).
- About **100 MB of disk** for the Python packages.
- For AI plans, one of: [LM Studio](https://lmstudio.ai) with a model loaded and its **server started**, [Ollama](https://ollama.com), or a Claude/OpenAI API key.

Or use Docker instead of installing Python (see Option 2).

---

## 🚀 Quick start

### Option 0 — Windows app (easiest)

1. Download **Nourish.exe** from the repo's **Releases** page. (Or: **Actions** tab → latest "Build Windows app" run → **Nourish-windows**.)
2. Put it in its own folder and double-click it. A black window opens: **keep it open** while you use Nourish. Your browser opens the app.
3. Windows may say "Windows protected your PC", because the app isn't signed. Click **More info → Run anyway**.
4. The first time you use the phone address, Windows asks about network access. Allow **Private networks**.

Settings files (`.env`) and the log go in the same folder as the `.exe`.

### Option 1 — Python

**Windows (PowerShell):**
```powershell
git clone https://github.com/nyz2x4pcqr-sudo/Nourish
cd Nourish\backend
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

**macOS / Linux:**
```bash
git clone https://github.com/nyz2x4pcqr-sudo/Nourish
cd Nourish/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Then open **http://localhost:8000**. The server hosts the app itself, so you don't need a separate web server.

`python nourish_app.py` starts the server and opens the browser for you, the same way the `.exe` does.

### Option 2 — Docker

Start **Docker Desktop** first, then:
```bash
docker compose up --build
```
Open **http://localhost:8000**. Inside Docker, the server reaches LM Studio or Ollama on your PC through `host.docker.internal` (this is already set up in `docker-compose.yml`).

### On your phone

**The apps** (from the Releases page) work on their own: no PC needed.
- **Android:** install `Nourish.apk`.
- **iPhone (iOS 16.4+):** `Nourish-unsigned.ipa` must be sideloaded with [AltStore](https://altstore.io), [Sideloadly](https://sideloadly.io) or LiveContainer, which sign it with your Apple ID. With a free Apple ID, it has to be refreshed every 7 days. Step-by-step instructions are in the release notes.

**AI on the phone:** in **Settings → AI model**, choose **On this phone**. Nourish checks the phone's memory, storage and temperature, then shows a top-5 list of Hugging Face models that fit it, with tags (Recommended, Fastest, Best quality, May get warm…). Tap **Download**, then **Use this model**. You can also search Hugging Face for any GGUF model, and sign in with a free Hugging Face token for gated models. The models run with [llama.cpp](https://github.com/ggml-org/llama.cpp): on the iPhone's GPU (Metal), and on the processor on Android.

**Or use Nourish from your PC** (one shared plan for all devices, and the PC's AI): **Settings → Server & devices → Connect to my PC instead**, then **Find my PC automatically**.

**Or just use the browser:**

1. Keep the server running on the PC. The PC and phone must be on the same Wi-Fi.
2. Find the address: it's printed in the Nourish window, and shown in **Settings → Server & devices**. (Or on Windows: `ipconfig` → "IPv4 Address", e.g. `192.168.1.23`.)
3. On the iPhone, open Safari and go to `http://192.168.1.23:8000`.
4. Optional: tap Share → **Add to Home Screen** to get an app icon.

Windows may ask whether Python can accept network connections. Allow it on **Private networks**.

---

## 🔧 Configuration

Everything can be set in the app under **⚙️ Settings**: the AI provider and model, creativity, response length, API keys, your profile, and your Spoonacular key. Settings sync to every device. API keys are kept on your PC (in `nourish-data.json`) and are never sent back to phones or browsers; devices only see whether a key is saved.

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
├── grocery.js        # the shopping list: merges ingredient lines, drops junk
├── units.js          # kitchen units: imperial ↔ metric, amounts in recipe text, sanity caps
├── recipes.js        # recipe checks: servings, specific amounts, full steps, macros match calories
├── importer.js       # recipes from any link: recipe data, social captions/transcripts, page text → AI
├── styles.css
├── tests/            # frontend tests:  node --test
├── docker-compose.yml
├── manifest.webmanifest, *.png      # home-screen icon
├── release-notes/   # notes for each release
├── mobile/
│   ├── shared/connect.html  # "connect to your PC" page used by both apps
│   ├── android/     # Android app (Java WebView)
│   ├── ios/         # iPhone app (Swift WKWebView, XcodeGen project.yml)
│   └── make_icons.py
├── .github/workflows/
│   ├── build-exe.yml     # builds + smoke-tests Nourish.exe on Windows
│   ├── build-mobile.yml  # builds the APK and IPA, runs them in an emulator/simulator
│   └── release.yml       # builds everything and publishes a GitHub Release
└── backend/
    ├── main.py       # FastAPI server: hosts the app + /api/*
    ├── updater.py    # checks GitHub Releases; self-update for the .exe
    ├── web_recipes.py  # web search + reading recipe pages (schema.org JSON-LD)
    ├── nourish_app.py  # launcher used by the .exe
    ├── main_test.py  # backend tests:  python -m unittest -v main_test
    ├── requirements-core.txt  # what the app needs
    ├── requirements.txt       # the same (kept for older instructions and Docker)
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
| `POST /api/recipes/themealdb`, `/api/recipes/spoonacular`, `/api/recipes/web` | recipe search |
| `POST /api/recipes/import` | read one recipe from a web address |
| `POST /api/web/fetch` | a public web page for the app's recipe importer (`{status, url, body}`) |
| `GET /api/update/check`, `POST /api/update/install` | check GitHub for a newer release; install it (Windows app only) |

The server only accepts browser requests from `localhost`, private home-network addresses (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and `*.local` names. When it reads recipe web pages, it only fetches public internet addresses, never devices on your home network.

### Making a release

Go to the **Actions** tab, choose **Release**, click **Run workflow**, and enter a tag such as `v0.3.0-beta`. Write `release-notes/<tag>.md` first; it becomes the release text. The workflow builds `Nourish.exe`, `Nourish.apk` and `Nourish-unsigned.ipa`, tests them, and publishes them on the release. Also bump `VERSION` in `backend/main.py`; that's what the self-updater compares against.

**Before every release, run the plan audit** and put its result in the release notes (the Release workflow also runs it and shows the result on the run's page):

```bash
node tools/audit/plan-audit.js --grow-web   # first time, or to refresh the web recipes (needs: npm i --no-save linkedom@0.18)
node tools/audit/plan-audit.js              # 25 full 7-day plans, every meal checked; report in tools/audit/.cache/report.md
```

---

## 🧪 Tests

```bash
node --test                                   # app logic (from repo root)
node tools/audit/plan-audit.js                # the plan audit (see Making a release)
cd backend && python -m unittest -v main_test # API (no network or keys needed)
```

---

## 📍 Roadmap

- [x] AI meal plans (LM Studio, Ollama, Claude, OpenAI)
- [x] TheMealDB and Spoonacular recipes
- [x] Grocery list with saved ticks
- [x] Chat with the chef, and make a plan from the chat
- [x] Windows .exe that updates itself
- [x] Web recipe search and import from a link
- [x] Android and iPhone apps
- [ ] Knowledge base in the UI (the backend is ready)
- [ ] USDA nutrition lookup for recipes without nutrition data
- [ ] Phone apps that work without the PC (see `AUDIT.md`, section 5)
- [ ] Signed iPhone build (needs a paid Apple Developer account)

Having problems? See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

---

## 📄 License

AGPL v3: free forever, open forever.
