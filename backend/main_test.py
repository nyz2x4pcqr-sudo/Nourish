"""Backend tests. Run from backend/:  python -m unittest -v
Upstream services (LM Studio, Claude, TheMealDB, ...) are faked with httpx.MockTransport,
so no network or API keys are needed."""
import json
import logging
import unittest

import httpx
from fastapi.testclient import TestClient

import tempfile
from pathlib import Path

import main

# Keep the tests' shared data away from any real nourish-data.json.
main.store.reset_for_tests(Path(tempfile.mkdtemp()) / "nourish-data.json")

SECRET = "sk-ant-TEST-SECRET-do-not-log"
_RealAsyncClient = httpx.AsyncClient


class FakeUpstream:
    def __init__(self):
        self.requests = []
        self.fail = None  # "unreachable" | int status

    def __call__(self, request: httpx.Request):
        self.requests.append(request)
        if self.fail == "unreachable":
            raise httpx.ConnectError("connection refused", request=request)
        if isinstance(self.fail, int):
            return httpx.Response(self.fail, json={"error": {"message": "invalid x-api-key"}})
        path = request.url.path
        if path.endswith("/search.php"):
            term = request.url.params["s"]
            return httpx.Response(200, json={"meals": [{"idMeal": term, "strMeal": f"{term} dish", "strIngredient1": "Mushroom" if term == "b" else "Rice"}]})
        if path.endswith("/recipes/complexSearch"):
            return httpx.Response(200, json={"results": [{"title": "Spoon dish"}]})
        if path.endswith("/v1/messages"):
            return httpx.Response(200, json={"content": [{"type": "text", "text": "{}"}]})
        if path.endswith("/v1/models"):
            return httpx.Response(200, json={"data": [{"id": "local-model"}]})
        if path.endswith("/api/tags"):
            return httpx.Response(200, json={"models": [{"name": "llama3.2:latest"}, {"name": "qwen2.5:7b"}]})
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}}]})


class CapturingHandler(logging.Handler):
    def __init__(self):
        super().__init__(level=logging.DEBUG)
        self.messages = []

    def emit(self, record):
        self.messages.append(record.getMessage())


class ApiTest(unittest.TestCase):
    def setUp(self):
        self.up = FakeUpstream()
        up = self.up

        class PatchedClient(_RealAsyncClient):
            def __init__(self, *a, **kw):
                kw["transport"] = httpx.MockTransport(up)
                super().__init__(*a, **kw)

        main.httpx.AsyncClient = PatchedClient
        self.client = TestClient(main.app)
        self.logs = CapturingHandler()
        root = logging.getLogger()
        self._old_level = root.level
        root.setLevel(logging.DEBUG)  # even debug output must not contain secrets
        root.addHandler(self.logs)

    def tearDown(self):
        main.httpx.AsyncClient = _RealAsyncClient
        logging.getLogger().removeHandler(self.logs)
        logging.getLogger().setLevel(self._old_level)

    def test_health(self):
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})

    def test_serves_frontend_only(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("<title>", r.text)
        for f in ("app.js", "ondevice.js", "styles.css", "json-repair.js", "grocery.js", "units.js", "recipes.js", "importer.js", "nutrition-data.js", "nutrition.js", "services.js", "crosscheck.js", "prefs.js", "planner.js", "sources.js", "finder.js", "library.js", "books.js", "recipedb.js", "foodlog.js", "taste.js", "builtins.js", "theme.js"):
            self.assertEqual(self.client.get(f"/{f}").status_code, 200, f)
        for f in (".env", "README.md", "main.py", "nourish.log", "..%2Fbackend%2F.env"):
            self.assertEqual(self.client.get(f"/{f}").status_code, 404, f)
        self.assertEqual(self.client.get("/backend/.env").status_code, 404)
        self.assertEqual(self.client.get("/.git/config").status_code, 404)

    def test_every_served_file_exists(self):
        for name in main.FRONTEND_FILES:
            self.assertTrue((main.FRONTEND_DIR / name).is_file(), name)
            self.assertEqual(self.client.get(f"/{name}").status_code, 200, name)

    def test_logs_endpoint_removed(self):
        self.assertEqual(self.client.get("/api/logs").status_code, 404)

    def test_cors(self):
        def acao(origin):
            return self.client.get("/health", headers={"Origin": origin}).headers.get("access-control-allow-origin")
        for ok in ("http://localhost:3000", "http://127.0.0.1:8000", "http://192.168.1.23:3000",
                   "http://10.0.0.5:8000", "http://172.20.1.2:8000", "http://my-pc.local:8000"):
            self.assertEqual(acao(ok), ok, ok)
        for bad in ("https://evil.example", "http://192.168.1.23.evil.example", "http://172.15.0.1:8000", "null"):
            self.assertIsNone(acao(bad), bad)

    def test_claude_system_prompt_and_key_not_logged(self):
        r = self.client.post("/api/generate", json={
            "provider": "claude", "model": "claude-haiku-4-5", "api_key": SECRET,
            "messages": [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 200)
        sent = json.loads(self.up.requests[-1].content)
        self.assertEqual(sent["system"], "SYS")
        self.assertEqual([m["role"] for m in sent["messages"]], ["user"])
        self.assertEqual(self.up.requests[-1].headers["x-api-key"], SECRET)
        self.assertFalse([m for m in self.logs.messages if SECRET in m])

    def test_upstream_auth_error_is_passed_through(self):
        self.up.fail = 401
        r = self.client.post("/api/generate", json={"provider": "openai", "model": "gpt-4o", "api_key": SECRET,
                                                    "messages": [{"role": "user", "content": "hi"}]})
        self.assertEqual(r.status_code, 401)
        self.assertIn("invalid x-api-key", r.json()["detail"])
        self.assertNotIn(SECRET, r.text)
        self.assertFalse([m for m in self.logs.messages if SECRET in m])

    def test_missing_key(self):
        main.os.environ.pop("ANTHROPIC_API_KEY", None)
        r = self.client.post("/api/generate", json={"provider": "claude", "model": "m", "messages": []})
        self.assertEqual(r.status_code, 400)
        self.assertIn("Settings", r.json()["detail"])

    def test_ollama_routes_to_ollama(self):
        r = self.client.post("/api/generate", json={"provider": "ollama", "model": "llama3", "messages": []})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(str(self.up.requests[-1].url).startswith(main.OLLAMA_URL + "/v1/chat/completions"))

    def test_unknown_provider(self):
        r = self.client.post("/api/generate", json={"provider": "nope", "model": "m", "messages": []})
        self.assertEqual(r.status_code, 400)

    def test_unreachable_llm(self):
        self.up.fail = "unreachable"
        r = self.client.post("/api/generate", json={"provider": "lmstudio", "model": "m", "messages": []})
        self.assertEqual(r.status_code, 503)
        self.assertIn("LM Studio not reachable", r.json()["detail"])
        self.assertEqual(self.client.get("/api/models").status_code, 503)

    def test_themealdb_multiple_terms_and_exclude(self):
        r = self.client.post("/api/recipes/themealdb", json={"query": "a, b", "exclude": "mushroom"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual([m["strMeal"] for m in r.json()["meals"]], ["a dish"])

    def test_spoonacular_key_in_header_not_url(self):
        r = self.client.post("/api/recipes/spoonacular", json={"query": "chicken", "api_key": SECRET})
        self.assertEqual(r.status_code, 200)
        req = self.up.requests[-1]
        self.assertNotIn(SECRET, str(req.url))
        self.assertEqual(req.headers["x-api-key"], SECRET)
        main.os.environ.pop("SPOONACULAR_API_KEY", None)
        self.assertEqual(self.client.post("/api/recipes/spoonacular", json={"query": "x"}).status_code, 400)

    def test_temperature_passed_and_clamped(self):
        self.client.post("/api/generate", json={"provider": "lmstudio", "model": "m", "messages": [], "temperature": 0.3})
        self.assertEqual(json.loads(self.up.requests[-1].content)["temperature"], 0.3)
        self.client.post("/api/generate", json={"provider": "claude", "model": "m", "api_key": "k", "messages": [], "temperature": 1.5})
        self.assertEqual(json.loads(self.up.requests[-1].content)["temperature"], 1.0)  # Claude's maximum
        self.client.post("/api/generate", json={"provider": "lmstudio", "model": "m", "messages": []})
        self.assertEqual(json.loads(self.up.requests[-1].content)["temperature"], 0.7)

    def test_model_lists(self):
        self.assertEqual(self.client.get("/api/models").json()["data"][0]["id"], "local-model")
        ids = [m["id"] for m in self.client.get("/api/models?provider=ollama").json()["data"]]
        self.assertEqual(ids, ["llama3.2:latest", "qwen2.5:7b"])
        self.assertEqual(self.client.get("/api/models?provider=claude").status_code, 400)

    def test_info(self):
        data = self.client.get("/api/info").json()
        self.assertEqual(data["lmstudio_url"], main.LMSTUDIO_URL)
        self.assertIn("version", data)
        for url in data["lan_urls"]:
            self.assertRegex(url, r"^http://(192\.168|10\.|172\.)")

    def _wait_job(self, job_id):
        for _ in range(100):
            job = self.client.get(f"/api/jobs/{job_id}").json()
            if job["status"] != "running":
                return job
        self.fail("job never finished")

    def test_job_success(self):
        job_id = self.client.post("/api/jobs", json={"provider": "lmstudio", "model": "m", "messages": []}).json()["job_id"]
        job = self._wait_job(job_id)
        self.assertEqual(job["status"], "done")
        self.assertEqual(job["result"]["choices"][0]["message"]["content"], "{}")

    def test_job_error_keeps_message_and_hides_key(self):
        self.up.fail = 401
        job_id = self.client.post("/api/jobs", json={"provider": "openai", "model": "m", "api_key": SECRET, "messages": []}).json()["job_id"]
        job = self._wait_job(job_id)
        self.assertEqual((job["status"], job["status_code"]), ("error", 401))
        self.assertIn("invalid x-api-key", job["detail"])
        self.assertNotIn(SECRET, json.dumps(job))

    def test_unknown_job(self):
        r = self.client.get("/api/jobs/nope")
        self.assertEqual(r.status_code, 404)
        self.assertIn("try again", r.json()["detail"])

    def test_spoonacular_profile_filters(self):
        self.client.post("/api/recipes/spoonacular", json={"query": "x", "api_key": "k", "diet": "vegetarian",
                                                           "intolerances": "peanut", "max_ready_time": 30})
        params = self.up.requests[-1].url.params
        self.assertEqual((params["diet"], params["intolerances"], params["maxReadyTime"]), ("vegetarian", "peanut", "30"))



RECIPE_GRAPH_PAGE = """<html><head><script type="application/ld+json">
{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},
 {"@type":["Recipe"],"name":"Garlic &amp; Lemon Chicken","totalTime":"PT1H5M",
  "recipeIngredient":["2 chicken breasts","3 cloves garlic","1 lemon"],
  "recipeInstructions":[{"@type":"HowToSection","name":"Prep","itemListElement":[{"@type":"HowToStep","text":"Mince the <b>garlic</b>."}]},
                        {"@type":"HowToStep","text":"Bake 25 minutes."}],
  "nutrition":{"@type":"NutritionInformation","calories":"420 kcal","proteinContent":"38 g","carbohydrateContent":"6g","fatContent":"24.5 g"}}]}
</script></head><body>...</body></html>"""

RECIPE_STRING_STEPS_PAGE = """<script type="application/ld+json">[{"@type":"Recipe","name":"Peanut Noodles",
 "prepTime":"PT10M","cookTime":"PT15M","recipeIngredient":["noodles","peanut butter"],
 "recipeInstructions":"Boil the noodles. Stir in the sauce.",}]</script>"""

DDG_PAGE = """<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Frecipes.example%2Fgarlic-chicken&amp;rut=1">Garlic</a></div>
<div class="result"><a class="result__a" href="https://recipes.example/peanut-noodles">Peanut</a></div>
<div class="result"><a class="result__a" href="https://www.youtube.com/watch?v=1">Video</a></div>
<div class="result"><a class="result__a" href="https://recipes.example/not-a-recipe">Blog</a></div>"""


class WebRecipeTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.up = FakeUpstream()
        web_recipes_mod = main.web_recipes
        self._allow = web_recipes_mod.ALLOW_PRIVATE
        web_recipes_mod.ALLOW_PRIVATE = True  # fake hosts don't resolve offline
        up = self.up

        def handler(request):
            up.requests.append(request)
            url = str(request.url)
            if "duckduckgo" in url:
                return httpx.Response(200, text=DDG_PAGE)
            if url.endswith("/garlic-chicken"):
                return httpx.Response(200, text=RECIPE_GRAPH_PAGE, headers={"content-type": "text/html; charset=utf-8"})
            if url.endswith("/peanut-noodles"):
                return httpx.Response(200, text=RECIPE_STRING_STEPS_PAGE)
            if url.endswith("/moved"):
                return httpx.Response(302, headers={"location": "https://recipes.example/garlic-chicken"})
            if url.endswith("/members-only"):
                return httpx.Response(403, text="<html>Log in to see this</html>")
            return httpx.Response(200, text="<html>no recipe here</html>")
        self.up_handler = handler

        class PatchedClient(_RealAsyncClient):
            def __init__(self, *a, **kw):
                kw["transport"] = httpx.MockTransport(handler)
                super().__init__(*a, **kw)
        main.httpx.AsyncClient = PatchedClient
        web_recipes_mod.httpx.AsyncClient = PatchedClient

    def tearDown(self):
        main.web_recipes.ALLOW_PRIVATE = self._allow
        main.httpx.AsyncClient = _RealAsyncClient

    def test_parse_graph_recipe(self):
        r = main.web_recipes.parse_recipe(RECIPE_GRAPH_PAGE, "https://www.recipes.example/x")
        self.assertEqual(r["name"], "Garlic & Lemon Chicken")
        self.assertEqual(r["time_minutes"], 65)
        self.assertEqual(r["steps"], ["Mince the garlic .", "Bake 25 minutes."])
        self.assertEqual(r["nutrition"], {"calories": 420, "protein_g": 38, "carbs_g": 6, "fat_g": 24.5})
        self.assertEqual(r["source_name"], "recipes.example")

    def test_parse_string_steps_and_trailing_comma(self):
        r = main.web_recipes.parse_recipe(RECIPE_STRING_STEPS_PAGE, "https://recipes.example/p")
        self.assertEqual(r["steps"], ["Boil the noodles.", "Stir in the sauce."])
        self.assertEqual(r["time_minutes"], 25)
        self.assertIsNone(r["nutrition"])

    def test_no_recipe(self):
        self.assertIsNone(main.web_recipes.parse_recipe("<html><p>hello</p></html>", "https://x.example/"))

    def test_web_search_reads_recipes_and_excludes(self):
        r = self.client.post("/api/recipes/web", json={"query": "chicken dinner recipe", "number": 7})
        self.assertEqual(r.status_code, 200)
        names = [x["name"] for x in r.json()["recipes"]]
        self.assertEqual(sorted(names), ["Garlic & Lemon Chicken", "Peanut Noodles"])
        self.assertFalse(any("youtube" in str(q.url) for q in self.up.requests))
        r = self.client.post("/api/recipes/web", json={"query": "x", "exclude": "Peanut"})
        self.assertEqual([x["name"] for x in r.json()["recipes"]], ["Garlic & Lemon Chicken"])

    def test_import_follows_redirect(self):
        r = self.client.post("/api/recipes/import", json={"url": "recipes.example/moved"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["source_url"], "https://recipes.example/garlic-chicken")

    def test_import_page_without_recipe(self):
        r = self.client.post("/api/recipes/import", json={"url": "https://recipes.example/blog"})
        self.assertEqual(r.status_code, 422)
        self.assertIn("No recipe", r.json()["detail"])

    def test_private_addresses_blocked(self):
        main.web_recipes.ALLOW_PRIVATE = False
        for url in ("http://127.0.0.1:8000/.env", "http://192.168.1.1/", "http://10.0.0.2/", "http://[::1]/",
                    "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", "http://0.0.0.0/"):
            r = self.client.post("/api/recipes/import", json={"url": url})
            self.assertEqual(r.status_code, 422, url)
        import asyncio
        asyncio.run(main.web_recipes.check_public_url("http://8.8.8.8/"))  # a public address is allowed


    def test_web_fetch_returns_page_status_and_final_address(self):
        r = self.client.post("/api/web/fetch", json={"url": "recipes.example/moved"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["url"], "https://recipes.example/garlic-chicken")
        self.assertEqual(r.json()["status"], 200)
        self.assertIn("Lemon Chicken", r.json()["body"])
        self.assertIn("iPhone", self.up.requests[-1].headers["user-agent"])  # a browser's identity
        # A blocked page comes back with its status, so the app can offer "paste the text" instead.
        r = self.client.post("/api/web/fetch", json={"url": "https://recipes.example/members-only"})
        self.assertEqual((r.status_code, r.json()["status"]), (200, 403))

    def test_web_fetch_blocks_private_addresses(self):
        main.web_recipes.ALLOW_PRIVATE = False
        for url in ("http://127.0.0.1:8000/api/state", "http://192.168.1.1/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"):
            r = self.client.post("/api/web/fetch", json={"url": url})
            self.assertEqual(r.status_code, 422, url)


class UpdateTest(unittest.TestCase):
    def test_version_order(self):
        pv = main.updater.parse_version
        ordered = ["0.1.0-pre-alpha", "0.1.0-alpha", "0.1.0-beta", "0.1.0-rc.1", "0.1.0", "v0.2.0-pre-alpha", "0.10.0"]
        self.assertEqual(sorted(ordered, key=pv), ordered)
        self.assertIsNone(pv("latest"))

    def _check(self, releases, current="0.1.0-pre-alpha", prereleases=True):
        def handler(request):
            return httpx.Response(200, json=releases)

        class Client(_RealAsyncClient):
            def __init__(self, *a, **kw):
                kw["transport"] = httpx.MockTransport(handler)
                super().__init__(*a, **kw)
        main.updater.httpx.AsyncClient = Client
        try:
            import asyncio
            return asyncio.run(main.updater.fetch_latest(current, prereleases))
        finally:
            main.updater.httpx.AsyncClient = _RealAsyncClient

    def test_newer_release_found(self):
        asset = {"name": "Nourish.exe", "size": 5, "digest": "sha256:ABC", "browser_download_url": "https://github.com/x/Nourish.exe"}
        info = self._check([
            {"tag_name": "v0.1.0-pre-alpha", "prerelease": True, "assets": [asset]},
            {"tag_name": "v0.2.0-pre-alpha", "prerelease": True, "body": "notes", "html_url": "u", "assets": [asset]},
            {"tag_name": "v9.0.0", "draft": True, "assets": [asset]},
        ])
        self.assertTrue(info["update_available"])
        self.assertEqual(info["latest"], "0.2.0-pre-alpha")
        self.assertEqual(info["asset"]["sha256"], "abc")
        self.assertFalse(info["can_install"])  # not the packaged Windows app

    def test_up_to_date_and_stable_only(self):
        rel = [{"tag_name": "v0.1.0-pre-alpha", "prerelease": True, "assets": []},
               {"tag_name": "v0.2.0-beta", "prerelease": True, "assets": []}]
        self.assertFalse(self._check(rel, current="0.2.0-beta")["update_available"])
        self.assertFalse(self._check(rel, prereleases=False)["update_available"])

    def test_renumbered_release_is_newest(self):
        # 0.7.0 was followed by 0.1.7: the one published last is the latest, whatever its number.
        rel = [{"tag_name": "v0.1.7-pre-alpha", "prerelease": True, "published_at": "2026-10-03T04:00:00Z", "assets": []},
               {"tag_name": "v0.7.0-pre-alpha", "prerelease": True, "published_at": "2026-10-03T00:55:17Z", "assets": []},
               {"tag_name": "v0.6.0-pre-alpha", "prerelease": True, "published_at": "2026-10-02T22:01:09Z", "assets": []}]
        info = self._check(rel, current="0.7.0-pre-alpha")
        self.assertTrue(info["update_available"])
        self.assertEqual(info["latest"], "0.1.7-pre-alpha")
        self.assertFalse(self._check(rel, current="0.1.7-pre-alpha")["update_available"])
        self.assertTrue(self._check(rel, current="0.6.0-pre-alpha")["update_available"])

    def test_no_digest_means_no_install(self):
        info = self._check([{"tag_name": "v1.0.0", "assets": [{"name": "Nourish.exe", "browser_download_url": "https://x"}]}])
        self.assertTrue(info["update_available"])
        self.assertNotIn("asset", info)

    def _swap(self, payload, expected_sha):
        import asyncio, hashlib, tempfile, os, stat
        from pathlib import Path
        tmp = Path(tempfile.mkdtemp())
        exe = tmp / "Nourish.exe"
        exe.write_bytes(b"old version")
        exe.chmod(0o755)

        def handler(request):
            return httpx.Response(200, content=payload)

        class Client(_RealAsyncClient):
            def __init__(self, *a, **kw):
                kw["transport"] = httpx.MockTransport(handler)
                super().__init__(*a, **kw)
        saved = (main.updater.INSTALL_SUPPORTED, main.updater.sys.executable)
        main.updater.INSTALL_SUPPORTED, main.updater.sys.executable = True, str(exe)
        main.updater.httpx.AsyncClient = Client
        try:
            asyncio.run(main.updater.download_and_swap({"url": "https://github.com/x/Nourish.exe", "sha256": expected_sha}))
            return tmp, None
        except main.updater.UpdateError as e:
            return tmp, e
        finally:
            main.updater.INSTALL_SUPPORTED, main.updater.sys.executable = saved
            main.updater.httpx.AsyncClient = _RealAsyncClient

    def test_tampered_download_rejected(self):
        import hashlib
        tmp, err = self._swap(b"evil", hashlib.sha256(b"the real new version").hexdigest())
        self.assertIn("fingerprint", str(err))
        self.assertEqual((tmp / "Nourish.exe").read_bytes(), b"old version")
        self.assertEqual(sorted(p.name for p in tmp.iterdir()), ["Nourish.exe"])  # no leftovers

    def test_verified_download_swapped(self):
        import hashlib, os
        tmp, err = self._swap(b"new version", hashlib.sha256(b"new version").hexdigest())
        self.assertIsNone(err)
        self.assertEqual((tmp / "Nourish.exe").read_bytes(), b"new version")
        self.assertEqual((tmp / "Nourish.old.exe").read_bytes(), b"old version")
        self.assertTrue(os.access(tmp / "Nourish.exe", os.X_OK))

    def test_install_endpoint_refuses_without_check(self):
        main._last_update_info.clear()
        r = TestClient(main.app).post("/api/update/install")
        self.assertEqual(r.status_code, 409)



class StateTest(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "nourish-data.json"
        main.store.reset_for_tests(self.path)
        self.client = TestClient(main.app)

    def put(self, section, value):
        return self.client.put(f"/api/state/{section}", json={"value": value})

    def test_round_trip_and_revisions(self):
        self.assertEqual(self.client.get("/api/state").json(), {})
        r1 = self.put("plan", [{"breakfast": {"name": "Oats"}}]).json()
        r2 = self.put("plan", [{"breakfast": {"name": "Eggs"}}]).json()
        self.assertEqual((r1["rev"], r2["rev"]), (1, 2))
        state = self.client.get("/api/state").json()
        self.assertEqual(state["plan"]["value"][0]["breakfast"]["name"], "Eggs")
        self.assertEqual(state["plan"]["rev"], 2)

    def test_api_keys_are_never_sent_back(self):
        self.put("settings", {"diet": "Vegan", "claude_api_key": SECRET})
        text = self.client.get("/api/state").text
        self.assertNotIn(SECRET, text)
        settings = self.client.get("/api/state").json()["settings"]["value"]
        self.assertEqual(settings["diet"], "Vegan")
        self.assertTrue(settings["_secrets_set"]["claude_api_key"])
        self.assertFalse(settings["_secrets_set"]["openai_api_key"])
        self.assertEqual(main.store.secret("claude_api_key"), SECRET)

    def test_blank_key_keeps_saved_key_and_clear_removes_it(self):
        self.put("settings", {"claude_api_key": SECRET})
        self.put("settings", {"diet": "Keto", "claude_api_key": ""})  # another device saving other settings
        self.assertEqual(main.store.secret("claude_api_key"), SECRET)
        self.put("settings", {"diet": "Keto", "_clear": ["claude_api_key"]})
        self.assertEqual(main.store.secret("claude_api_key"), "")

    def test_saved_to_disk_and_reloaded(self):
        self.put("chat", [{"role": "user", "content": "hi"}])
        self.assertTrue(self.path.exists())
        main.store.reset_for_tests(self.path)  # like restarting the server
        self.assertEqual(self.client.get("/api/state").json()["chat"]["value"][0]["content"], "hi")

    def test_damaged_file_does_not_stop_the_app(self):
        self.path.write_text("{not json", encoding="utf-8")
        main.store.reset_for_tests(self.path)
        self.assertEqual(self.client.get("/api/state").json(), {})
        self.assertTrue(self.path.with_suffix(".damaged.json").exists())

    def test_cookbook_section_is_kept(self):
        book = {"recipes": [{"id": "r1", "source": "imported", "meal_type": "dinner", "recipe": {"name": "Tagine"}}]}
        self.assertEqual(self.put("cookbook", book).status_code, 200)
        main.store.reset_for_tests(self.path)  # like restarting the server
        self.assertEqual(self.client.get("/api/state").json()["cookbook"]["value"], book)

    def test_food_log_section_is_kept(self):
        log = {"days": {"2026-10-03": {"items": [{"name": "Banana", "nutrition": {"calories": 105}}], "meals": {"lunch": "eaten"}}}, "recents": [], "favorites": []}
        self.assertEqual(self.put("log", log).status_code, 200)
        main.store.reset_for_tests(self.path)  # like restarting the server
        self.assertEqual(self.client.get("/api/state").json()["log"]["value"], log)

    def test_taste_profile_section_is_kept(self):
        taste = {"on": True, "events": [{"t": 1, "type": "save", "name": "Lemon Salmon", "ings": ["salmon", "lemon"]}], "overrides": {"ingredients": {"mushroom": "dislike"}}}
        self.assertEqual(self.put("taste", taste).status_code, 200)
        main.store.reset_for_tests(self.path)  # like restarting the server
        self.assertEqual(self.client.get("/api/state").json()["taste"]["value"], taste)

    def test_rejects_bad_input(self):
        self.assertEqual(self.put("passwords", {}).status_code, 400)
        self.assertEqual(self.put("settings", ["not", "an", "object"]).status_code, 400)
        self.assertEqual(self.put("chat", "x" * (3 * 1024 * 1024)).status_code, 400)
        self.assertEqual(self.client.put("/api/state/plan", json={"nope": 1}).status_code, 400)

    def test_ai_uses_key_saved_on_the_pc(self):
        self.put("settings", {"claude_api_key": SECRET})
        up = FakeUpstream()

        class Client(_RealAsyncClient):
            def __init__(self, *a, **kw):
                kw["transport"] = httpx.MockTransport(up)
                super().__init__(*a, **kw)
        main.httpx.AsyncClient = Client
        try:
            r = self.client.post("/api/generate", json={"provider": "claude", "model": "m", "messages": []})
        finally:
            main.httpx.AsyncClient = _RealAsyncClient
        self.assertEqual(r.status_code, 200)
        self.assertEqual(up.requests[-1].headers["x-api-key"], SECRET)


class LibraryTests(unittest.TestCase):
    """The recipe library folders next to the data file."""

    def setUp(self):
        self.client = TestClient(main.app)

    def test_folders_are_created_listed_and_read(self):
        r = self.client.get("/api/library")
        self.assertEqual(r.status_code, 200)
        folder = Path(r.json()["folder"])
        self.assertTrue((folder / "Recipe Books").is_dir())
        self.assertTrue((folder / "My Recipes").is_dir())
        (folder / "My Recipes" / "soup.md").write_text("# Soup\n## Ingredients\n- 1 onion\n", encoding="utf-8")
        (folder / "My Recipes" / "notes.xlsx").write_text("x", encoding="utf-8")   # a spreadsheet: not a recipe file
        files = self.client.get("/api/library").json()["files"]
        self.assertEqual([f["path"] for f in files], ["My Recipes/soup.md"])
        got = self.client.post("/api/library/read", json={"path": "My Recipes/soup.md"}).json()
        self.assertEqual(got["kind"], "text")
        self.assertIn("1 onion", got["text"])
        (folder / "My Recipes" / "notes.xlsx").unlink()
        (folder / "My Recipes" / "soup.md").unlink()

    def test_books_are_read_a_slice_at_a_time_and_kindle_files_explained(self):
        import base64
        folder = Path(self.client.get("/api/library").json()["folder"])
        book = folder / "Recipe Books" / "book.epub"
        book.write_bytes(b"PK0123456789")
        (folder / "Recipe Books" / "old.azw3").write_bytes(b"kindle")
        try:
            paths = [f["path"] for f in self.client.get("/api/library").json()["files"]]
            self.assertIn("Recipe Books/book.epub", paths)
            self.assertIn("Recipe Books/old.azw3", paths)
            got = self.client.post("/api/library/read", json={"path": "Recipe Books/book.epub"}).json()
            self.assertEqual(got, {"kind": "epub", "size": 12})
            part = self.client.post("/api/library/range", json={"path": "Recipe Books/book.epub", "offset": 2, "length": 4}).json()
            self.assertEqual(base64.b64decode(part["data"]), b"0123")
            self.assertEqual(self.client.post("/api/library/range", json={"path": "../secret", "offset": 0, "length": 4}).status_code, 404)
            self.assertEqual(self.client.post("/api/library/range", json={"path": "Recipe Books/book.epub", "offset": 0, "length": 9 * 1024 * 1024}).status_code, 422)
            kindle = self.client.post("/api/library/read", json={"path": "Recipe Books/old.azw3"}).json()
            self.assertIn("Calibre", kindle["note"])
            # Adding a Kindle book from the app: turned away with the plain reason; an EPUB goes into Recipe Books.
            r = self.client.post("/api/library/add", json={"name": "novel.mobi", "data": "eA=="})
            self.assertEqual(r.status_code, 400)
            self.assertIn("Kindle", r.json()["detail"])
            added = self.client.post("/api/library/add", json={"name": "new.epub", "data": "eA=="}).json()
            self.assertEqual(added["path"], "Recipe Books/new.epub")
            (folder / "Recipe Books" / "new.epub").unlink()
        finally:
            book.unlink()
            (folder / "Recipe Books" / "old.azw3").unlink()

    def test_each_folder_has_a_read_me_that_is_not_a_recipe(self):
        folder = Path(self.client.get("/api/library").json()["folder"])
        for name in ("Recipe Books", "My Recipes"):
            self.assertIn("Nourish", (folder / name / "Read me.txt").read_text(encoding="utf-8"))
        self.assertFalse(any(f["path"].endswith("Read me.txt") for f in self.client.get("/api/library").json()["files"]))

    def test_add_files_from_the_app(self):
        import base64
        text = "# Toast\n## Ingredients\n- 1 slice bread\n"
        r = self.client.post("/api/library/add", json={"name": "../../toast.md", "data": base64.b64encode(text.encode()).decode()})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["path"], "My Recipes/toast.md")   # no way out of the folder
        again = self.client.post("/api/library/add", json={"name": "toast.md", "data": base64.b64encode(b"x").decode()}).json()
        self.assertEqual(again["path"], "My Recipes/toast 2.md")      # never overwrites
        self.assertIn("My Recipes/toast.md", [f["path"] for f in self.client.get("/api/library").json()["files"]])
        self.assertEqual(self.client.post("/api/library/add", json={"name": "virus.exe", "data": "eA=="}).status_code, 400)
        self.assertEqual(self.client.post("/api/library/add", json={"name": "a.txt", "data": "not base64!"}).status_code, 400)
        folder = Path(self.client.get("/api/library").json()["folder"])
        for name in ("toast.md", "toast 2.md"):
            (folder / "My Recipes" / name).unlink()

    def test_nothing_outside_the_library_can_be_read(self):
        self.client.get("/api/library")
        for bad in ["../nourish-data.json", "/etc/passwd", "My Recipes/../../nourish-data.json"]:
            self.assertEqual(self.client.post("/api/library/read", json={"path": bad}).status_code, 404, bad)


class ServiceKeysTest(unittest.TestCase):
    """Keys for the free services: encrypted at rest, added only for that service's own address,
    and never sent back to a device."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        main.store.reset_for_tests(self.dir / "nourish-data.json")
        self.client = TestClient(main.app)

    def test_keys_are_encrypted_in_the_data_file(self):
        self.client.put("/api/state/settings", json={"value": {"edamam_app_id": "my-id", "edamam_app_key": "secret-key-123"}})
        raw = (self.dir / "nourish-data.json").read_text()
        self.assertNotIn("secret-key-123", raw)
        self.assertIn("enc1:", raw)
        self.assertEqual(main.store.secret("edamam_app_key"), "secret-key-123")
        state = self.client.get("/api/state").json()
        self.assertNotIn("secret-key-123", json.dumps(state))
        self.assertTrue(state["settings"]["value"]["_secrets_set"]["edamam_app_key"])

    def test_old_plain_keys_are_encrypted_on_load(self):
        f = self.dir / "old.json"
        f.write_text(json.dumps({"settings": {"rev": 1, "value": {"_secrets": {"claude_api_key": "sk-old"}}}}))
        main.store.reset_for_tests(f)
        self.assertNotIn("sk-old", f.read_text())
        self.assertEqual(main.store.secret("claude_api_key"), "sk-old")

    def test_requests_only_go_to_the_service(self):
        from services import prepare, ServiceError
        with self.assertRaises(ServiceError):
            prepare("edamam", "POST", "https://evil.example.com/api/nutrition-details", {}, {}, {"edamam_app_id": "a", "edamam_app_key": "b"})
        with self.assertRaises(ServiceError):
            prepare("usda", "GET", "http://api.nal.usda.gov/fdc/v1/foods/search", {}, {}, {})
        url, q, h = prepare("usda", "GET", "https://api.nal.usda.gov/fdc/v1/foods/search", {"query": "egg"}, {"Authorization": "x"}, {})
        self.assertEqual(q["api_key"], "DEMO_KEY")
        self.assertNotIn("Authorization", h)

    def test_fatsecret_oauth1_signature(self):
        # Worked example checked by hand against RFC 5849's signing steps.
        from services import oauth1_sign
        out = oauth1_sign("GET", "https://platform.fatsecret.com/rest/server.api", {"method": "foods.search", "search_expression": "egg", "format": "json"},
                          "key123", "secret456", nonce="abc", timestamp="1700000000")
        import base64, hashlib, hmac
        from urllib.parse import quote
        p = lambda s: quote(str(s), safe="~-._")
        params = {"method": "foods.search", "search_expression": "egg", "format": "json", "oauth_consumer_key": "key123", "oauth_signature_method": "HMAC-SHA1",
                  "oauth_timestamp": "1700000000", "oauth_nonce": "abc", "oauth_version": "1.0"}
        norm = "&".join(f"{p(k)}={p(v)}" for k, v in sorted(params.items()))
        base = f"GET&{p('https://platform.fatsecret.com/rest/server.api')}&{p(norm)}"
        want = base64.b64encode(hmac.new(b"secret456&", base.encode(), hashlib.sha1).digest()).decode()
        self.assertEqual(out["oauth_signature"], want)

    def test_missing_key_is_a_plain_message(self):
        res = self.client.post("/api/services/request", json={"service": "edamam", "method": "POST", "url": "https://api.edamam.com/api/nutrition-details", "body": {"ingr": ["1 egg"]}})
        self.assertEqual(res.status_code, 400)
        self.assertIn("Edamam", res.json()["detail"])


if __name__ == "__main__":
    unittest.main()
