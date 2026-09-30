# Nourish — Repository Audit

Audit date: 2026-09-30 · Branch `claude/bold-carson-dxhhiv` · Starting commit `14cb13f`.

**Status labels:** **FIXED** = changed in this branch and re-tested · **OPEN** = not fixed (the reason is given) · **FLAG** = needs a decision from the owner · **UNVERIFIED** = couldn't be tested here.

File:line references point to the **original** files at `14cb13f`.

---

## 1 — Does it actually run?

Setup: Python 3.12 venv. Backend `uvicorn main:app` on :8000. Frontend served by `python -m http.server 3000`. Chromium at 390×844 (mobile, touch). No real LLM is available in this sandbox, so a fake OpenAI-compatible server on :1234 stood in for LM Studio and returned a fixed 7-day plan.

### Before the fixes (commit `14cb13f`)

| Step | What actually happened |
|---|---|
| Load | Page loads. `GET :8000/api/models` → **503** (console: `Failed to load resource … 503`). The Today screen shows **hardcoded fake data** ("Thursday, Apr 9", "Oatmeal with Berries", "2,400 calories"). |
| Generate a plan | **Impossible.** The only "Generate" button is inside `#emptyState`, which is `display:none`, and `updateTodayScreen()` never runs on load. When the sheet was forced open from the console, its **backdrop covered the form**, so no button in it could be tapped (Playwright: `<div id="generateSheetBackdrop"> intercepts pointer events`). With forced clicks, AI Chef → backend 500 → an alert saying only **"Error: No response"**. The real cause, `host.docker.internal` not resolving outside Docker, was hidden. TheMealDB/Spoonacular → **404** (the endpoints never existed). Ollama → **500**. |
| Open a day | Nothing to open (no plan). |
| Open a meal | Nothing to open. |
| Check a grocery item | Empty list. |
| Reload | The fake placeholder meals come back. |
| Settings | **Empty screen** (heading only, 0 inputs). |
| Chat | **Doesn't exist** — no chat UI, JS or endpoint, in this commit or anywhere in git history. |

### After the fixes (page served by the backend at `http://localhost:8000/`)

| Step | What actually happened | Console |
|---|---|---|
| Load | "Today — No meal plan yet — Generate Meal Plan" | clean |
| Generate | Plan created: "Day 1 · Monday … 1,750 calories … Oatmeal day 1 / Chicken salad day 1 / Salmon rice day 1" | clean |
| Open a day | Plan tab → Day 1 expands to 3 meals | clean |
| Open a meal | Bottom sheet with ✕, macros, ingredients and steps. Closes with ✕. | clean |
| Grocery | Ticked 1 item → "1 of 9 items" | clean |
| Reload | Plan still there; 1 box still ticked | clean |
| Settings | Server: Connected · Provider: LM Studio · Model: mock-model · Spoonacular key · Clear meal plan | clean |
| Chat | Still doesn't exist — see **C5** | — |

Extra scenarios, all run in the browser:
- **Phone-style access from a different origin:** page at `http://my-pc.local:3000`, API at `http://my-pc.local:8000` → the plan generated, and CORS allowed it.
- **Real Claude API with an invalid key:** toast "Claude returned 401: API key is invalid."; button re-enabled; key not in the log.
- **Ollama not running:** "Ollama not reachable at http://localhost:11434 (ConnectError)".
- **LM Studio not running:** "LM Studio not reachable at http://localhost:1234 (ConnectError)".
- **Backend stopped:** banner "Can't reach the Nourish server…". The saved plan still shows. Generate → "Can't reach the Nourish server. Is it running on your PC?" The button and inputs are re-enabled.
- **Opened as `file://`:** banner telling the user to open http://localhost:8000.
- **LLM returns fenced JSON with a trailing comma:** the plan loads.
- **XSS payload in a recipe name** (`<img src=x onerror=…>`): shown as plain text; 0 `<img>` elements; the script didn't run. **The same payload against the original code executed** (`window.__xss = 1`).

Tests added: `backend/main_test.py` (12 tests, pass) and `tests/json-repair.test.js` (8 tests, pass). The old parser fails 6 of those 8.

---

## Critical

- **C1 — API keys written to the log, and the log served to any website.** `backend/main.py:108` logged `Request headers` (containing `x-api-key` / `Authorization: Bearer`) at DEBUG, and the root logger was set to DEBUG. `GET /api/logs` (`main.py:199`) returned the log with `Access-Control-Allow-Origin: *`. **Reproduced:** a test key sent through `/api/generate` came back from `/api/logs` when requested with `Origin: https://evil.example`. **FIXED:** no header/body logging, INFO by default, httpx logger at WARNING, both `/api/logs` endpoints deleted. A test asserts the key never shows up in any log record, even at DEBUG. The log files committed in history (`backend/nourish.log` at `25a3e88`, `77c2dab`, `14cb13f^`) were checked: no keys in them.
- **C2 — No plan could be generated on first load.** `app.js:24-29` never rendered the empty state, `index.html:121` hid the only Generate button, and `styles.css:490/505` let the fixed backdrop paint over the sheet. **FIXED:** everything renders on load, the sheet content is `position:relative` and pinned to the bottom, and there's a "New plan" button in the header.
- **C3 — Settings screen was empty.** `index.html:150` `#settingsList` was never filled in, so there was no way to choose a provider or enter a key. `saveSettings()` existed but nothing called it. **FIXED:** the Settings screen is built in `renderSettings()`.
- **C4 — TheMealDB and Spoonacular called endpoints that never existed.** `app.js:616`, `app.js:657` → `/api/recipes/*` were not defined in any version of `main.py` in history. **FIXED:** both added to the backend. The Spoonacular key is sent in a header, not the URL. Tested with faked upstream responses; live calls are **UNVERIFIED**.
- **C5 — There is no chat feature.** The requested walkthrough ends with "send a chat message", but no chat has ever existed in this repo. **FIXED (follow-up, at the owner's request):** a Chat tab that can turn the conversation into the plan ("Make plan"). See the follow-up section.
- **C6 — XSS through recipe text.** `app.js:236,266,281,295,342,374,378,423-428` put LLM/TheMealDB/Spoonacular strings into `innerHTML`. `renderPlanMeal` (`app.js:374`) also put the whole meal JSON into an inline `onclick`. **Reproduced** script execution on the original code. **FIXED:** all dynamic content is built with `textContent` through the `h()` helper. The only `innerHTML` left in the codebase: none.
- **C7 — The plan was lost on reload and the placeholder data came back.** **FIXED:** `nourish_plan` and `nourish_grocery_checked` are saved in localStorage.

## High

- **H1 — Hardcoded `http://localhost:8000` everywhere** (`app.js:69,114,523,551,574,601,616,657`). On an iPhone, `localhost` means the phone itself, so phone access could never work. **FIXED:** the backend hosts the frontend, so calls are same-origin. When the page is served elsewhere, it uses `<same host>:8000`. Verified with the `my-pc.local` origin test.
- **H2 — CORS `allow_origins=["*"]`** (`main.py:31`). **FIXED:** now only `localhost`, `127.0.0.1`, `[::1]`, `10/8`, `192.168/16`, `172.16/12` and `*.local`, on any port. Tested allowed and blocked origins, including the lookalike `192.168.1.23.evil.example`.
- **H3 — Default LM Studio URL was `host.docker.internal`** (`main.py:79,93`, `.env.example`). That name only resolves inside Docker, so every non-Docker install failed. The frontend's LM Studio URL setting was never sent to the backend. **FIXED:** the default is `localhost:1234`; `docker-compose.yml` sets `host.docker.internal`. The unused client-sent `base_url` field was removed; it also allowed anyone on the LAN to make the server request any URL (SSRF).
- **H4 — Upstream errors were hidden.** `main.py:114-119` returned the upstream JSON with HTTP 200 even on a 401, and the frontend never checked `res.ok`, so users saw "No response". **FIXED:** errors pass through with the provider's message.
- **H5 — Ollama was unsupported by the backend** (`app.js:600-613` sent `provider: 'ollama'` with a `prompt` field, and `main.py:103` returned 400, wrapped into a 500). **FIXED:** the backend handles Ollama through its OpenAI-compatible `/v1/chat/completions`.
- **H6 — Claude and OpenAI prompts didn't include the JSON schema** (`app.js:560,584`), so they returned arbitrary JSON shapes. Claude's "system" message format was also wrong for the Messages API. **FIXED:** one shared schema prompt; the backend moves system messages into Claude's top-level `system` field.
- **H7 — Fake nutrition numbers.** `app.js:644,682` gave every TheMealDB/Spoonacular meal 2,000 kcal (6,000 a day). **FIXED:** TheMealDB shows "—" (it has no nutrition data); Spoonacular's real nutrition is read.
- **H8 — Vulnerable dependencies.** See Security below. **Partly FIXED.**
- **H9 — CodeQL workflow has failed on every push.** `.github/workflows/codeql.yml:44-47`: the `matrix.include` list is empty. GitHub Actions shows 21 runs of this workflow, all "failure". Code scanning still runs through GitHub's **default setup** ("Scheduled", succeeding weekly). **FLAG / OPEN:** I tried to delete the broken duplicate workflow, but that action was blocked by this session's safety policy. Deleting it or disabling it is your call. Alternatively, add `- language: javascript-typescript` and `- language: python` (both with `build-mode: none`) under `include:`. Note that GitHub may refuse an advanced workflow while default setup is on.

## Medium

- **M1 — JSON parser.** The old version (`app.js:698-708`) removed `//…` even inside strings, so any URL in a recipe step broke parsing of otherwise clean JSON. It also couldn't handle truncated output. **FIXED:** `json-repair.js` handles fences, surrounding prose, `//` and `/* */` comments outside strings, trailing commas, escaped quotes, and truncation (keeps every complete day). 8 tests.
- **M2 — Output budget too small.** 4,000 tokens for 21 full recipes often got cut off. **FIXED:** 8,000 tokens, and the prompt caps each meal at 8 ingredients and 5 steps. If a plan still comes back short, the app keeps the complete days and says so. Whether large local models actually fit is **UNVERIFIED**.
- **M3 — Division by zero.** `app.js:451`: `checked / total` with an empty list gave `NaN%`. **FIXED:** guarded; tested with a plan that has no ingredients.
- **M4 — No error handling on fetch; UI not re-enabled on every path.** **FIXED:** one `api()` helper with a timeout, readable messages, and a server-status update. The generate path disables all sheet inputs and re-enables them in `finally`. Verified for the server-down, bad-key and LLM-down paths.
- **M5 — Chroma telemetry.** Chroma sent anonymous telemetry (and logged errors about it), which contradicts the README's "no data leaves your machine". **FIXED:** disabled.
- **M6 — Startup blocked for about 25 seconds without internet.** The embedding model downloaded at startup, retrying against huggingface.co. **FIXED:** the knowledge base loads lazily, on first use.
- **M7 — Knowledge base has no UI.** `/api/knowledge/*` isn't used by the current frontend (the redesign in `2438113` removed that UI). It's also why the install pulls in PyTorch (about 3 GB) and the only reason Python is pinned to 3.12. **FLAG:** not deleted, because the README advertises it. Recommendation: remove it, or make it an optional extra (`requirements-kb.txt`), for the iPhone/zero-config goal.
- **M8 — API keys in plain text in localStorage.** This is the nature of a client-side settings screen. Mitigations: the keys go only to your own server, and the server can hold them instead (`backend/.env` fallback added). **OPEN** (by design).
- **M9 — No authentication on the backend.** Anyone on the same Wi-Fi can use the server, including any keys stored in `.env`. **OPEN.** This is acceptable for a home network; don't expose port 8000 to the internet.
- **M10 — `nourish.log` was never ignored.** The commit "add gitignore, untrack nourish.log" deleted the file but never added a gitignore. **FIXED:** root `.gitignore` covers `*.log`, `.env`, `chroma_data`, `.venv` and `*.bak`.
- **M11 — Absolute Windows path with a username was committed** (`index.html.bak`: `c:\Users\ss\Desktop\Stonys MInd\...`). **FIXED** (file deleted). **OPEN:** it's still in git history. Rewriting history needs a force-push, which is out of scope and needs your approval.
- **M12 — Dockerfile used Python 3.11 while local setup needed 3.12.** **FIXED:** `python:3.12-slim`. `docker-compose.yml` failed when `backend/.env` didn't exist; it's now `required: false`. **UNVERIFIED:** no Docker daemon was available here.
- **M13 — Dependabot watched `npm`, but there is no `package.json`.** **FIXED:** now watches `pip` (`/backend`), `docker` and `github-actions`. Note: the open Dependabot branch `dependabot/pip/backend/pip-51f24ed7e3` (python-multipart 0.0.22) is superseded by 0.0.31 here.

## Low

- **L1** — `styles.css:292` `active: scale(0.98)` is not a valid CSS property. **FIXED** (removed).
- **L2** — `.label` was defined twice, and `.caption` duplicated it (`styles.css:56,64,424`). **FIXED** (merged; `.caption` removed).
- **L3** — The Today title combined a weekday name with *today's* date ("Monday, Sep 30"), which mismatched the plan. **FIXED:** now "Day N · Weekday".
- **L4** — The goal and source restored from storage weren't highlighted in the sheet. **FIXED.**
- **L5** — The calorie ring target is a fixed 2,400 regardless of Cut/Maintain/Gain. **OPEN** (product decision).
- **L6** — TheMealDB "avoid" filtering is a substring match (avoiding "egg" also drops "eggplant"). **OPEN.**
- **L7** — `.vscode/settings.json` contains machine-specific MCP sampling config. There's no secret in it. **OPEN** (harmless).
- **L8** — The backend used the deprecated `@app.on_event("startup")`, which newer Starlette versions drop. **FIXED:** `lifespan`.
- **L9** — OpenAI's newest models want `max_completion_tokens` instead of `max_tokens`. `gpt-4o` (the default) accepts `max_tokens`. **OPEN / UNVERIFIED.**

---

## 2 — Dead code and drift (original code)

**Functions in app.js that nothing calls**
- `saveSettings()` (`app.js:101`) — never called. Removed.
- `fetchUSDANutrition()` (`app.js:710`) — called, but its body was empty. Removed along with the USDA setting.
- `checkBackend()` (`app.js:67`) — called, but its result was thrown away. Now drives the status and offline banner.

**Unused state** (`app.js:7-21`): `lmStudioUrl` (never sent), `usdaApiKey`, `ollamaUrl`, `themealdbEnabled`, `autoFetchUSDA`, `showNutritionBadges`, `useKB`, `kbEntries`, `groceryItems`. All removed.

**Element IDs referenced in JS but missing from index.html:** none. (`progressFill` was created dynamically.)

**Element IDs in index.html that nothing touched:** `macroBars`, `breakfastName`, `lunchName`, `dinnerName`, `goalSegments`, `sourceButtons`, `generateSheetContent` — removed. (`settingsList` is now used.)

**CSS selectors that matched nothing:** `.settings-group`, `.settings-group-label`, `.settings-row`, `.settings-label` (now used by the new Settings screen); `.toggle-switch`, `.toggle-switch.on`, `::before` (removed); `.accordion-content` and `[aria-expanded] ~ .accordion-content` grid rules (no effect because JS toggled `display`; removed); `.grocery-item input:checked` background (no effect on a native checkbox; replaced with `accent-color`).

**Backend endpoints the frontend never called:** `GET/DELETE /api/logs` (deleted; they were also C1); `/api/knowledge`, `/api/knowledge/add`, `/add-text`, `/query`, `DELETE /api/knowledge/{name}` — **FLAG** (M7).

**Frontend calls to endpoints that didn't exist:** `POST /api/recipes/themealdb`, `POST /api/recipes/spoonacular` (added); `POST /api/generate` with `provider: 'ollama'` (now supported).

**Duplicate or contradictory implementations:**
- Four `generateWith*` functions with different prompts; only LM Studio's included the schema. Merged into `generateWithAI`.
- The LM Studio URL was configured in both the frontend and the backend; only the backend's was used. Now backend only.
- Defaults were duplicated between the state declarations and `loadSettings()`. Now one `settings` object.
- The `GenerateRequest.base_url` field was never sent. Removed.

**localStorage keys**
- Read but never written: `themealdb_enabled`, `spoonacular_api_key`, `usda_api_key`, `autofetch_usda`, `show_nutrition_badges`, `use_kb`. Plus `lmstudio_url`, `claude_api_key`, `claude_model`, `openai_api_key`, `openai_model`, `ollama_url` and `active_provider`, which only `saveSettings()` wrote, and nothing called it.
- Written but never read: none.
- Keys now: `active_provider`, `ollama_model`, `claude_api_key`, `claude_model`, `openai_api_key`, `openai_model`, `spoonacular_api_key`, `saved_goal`, `saved_source`, `saved_likes`, `saved_hates`, `nourish_plan`, `nourish_grocery_checked`. Every one is both read and written. Old keys left in a user's browser are ignored and harmless.

---

## 3 — Security

### Dependencies

GitHub's Dependabot alert list isn't readable with the tools in this session, so it was reproduced with `pip-audit -r backend/requirements.txt`. Seven packages had advisories:

| Package | Was | Now | Advisories | Status |
|---|---|---|---|---|
| fastapi | 0.104.1 | 0.142.2 | CVE-2024-24762 | **FIXED** |
| python-multipart | 0.0.9 | 0.0.31 | 7 (CVE-2024-53981, CVE-2026-24486, -40347, -42561, -53538, -53539, -53540) | **FIXED** |
| python-dotenv | 1.0.0 | 1.2.2 | CVE-2026-28684 | **FIXED** |
| starlette (transitive) | 0.27.0 | 1.7.0 | 7 (CVE-2024-47874, CVE-2025-54121, …) | **FIXED** (now pinned) |
| anyio (transitive) | 3.7.1 | 4.15.1 | 2 | **FIXED** (now pinned) |
| chromadb | 0.5.23 | 0.5.23 | 3 (CVE-2026-45830, -45831, -45833) — **no fixed version listed** | **OPEN** |
| transformers (transitive) | 4.46.3 | 4.46.3 | 26 (fixed in ≥4.48 … 5.10) | **OPEN — needs a breaking change** |

**Why transformers can't move:** `chromadb 0.5.23` requires `tokenizers<=0.20.3`, which caps `transformers` at 4.46.x. Fixing it means `chromadb` 1.x, a rewrite with a different on-disk format and client API. Existing `chroma_data` would need migrating, and the knowledge-base code retesting. Per the rules, this is documented rather than forced. If the knowledge base is removed (M7), both problems go away, along with the Python 3.12 pin and PyTorch.

**Likely mapping to Dependabot's "12":** Dependabot reports on packages listed directly in `requirements.txt`. fastapi 1 + python-multipart 7 + python-dotenv 1 + chromadb 3 = 12, which matches the reported count. 9 of those are fixed; chromadb's 3 have no upstream fix. **UNVERIFIED:** the alert page itself couldn't be read, so severities weren't cross-checked.

**Testing after the upgrade:** the backend test suite (12 tests) passes, and the full browser walkthrough passes on the upgraded versions. The upgrades were installed as one set rather than one at a time: FastAPI, Starlette and anyio must move together, and the other packages are independent. A knowledge-base smoke test was **UNVERIFIED** (huggingface.co is blocked here, so the embedding model can't download).

### Other checks

- **CORS:** see H2. **FIXED.**
- **API keys in logs, tracebacks and URLs:** see C1. Keys are never logged, and error messages include only the exception type and the provider's own message. The Spoonacular key moved from the URL to a header. The frontend sends keys only in POST bodies to its own server. **FIXED.**
- **Keys in git:** all history scanned for `sk-ant-`, `sk-…`, `Bearer`, `x-api-key` values. Only code and placeholders were found. No `.env` has ever been committed.
- **Absolute paths and machine names:** `index.html.bak` (M11). Also, `.vscode/settings.json` names the workspace folder (`Nourish/.vscode/mcp.json`), which isn't sensitive. Old commits link to `github.com/stonys-mind/nourish`, an org name, not a secret.
- **Static file exposure:** the backend now serves exactly four named files. A test confirms that `/.env`, `/backend/.env`, `/.git/config`, `/main.py` and `/nourish.log` return 404.
- **innerHTML:** see C6. No `innerHTML` remains in `app.js`.

---

## 4 — Correctness checklist

| Check | Status |
|---|---|
| Every fetch wrapped, with a user-visible error | **FIXED** — all calls go through `api()`; errors show as a toast or the offline banner |
| Disabled UI re-enabled in `finally` | **FIXED** — `generateMealPlan` |
| No division by zero | **FIXED** — grocery progress and calorie ring |
| Optional chaining on nested API fields | **FIXED** — plus `normalizePlan()`, which validates and cleans every day and meal before use |
| JSON parser: clean, fenced, trailing commas, comments, truncated | **FIXED** — 8 tests |
| Nothing assumes a plan exists | **FIXED** — every screen has an empty state; a corrupted saved plan loads as an empty plan instead of crashing |

---

## 5 — The iPhone goal: an honest assessment

Goal: *one file to install on the PC, one app on the iPhone, zero configuration.*

**Now in place:**
- The server hosts the app, so the phone needs one address: `http://<PC-IP>:8000`.
- Every input is ≥16px (checked in the browser: 0 inputs below 16px).
- Every visible touch target is ≥44px. Checked on Today (empty and with a plan), the Generate sheet, the Plan tab, the recipe sheet, Grocery, and Settings with each provider: 0 below 44px. The grocery checkbox itself is 22px, but the whole 44px row is its tap area.
- Safe-area insets are handled at top, bottom and sides, and the page uses `viewport-fit=cover`.
- There are no hover-only interactions (the single `:hover` is cosmetic and gated by `@media (hover: hover)`). Nothing needs a keyboard.
- When the server is unreachable, the saved plan and grocery list still work, and a banner explains the problem.
- "Add to Home Screen" gives a full-screen app icon.

**Still blocking the goal:**
1. **Installer — mostly solved (follow-up).** The knowledge base is now optional (`requirements-core.txt`). GitHub Actions builds a single ~22 MB `Nourish.exe` that needs no Python. It's unsigned, so Windows SmartScreen warns on first run.
2. **The LLM still needs manual setup:** install LM Studio, download a model, start its server. Or paste a Claude/OpenAI key.
3. **The phone needs the PC's IP address,** which can change (DHCP), and a Windows Firewall prompt must be accepted. mDNS (`http://<pcname>.local:8000`) usually works on iPhone and is allowed by CORS, but isn't documented as reliable.
4. **No offline iPhone app.** Plain `http://` on the LAN isn't a secure context, so iOS won't run a service worker. The home-screen icon won't open anything unless the PC is on and reachable. Fixing this needs HTTPS (a local certificate the phone trusts) or a native wrapper.
5. **No web app manifest or icon** — iOS will use a page screenshot as the icon. **OPEN** (polish).
6. **The PC must stay on** while you generate plans. After that, the plan is stored on the phone, but only as long as Safari doesn't clear site data (iOS can remove it after about 7 days without a visit to the site).

---

## Follow-up round (after the first push)

What the owner reported, and what was done:

- **Plan generation couldn't reach LM Studio.** The owner was running an older, never-committed local version in Docker, with `http://localhost:1234` in Settings. Inside Docker, `localhost` is the container itself. Diagnosed with `docker compose exec backend python -c "…httpx.get(…)"`: `host.docker.internal:1234` returned 200 and `localhost:1234` was refused. **Resolved** by the owner's configuration (the owner then switched to the version on GitHub).
- **"Nothing was made" even though LM Studio returned a full plan.** **Not reproducible here.** LM Studio's exact output shape (a code fence, a `// Repeat…` comment line, 7 days, a 73-second wait) was replayed against the app, and the plan appeared. The most likely causes on a phone are a dropped long request, or an error toast that vanished after 6 seconds. **FIXED both ways:** generation now runs as a server-side job (`/api/jobs`) that the app polls and resumes after a reload. Tested by reloading mid-generation: the plan still arrived. Errors now stay in a status bar until dismissed. There's also a Cancel button. **UNVERIFIED** on the owner's machine.
- **Chat tab** (C5): multi-turn chat using the profile and the current plan; "Make plan" turns the conversation into the 7-day plan; "Ask the chef about this meal" from any recipe; history is saved; formatting is safe (lists and bold built as DOM nodes, and an XSS payload was tested and not executed).
- **Detailed Settings**:
  - AI: a model picker (lists from LM Studio/Ollama, which also fixes the silent "first model in the list" choice), creativity, response length, and a Test-the-AI button.
  - A full profile — calories, protein, diet, allergies, cuisines, cook time, servings, skill, budget, units — injected into every plan and chat prompt. Diet, allergies and cook time are also passed to Spoonacular; allergies to TheMealDB.
  - The phone address from `/api/info`, and export/clear/reset.
  - Everything saves automatically, with a visible "Saved ✓".
- **Windows .exe**: `backend/nourish_app.py` is the launcher. It prints the phone address, opens the browser, and handles "already running". `.github/workflows/build-exe.yml` builds, tests and smoke-tests it on `windows-latest`. **Verified here:** the same PyInstaller build on Linux (22 MB) ran from an empty folder: page served, `.env` blocked, plan and chat work, second launch detected. **UNVERIFIED:** the Windows build itself, until the workflow runs on GitHub.
- **Bug found and fixed during testing:** `replaceChildren(null)` printed the word "null" in Settings (and could in the recipe sheet). Replaced with a null-safe `setChildren` helper, and checked that no "null" text appears on any screen.
- AI time limit raised from 5 to 15 minutes (a 14B model writing 12k tokens can take longer than 5).
- Core dependencies tested on Python 3.12 and 3.13 (19/19 backend tests pass). They also resolve on 3.14 (not run).

## UNVERIFIED (and why)

- **Live TheMealDB, Spoonacular and USDA calls** — those hosts are blocked by this sandbox's network policy. The endpoints were tested against faked responses in the documented format.
- **Real LM Studio, Ollama and OpenAI generation** — none are available here. LM Studio was stood in for by a fake OpenAI-compatible server. A real Claude call was tested only with an invalid key (401 path).
- **Knowledge base** — huggingface.co is blocked, so the embedding model can't download. The endpoints return a clean 503 here.
- **Docker** — no Docker daemon in this environment. `Dockerfile` and `docker-compose.yml` were edited but not built.
- **Actual iPhone Safari** — tested with Chromium in mobile emulation (390×844, touch) only. Safe-area insets are zero in emulation.
- **Exact Dependabot alert list** — not readable with the tools here; reproduced with `pip-audit`.
