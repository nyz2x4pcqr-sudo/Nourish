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

## numpy build errors, "Microsoft Visual C++ 14.0 is required", "Could not build wheels for numpy"

**Cause:** You're installing an older copy of Nourish (before 0.4.2). It included an optional knowledge base that needed `numpy` 1.26, which only installs easily on Python 3.12.

**Fix:** Get the latest Nourish (`git pull`) and run `pip install -r requirements.txt` again. It no longer needs numpy and works on Python 3.11 or newer.

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

## Nourish.exe

| Problem | What to do |
|---|---|
| "Windows protected your PC" | The app isn't code-signed (signing costs money). Click **More info → Run anyway**. |
| The window flashes and closes | Open PowerShell in that folder and run `.\Nourish.exe` to read the message. |
| "Something is already using port 8000" | Nourish is already running. Look for its other window. Or run it on another port: `$env:NOURISH_PORT=8001; .\Nourish.exe` |
| Antivirus deletes or quarantines it | False positives are common for PyInstaller apps. Allow it in your antivirus, or run from Python instead (README, Option 1). |
| Phone can't connect | Allow Nourish on **Private networks** in the Windows Firewall prompt, or add it under Windows Defender Firewall → "Allow an app". |

---

## Updates

| Problem | What to do |
|---|---|
| "Couldn't reach GitHub to check for updates" | Check the PC's internet connection. Updates are optional; Nourish works without them. |
| "GitHub's rate limit was hit" | GitHub allows about 60 checks an hour per home connection. Wait an hour. |
| "The download for this version isn't ready yet" | The release was just published and GitHub is still building it. Try again in a few minutes. |
| "didn't match GitHub's fingerprint" | The download was damaged or changed on the way, so Nourish refused to install it. Try again. Your current version is untouched. |
| Updated but didn't come back | Start `Nourish.exe` again. If `Nourish.old.exe` is still in the folder, you can delete it. |
| Python or Docker install | These can't update themselves. Run `git pull`, then restart. |

---

## Phone apps

| Problem | What to do |
|---|---|
| "Find my PC automatically" finds nothing | Start Nourish on the PC first, and check both are on the same Wi-Fi (not guest Wi-Fi). Allow Nourish on **Private networks** in the Windows Firewall prompt. Or type the address shown in the Nourish window. |
| iPhone: no "Find my PC" button, or it never finds anything | Allow **Local Network** access: iPhone **Settings → Nourish → Local Network**. |
| iPhone: "Untrusted Developer" / the app won't open | **Settings → General → VPN & Device Management** → trust your Apple ID. On iOS 16+, also turn on **Settings → Privacy & Security → Developer Mode**. |
| iPhone: the app stopped opening after a week | Free Apple ID sideloads expire after 7 days. Refresh it in AltStore or Sideloadly. |
| Android: "App not installed" | Allow "Install unknown apps" for the browser or file manager you're using. If an older Nourish is installed, uninstall it first. |
| Connected to the wrong PC | **Settings → Server & devices → Connect to a different PC**. |
| Want to go back to phone-only | On the connect screen, tap **Use this phone only instead**, or **Settings → Server & devices → Use on this phone only**. |

### AI on the phone

| Problem | What to do |
|---|---|
| A model isn't in my top 5 / says "Too big for this phone" | The list only recommends models that fit the memory the phone lets Nourish use. **Show other models** lists the rest; you can still download one, but it may crash or be very slow. |
| The download stopped | Phones pause downloads when locked or when you switch apps. Open **Settings → AI model** and tap **Download** again: it continues where it stopped. |
| "Hugging Face refused the download" | That model is gated. Sign in under **Hugging Face account** with a token from huggingface.co/settings/tokens, and accept the model's licence on its Hugging Face page first. |
| The app closes while making a plan | The model needs more memory than iOS/Android gave the app. Pick a smaller model (the "Recommended" one), or lower **Memory for chat** to 2k. |
| Plans are slow or the phone gets hot | Use a smaller model ("Fastest" / "Runs cool"). Keep **Use the graphics chip** on (iPhone). Let the phone cool down: the temperature shows on the AI model page. |
| Plans are repetitive or odd | Small models are limited. Try a 4B model or larger, or a cloud AI (Claude/OpenAI) with your own key. |

---

## Web search finds nothing

- "DuckDuckGo is limiting searches right now": DuckDuckGo throttles automated searches sometimes. Wait a few minutes, or get a free key at [brave.com/search/api](https://brave.com/search/api) and add it under **Settings → Recipe sources** (choose *Brave Search*).
- "No recipe was found on that page": the link has to be a page with one recipe on it, not a list of recipes, a video, or a page behind a login.
- Some sites block automated readers. Try another site, or another search.

---

## The plan never shows up

- Look at the bar at the top of the app. While a plan is cooking it shows a timer and **Cancel**. If something fails, the reason stays there until you tap **Dismiss**.
- Settings → **Test the AI** checks the whole path: app → Nourish server → your AI.
- The reply is broken or cut short: try **Response length: Long**, a lower **Creativity**, or a larger or non-"coder" model.

---

## My phone and PC show different settings or plans

Since 0.3.0, everything is kept on the PC and synced, usually within a few seconds (immediately when you switch back to the app).
- Open **Settings → Server & devices**. **Sync** should say "Up to date with your PC". Tap **Sync now** to force it.
- "Can't reach your PC right now": the phone is offline or on another Wi-Fi. Changes are kept on the phone and sent when it reconnects.
- If two devices change the *same* thing at the same moment, the last change wins.
- Everything is stored in `nourish-data.json` in the folder Nourish runs from. Deleting it resets the PC's copy; the next device that connects sends its own copy back.

## Other messages

| Message | What to do |
|---|---|
| "Can't reach the Nourish server. Is it running on your PC?" | Start `uvicorn` (README). On the phone: use the PC's IP address, not `localhost`, and make sure both are on the same Wi-Fi. |
| iPhone can't load `http://192.168.x.x:8000` | Windows Firewall: allow Python on **Private** networks (Control Panel → Windows Defender Firewall → Allow an app). Check that you used `--host 0.0.0.0` when starting uvicorn. |
| "Claude returned 401: API key is invalid." | Re-copy the key into Settings. Claude keys start with `sk-ant-`. |
| "Spoonacular needs a free API key" | Get one at https://spoonacular.com/food-api and paste it in Settings → Recipe sources. |
| "Ollama not reachable at http://localhost:11434" | Start Ollama, and download the model named in Settings (e.g. `ollama pull llama3.2`). |
