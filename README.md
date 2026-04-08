# 🍽️ Nourish

**Free. Open Source. Forever.**

Nourish is an AI-powered personal chef, nutritionist, and fitness coach — all in one app. Generate chef-quality meal plans tailored to your goals, get real recipes with ingredients and steps, track nutrition, and build a grocery list automatically.

No subscriptions. No ads. No corporate BS. Just real food and real health, for everyone.

---

## ✨ Features

- 🤖 **Multi-provider AI** — works with LM Studio (local/free), Claude, OpenAI, or Ollama
- 🍳 **Real recipes** — full ingredients and cooking steps, not just meal names
- 📊 **Nutrition tracking** — calories, protein, carbs, fat per meal
- 🛒 **Grocery list** — auto-generated with checkboxes, grouped by category
- 🧠 **Knowledge Base** — upload your own cookbooks or nutrition guides as RAG context
- ⚙️ **Settings UI** — configure all API keys and providers from the browser
- 🔒 **Fully local** — run everything on your own hardware, no data leaves your machine

---

## 🚀 Quick Start

### Option 1 — Docker (Recommended)

```bash
git clone https://github.com/nyz2x4pcqr-sudo/Nourish
cd Nourish
cp backend/.env.example backend/.env
docker-compose up --build
```

Then open `http://localhost:3000` (serve the frontend with `npx serve .`)

Backend API available at `http://localhost:8000/docs`

### Option 2 — Local Python

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Then serve the frontend:
```bash
cd ..
npx serve .
```

---

## 🔧 Configuration

Copy `backend/.env.example` to `backend/.env` and add your API keys:

```env
LMSTUDIO_URL=http://localhost:1234
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Or configure everything from the ⚙️ Settings panel in the UI.

---

## 🧠 Adding Knowledge Base

1. Open Settings → Knowledge Base tab
2. Upload a `.txt` file (export from any cookbook or nutrition guide)
3. Toggle "Use Knowledge Base" on
4. Generate a meal plan — Nourish will query your knowledge base for context

---

## 🏗️ Architecture
Nourish/
├── index.html          # Frontend — single file app
├── docker-compose.yml  # Orchestration
└── backend/
├── main.py         # FastAPI backend
├── requirements.txt
├── Dockerfile
└── .env.example

**Frontend** → talks to **FastAPI backend** → proxies to AI providers and queries **ChromaDB** vector database

---

## 📍 Roadmap

- [x] AI meal plan generation
- [x] Full recipes with ingredients and steps
- [x] Nutrition tracking
- [x] Grocery list with checkboxes
- [x] Multi-provider AI support
- [x] FastAPI backend with RAG
- [x] ChromaDB knowledge base
- [ ] USDA nutrition API integration
- [ ] React Native mobile app
- [ ] Fitness tracking layer
- [ ] Recipe scraping from TheMealDB and Spoonacular

---

## 📄 License

AGPL v3 — free forever, open forever. No one can ever lock this behind a paywall.

---

## 🤝 Contributing

PRs welcome. See the roadmap above for what's next. Open an issue first to discuss your approach.
