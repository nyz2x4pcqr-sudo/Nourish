# Troubleshooting

Look for the message you're seeing, then follow the fix. Messages in quotes are what the app or terminal shows.

---

## Docker: "Cannot connect to the Docker daemon" / "error during connect" / "The system cannot find the file specified"

**Cause:** The Docker *program* is installed, but the Docker *engine* isn't running.

**Fix:**
1. Open **Docker Desktop** from the Start menu and wait until it says "Engine running" (the whale icon in the taskbar stops animating).
2. Run `docker compose up --build` again.
3. Still failing on Windows? In Docker Desktop, go to Settings → General and make sure "Use the WSL 2 based engine" is on. Then restart Docker Desktop.

If you don't need Docker, skip it and use the Python setup in the README instead.

---

## Wrong Python version: numpy build errors, "Microsoft Visual C++ 14.0 is required", "metadata-generation-failed", "Could not build wheels for numpy"

**Cause:** You're on Python 3.13 or newer. Nourish pins `numpy==1.26.4` (the knowledge-base library needs it), and numpy 1.26 has no ready-made download for 3.13+. pip tries to compile it and fails.

**Fix:** Install **Python 3.12** from https://www.python.org/downloads/ (you can keep other versions installed alongside it). Then create the environment with 3.12 explicitly:

```powershell
cd backend
py -3.12 -m venv .venv          # macOS/Linux: python3.12 -m venv .venv
.venv\Scripts\Activate.ps1      # macOS/Linux: source .venv/bin/activate
python --version                # must say 3.12.x
pip install -r requirements.txt
```

If `py -3.12` says it can't find 3.12, the installer didn't finish. Run it again.

---

## The page opens from a `file:///...` address and nothing works

**Cause:** You double-clicked `index.html`. Browsers block much of what the app needs when a page is opened as a file, and the phone can't reach it at all. The app shows a banner: "Opened as a file. Start the server and open http://localhost:8000 instead."

**Fix:** Start the server (see README), then open **http://localhost:8000** in the browser. The server hosts the app, so you never need to open `index.html` directly.

---

## "LM Studio not reachable at http://localhost:1234" or "No model loaded in LM Studio"

**Cause:** LM Studio is open, but its local server isn't started, or no model is loaded.

**Fix:**
1. In LM Studio, open the **Developer** tab (on older versions, the "Local Server" tab, `<->` icon).
2. Load a model at the top (an instruct/chat model; a 7B–8B model is a good start).
3. Click **Start Server**. It should show `http://localhost:1234`.
4. In Nourish, go to Settings → **Check again**. The Model row should show the model's name.

Want to use LM Studio from Docker, or from another PC? In LM Studio's server settings, turn on **"Serve on Local Network"**.

**AI plan cut short / "Got 4 of 7 days":** The model ran out of room. Load the model with a larger context length (8k or more), or pick a bigger model.

---

## "host.docker.internal" errors: "Name or service not known", "getaddrinfo failed", "[Errno -2]"

**Cause:** `host.docker.internal` is a special name that exists **only inside Docker containers**. It means "the PC Docker is running on". When you run the server directly with Python, that name doesn't exist.

**Fix:**
- **Running with Python (no Docker):** use `LMSTUDIO_URL=http://localhost:1234`. That's the default now. If you have an old `backend/.env`, change the line there.
- **Running with Docker:** `docker-compose.yml` already sets `host.docker.internal`, which is correct there. On Linux this needs the `extra_hosts: host-gateway` line that's already in the compose file.

---

## USDA nutrition: "OVER_RATE_LIMIT" / HTTP 429 with `DEMO_KEY`

**Cause:** USDA FoodData Central's shared `DEMO_KEY` allows only about 30 requests an hour and 50 a day **per IP address**, shared with everyone using it. Looking up every ingredient in a 7-day plan uses that up at once.

**Status:** USDA lookup is **currently switched off** in Nourish (the old code was an empty placeholder). If it's added back:
1. Get a free personal key at https://fdc.nal.usda.gov/api-key-signup.html (1,000 requests an hour).
2. Store it on the server (`backend/.env`), not in the page.
3. Cache the results, and look up each ingredient only once.

---

## Other messages

| Message | What to do |
|---|---|
| "Can't reach the Nourish server. Is it running on your PC?" | Start `uvicorn` (README). On the phone: use the PC's IP address, not `localhost`, and make sure both are on the same Wi-Fi. |
| iPhone can't load `http://192.168.x.x:8000` | Windows Firewall: allow Python on **Private** networks (Control Panel → Windows Defender Firewall → Allow an app). Check that you used `--host 0.0.0.0` when starting uvicorn. |
| "Claude returned 401: API key is invalid." | Re-copy the key into Settings. Claude keys start with `sk-ant-`. |
| "Spoonacular needs a free API key" | Get one at https://spoonacular.com/food-api and paste it in Settings → Recipe sources. |
| "Ollama not reachable at http://localhost:11434" | Start Ollama, and download the model named in Settings (e.g. `ollama pull llama3.2`). |
| "Knowledge base unavailable" | The embedding model is downloaded from huggingface.co the first time the knowledge base is used. That needs internet access once. |
