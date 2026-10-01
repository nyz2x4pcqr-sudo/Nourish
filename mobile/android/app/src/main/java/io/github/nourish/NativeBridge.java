package io.github.nourish;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.StatFs;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * What the built-in web app asks the phone to do (see ondevice.js): report the phone's specs,
 * fetch web pages and APIs, download models from Hugging Face, and run them with llama.cpp.
 * Calls arrive as call(id, cmd, argsJson); answers go back to window.__nourishNativeReply.
 */
final class NativeBridge {
    interface Host {
        void setMode(String mode);
        void setTheme(String theme);
        void runOnUi(Runnable r);
    }

    private static final String PREFS = "nourish";
    private static final String KEY_HF_TOKEN = "hf_token";

    private final Context context;
    private final WebView web;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final ExecutorService ai = Executors.newSingleThreadExecutor();   // one model run at a time
    private final Map<String, Boolean> cancelledDownloads = new ConcurrentHashMap<>();

    private long engine = 0;
    private String loadedKey = null;
    private volatile boolean generating = false;
    private volatile boolean cancelRequested = false;

    NativeBridge(Context context, WebView web, Host host) {
        this.context = context;
        this.web = web;
        this.host = host;
    }

    File modelsDir() {
        File dir = new File(context.getFilesDir(), "models");
        //noinspection ResultOfMethodCallIgnored
        dir.mkdirs();
        return dir;
    }

    // ---------------------------------------------------------------------------------- plumbing

    /** Called by app.js so the status bar matches the light or dark theme. */
    @JavascriptInterface
    public void setTheme(String theme) {
        host.setTheme(theme);
    }

    @JavascriptInterface
    public void call(String id, String cmd, String argsJson) {
        ExecutorService pool = "generate".equals(cmd) ? ai : io;
        pool.execute(() -> {
            try {
                JSONObject args = argsJson == null || argsJson.isEmpty() ? new JSONObject() : new JSONObject(argsJson);
                reply(id, true, handle(cmd, args));
            } catch (Throwable t) {
                JSONObject err = new JSONObject();
                try { err.put("message", t.getMessage() == null ? t.toString() : t.getMessage()); } catch (Exception ignored) {}
                reply(id, false, err);
            }
        });
    }

    private void reply(String id, boolean ok, Object payload) {
        String js = "window.__nourishNativeReply && window.__nourishNativeReply(" + JSONObject.quote(id) + "," + ok + "," + (payload == null ? "null" : payload.toString()) + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private void event(String name, JSONObject payload) {
        String js = "window.__nourishNativeEvent && window.__nourishNativeEvent(" + JSONObject.quote(name) + "," + payload + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private Object handle(String cmd, JSONObject a) throws Exception {
        switch (cmd) {
            case "specs": return specs();
            case "http": return http(a);
            case "hfToken": return hfToken(a);
            case "download": return download(a);
            case "cancelDownload": cancelledDownloads.put(a.optString("file"), true); return new JSONObject();
            case "models": return models();
            case "deleteModel": return deleteModel(a);
            case "generate": return generate(a);
            case "cancelGenerate": cancelRequested = true; if (engine != 0 && generating) Llm.cancel(engine); return new JSONObject();
            case "keepAwake": keepAwake(a.optBoolean("on")); return new JSONObject();
            case "setMode": host.setMode(a.optString("mode")); return new JSONObject();
            default: throw new IllegalArgumentException("Unknown command: " + cmd);
        }
    }

    // ---------------------------------------------------------------------------------- specs

    private JSONObject specs() throws Exception {
        ActivityManager am = (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo mem = new ActivityManager.MemoryInfo();
        am.getMemoryInfo(mem);
        StatFs fs = new StatFs(context.getFilesDir().getAbsolutePath());
        JSONObject o = new JSONObject();
        o.put("platform", "android");
        o.put("device", (Build.MANUFACTURER + " " + Build.MODEL).trim());
        o.put("model_id", Build.MODEL);
        o.put("ram", mem.totalMem);
        o.put("usable", mem.availMem);            // what's free for us right now
        o.put("disk_free", fs.getAvailableBytes());
        o.put("cores", Runtime.getRuntime().availableProcessors());
        o.put("thermal", thermal());
        o.put("gpu", false);                       // CPU only on Android for now
        o.put("os", "Android " + Build.VERSION.RELEASE);
        o.put("simulator", Build.FINGERPRINT.contains("generic") || Build.HARDWARE.contains("ranchu"));
        o.put("app_version", context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName);
        return o;
    }

    private String thermal() {
        if (Build.VERSION.SDK_INT < 29) return "nominal";
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        int s = pm.getCurrentThermalStatus();
        if (s >= PowerManager.THERMAL_STATUS_CRITICAL) return "critical";
        if (s >= PowerManager.THERMAL_STATUS_SEVERE) return "serious";
        if (s >= PowerManager.THERMAL_STATUS_MODERATE) return "fair";
        return "nominal";
    }

    private void keepAwake(boolean on) {
        host.runOnUi(() -> {
            if (on) ((android.app.Activity) context).getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else ((android.app.Activity) context).getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    // ---------------------------------------------------------------------------------- web requests

    /** Blocks home-network and local addresses, so a web page can't make the phone reach the router. */
    private static void checkPublic(URL url) throws Exception {
        String scheme = url.getProtocol();
        if (!"https".equals(scheme) && !"http".equals(scheme)) throw new SecurityException("Only web addresses are allowed");
        for (InetAddress addr : InetAddress.getAllByName(url.getHost())) {
            boolean ula = addr instanceof Inet6Address && (addr.getAddress()[0] & 0xfe) == 0xfc;
            if (addr.isAnyLocalAddress() || addr.isLoopbackAddress() || addr.isLinkLocalAddress() || addr.isSiteLocalAddress() || addr.isMulticastAddress() || ula) {
                throw new SecurityException("That address points to a private network, so it was blocked");
            }
        }
    }

    private boolean isHuggingFace(URL url) {
        String h = url.getHost().toLowerCase();
        return h.equals("huggingface.co") || h.endsWith(".huggingface.co");
    }

    private HttpURLConnection open(URL url, String method, JSONObject headers, String auth, boolean publicOnly, int timeoutMs) throws Exception {
        if (publicOnly) checkPublic(url);
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setInstanceFollowRedirects(false);   // every hop is checked
        c.setConnectTimeout(Math.min(timeoutMs, 15000));
        c.setReadTimeout(timeoutMs);
        c.setRequestMethod(method);
        c.setRequestProperty("User-Agent", "Nourish/" + context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName + " (Android)");
        if (headers != null) {
            for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                String k = it.next();
                c.setRequestProperty(k, headers.optString(k));
            }
        }
        // The Hugging Face token only ever goes to Hugging Face, never to its download servers or anywhere else.
        String token = prefs().getString(KEY_HF_TOKEN, null);
        if ("hf".equals(auth) && token != null && isHuggingFace(url)) c.setRequestProperty("Authorization", "Bearer " + token);
        return c;
    }

    private JSONObject http(JSONObject a) throws Exception {
        URL url = new URL(a.getString("url"));
        String method = a.optString("method", "GET");
        String body = a.isNull("body") ? null : a.optString("body", null);
        int timeout = a.optInt("timeoutMs", 20000);
        int maxBytes = a.optInt("maxBytes", 4 * 1024 * 1024);
        boolean publicOnly = a.optBoolean("publicOnly", true);
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = open(url, method, a.optJSONObject("headers"), a.isNull("auth") ? null : a.optString("auth"), publicOnly, timeout);
            if (body != null) {
                c.setDoOutput(true);
                try (OutputStream out = c.getOutputStream()) { out.write(body.getBytes(StandardCharsets.UTF_8)); }
            }
            int status = c.getResponseCode();
            String location = c.getHeaderField("Location");
            if (status >= 300 && status < 400 && location != null) {
                url = new URL(url, location);
                if (status != 307 && status != 308) { method = "GET"; body = null; }
                c.disconnect();
                continue;
            }
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream();
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            if (in != null) {
                byte[] chunk = new byte[16384];
                int n;
                while ((n = in.read(chunk)) > 0 && buf.size() < maxBytes) buf.write(chunk, 0, n);
                in.close();
            }
            c.disconnect();
            JSONObject o = new JSONObject();
            o.put("status", status);
            o.put("url", url.toString());
            o.put("body", new String(buf.toByteArray(), StandardCharsets.UTF_8));
            return o;
        }
        throw new Exception("Too many redirects");
    }

    // ---------------------------------------------------------------------------------- Hugging Face token

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSONObject hfToken(JSONObject a) throws Exception {
        String action = a.optString("action");
        if ("set".equals(action)) prefs().edit().putString(KEY_HF_TOKEN, a.getString("token").trim()).apply();
        if ("clear".equals(action)) prefs().edit().remove(KEY_HF_TOKEN).apply();
        return new JSONObject().put("set", prefs().getString(KEY_HF_TOKEN, null) != null);
    }

    // ---------------------------------------------------------------------------------- models on disk

    private static String safeName(String file) {
        if (file == null || !file.matches("[A-Za-z0-9._-]{1,200}\\.gguf")) throw new IllegalArgumentException("Not a model file name: " + file);
        return file;
    }

    private JSONObject models() throws Exception {
        JSONArray list = new JSONArray();
        File[] files = modelsDir().listFiles();
        if (files != null) {
            for (File f : files) {
                if (f.getName().endsWith(".gguf")) list.put(new JSONObject().put("file", f.getName()).put("size", f.length()));
            }
        }
        return new JSONObject().put("files", list);
    }

    private JSONObject deleteModel(JSONObject a) throws Exception {
        File f = new File(modelsDir(), safeName(a.getString("file")));
        synchronized (this) {
            if (loadedKey != null && loadedKey.startsWith(f.getAbsolutePath() + "|")) unload();
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
        return new JSONObject();
    }

    // ---------------------------------------------------------------------------------- downloads

    private JSONObject download(JSONObject a) throws Exception {
        String file = safeName(a.getString("file"));
        URL url = new URL(a.getString("url"));
        if (!isHuggingFace(url)) throw new SecurityException("Models can only be downloaded from Hugging Face");
        long expected = a.optLong("size", -1);
        cancelledDownloads.remove(file);
        io.execute(() -> runDownload(url, file, expected));
        return new JSONObject().put("started", true);
    }

    private void progress(String file, long got, long total, String state, String error) {
        try {
            JSONObject o = new JSONObject().put("file", file).put("received", got).put("total", total).put("state", state);
            if (error != null) o.put("error", error);
            event("download", o);
        } catch (Exception ignored) {
        }
    }

    private void runDownload(URL start, String file, long expected) {
        File part = new File(modelsDir(), file + ".part");
        File done = new File(modelsDir(), file);
        long have = part.exists() ? part.length() : 0;   // resume where a previous try stopped
        try {
            URL url = start;
            HttpURLConnection c = null;
            for (int hop = 0; hop < 6; hop++) {
                c = open(url, "GET", null, "hf", true, 30000);
                if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
                int status = c.getResponseCode();
                String location = c.getHeaderField("Location");
                if (status >= 300 && status < 400 && location != null) {
                    url = new URL(url, location);
                    c.disconnect();
                    c = null;
                    continue;
                }
                if (status == 401 || status == 403) throw new Exception("Hugging Face refused the download. This model may need you to sign in and accept its licence.");
                if (status == 416) { have = 0; part.delete(); c.disconnect(); c = null; url = start; continue; }
                if (status >= 400) throw new Exception("Download failed (HTTP " + status + ")");
                if (status == 200) have = 0;   // server ignored the resume request
                break;
            }
            if (c == null) throw new Exception("Too many redirects");
            long length = c.getContentLengthLong();
            long total = expected > 0 ? expected : (length > 0 ? length + have : -1);
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part, have > 0)) {
                byte[] buf = new byte[1 << 16];
                long got = have;
                long lastReport = 0;
                int n;
                while ((n = in.read(buf)) > 0) {
                    if (Boolean.TRUE.equals(cancelledDownloads.get(file))) {
                        progress(file, got, total, "cancelled", null);
                        return;
                    }
                    out.write(buf, 0, n);
                    got += n;
                    long now = System.currentTimeMillis();
                    if (now - lastReport > 400) {
                        lastReport = now;
                        progress(file, got, total, "running", null);
                    }
                }
            } finally {
                c.disconnect();
            }
            if (expected > 0 && part.length() != expected) throw new Exception("The download was incomplete. Tap Download to continue it.");
            if (!isGguf(part)) { part.delete(); throw new Exception("That file isn't a GGUF model."); }
            if (!part.renameTo(done)) throw new Exception("Couldn't save the model.");
            progress(file, done.length(), done.length(), "done", null);
        } catch (Exception e) {
            progress(file, part.length(), expected, "error", e.getMessage());
        }
    }

    private static boolean isGguf(File f) {
        try (InputStream in = new FileInputStream(f)) {
            byte[] magic = new byte[4];
            return in.read(magic) == 4 && magic[0] == 'G' && magic[1] == 'G' && magic[2] == 'U' && magic[3] == 'F';
        } catch (Exception e) {
            return false;
        }
    }

    // ---------------------------------------------------------------------------------- running a model

    private synchronized void unload() {
        if (engine != 0) Llm.free(engine);
        engine = 0;
        loadedKey = null;
    }

    private synchronized void ensureLoaded(File model, int nCtx) {
        String key = model.getAbsolutePath() + "|" + nCtx;
        if (engine != 0 && key.equals(loadedKey)) return;
        unload();
        int threads = Math.max(2, Math.min(4, Runtime.getRuntime().availableProcessors() - 2));
        engine = Llm.load(model.getAbsolutePath(), nCtx, 0, threads);
        loadedKey = key;
    }

    /** Runs a model directly (also used by the automated build test). */
    String runModel(File model, int nCtx, String[] roles, String[] contents, String grammar, float temperature, int maxTokens) {
        ensureLoaded(model, nCtx);
        generating = true;
        try {
            return Llm.generate(engine, roles, contents, grammar, temperature, maxTokens);
        } finally {
            generating = false;
        }
    }

    private JSONObject generate(JSONObject a) throws Exception {
        File model = new File(modelsDir(), safeName(a.getString("model")));
        if (!model.exists()) throw new Exception("That model isn't downloaded on this phone.");
        JSONArray msgs = a.getJSONArray("messages");
        String[] roles = new String[msgs.length()];
        String[] contents = new String[msgs.length()];
        for (int i = 0; i < msgs.length(); i++) {
            roles[i] = msgs.getJSONObject(i).optString("role", "user");
            contents[i] = msgs.getJSONObject(i).optString("content", "");
        }
        String grammar = a.isNull("grammar") ? null : a.optString("grammar", null);
        cancelRequested = false;
        String text = runModel(model, a.optInt("n_ctx", 4096), roles, contents, grammar,
                (float) a.optDouble("temperature", 0.7), a.optInt("max_tokens", 1024));
        return new JSONObject().put("text", text).put("cancelled", cancelRequested);
    }
}
