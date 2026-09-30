"""Backend tests. Run from backend/:  python -m unittest -v
Upstream services (LM Studio, Claude, TheMealDB, ...) are faked with httpx.MockTransport,
so no network or API keys are needed."""
import json
import logging
import unittest

import httpx
from fastapi.testclient import TestClient

import main

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
        for f in ("app.js", "styles.css", "json-repair.js"):
            self.assertEqual(self.client.get(f"/{f}").status_code, 200, f)
        for f in (".env", "README.md", "main.py", "nourish.log", "..%2Fbackend%2F.env"):
            self.assertEqual(self.client.get(f"/{f}").status_code, 404, f)
        self.assertEqual(self.client.get("/backend/.env").status_code, 404)
        self.assertEqual(self.client.get("/.git/config").status_code, 404)

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


if __name__ == "__main__":
    unittest.main()
