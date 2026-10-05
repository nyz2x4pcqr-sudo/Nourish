package io.github.nourish;

import android.app.ActivityManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.StatFs;
import android.view.HapticFeedbackConstants;
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
        /** Shows the system file picker; calls back with how many files were copied into the library. */
        void pickLibraryFiles(java.util.function.IntConsumer done);
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
    /** The build self-test is running the AI (MainActivity.runSelfTest): background work waits. */
    volatile boolean selfTestRunning = false;
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

    /** A light tap under the finger for taps, ticks and finished work (app.js haptic()). */
    @JavascriptInterface
    public void haptic(String style) {
        main.post(() -> {
            int kind;
            if ("success".equals(style)) kind = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.LONG_PRESS;
            else if ("warning".equals(style)) kind = Build.VERSION.SDK_INT >= 30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            else if ("select".equals(style)) kind = HapticFeedbackConstants.CLOCK_TICK;
            else kind = HapticFeedbackConstants.VIRTUAL_KEY;
            web.performHapticFeedback(kind);
        });
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

    /** A line for Settings → Activity log in the app (also written to logcat). */
    void log(String message, String level) {
        android.util.Log.i("Nourish", message);
        String js = "window.__nourishNativeLog && window.__nourishNativeLog(" + JSONObject.quote(message) + "," + JSONObject.quote(level) + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private final Map<String, String> downloadErrors = new ConcurrentHashMap<>();

    private void event(String name, JSONObject payload) {
        String js = "window.__nourishNativeEvent && window.__nourishNativeEvent(" + JSONObject.quote(name) + "," + payload + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private Object handle(String cmd, JSONObject a) throws Exception {
        switch (cmd) {
            case "specs": return specs();
            case "network": return network();
            case "http": return http(a);
            case "hfToken": return hfToken(a);
            case "secret": return secret(a);
            case "download": return download(a);
            case "cancelDownload": cancelledDownloads.put(a.optString("file"), true); return new JSONObject();
            case "models": return models();
            case "deleteModel": return deleteModel(a);
            case "generate": return generate(a);
            case "cancelGenerate": cancelRequested = true; if (engine != 0 && generating) Llm.cancel(engine); return new JSONObject();
            case "keepAwake": keepAwake(a.optBoolean("on")); return new JSONObject();
            case "setMode": host.setMode(a.optString("mode")); return new JSONObject();
            case "library": return library(a);
            case "appIcon": return appIcon(a.optString("name", "default"));
            default: throw new IllegalArgumentException("Unknown command: " + cmd);
        }
    }

    // ---------------------------------------------------------------------------------- service keys

    private SecretStore secrets;

    /** Keys for the free services, encrypted with the Android Keystore (SecretStore.java). Never logged. */
    private JSONObject secret(JSONObject a) throws Exception {
        if (secrets == null) secrets = new SecretStore(context);
        String op = a.optString("op"), name = a.optString("name");
        JSONObject out = new JSONObject();
        if ("list".equals(op)) { out.put("names", new JSONArray(secrets.names())); return out; }
        if (!SecretStore.validName(name)) throw new IllegalArgumentException("Not a key name");
        switch (op) {
            case "get": out.put("value", secrets.get(name)); return out;
            case "set": secrets.set(name, a.optString("value")); out.put("ok", true); return out;
            case "delete": secrets.delete(name); out.put("ok", true); return out;
            default: throw new IllegalArgumentException("Unknown key request.");
        }
    }

    // ---------------------------------------------------------------------------------- app icon

    /** Enables the launcher entry with the chosen icon and disables the others (AndroidManifest.xml). */
    private JSONObject appIcon(String name) throws Exception {
        String[] names = { "default", "midnight", "forest", "plum", "paper", "oled" };
        boolean known = false;
        for (String n : names) known |= n.equals(name);
        if (!known) throw new IllegalArgumentException("Unknown app icon: " + name);
        android.content.pm.PackageManager pm = context.getPackageManager();
        // Turn the new one on first, so there is never a moment without an icon.
        for (int pass = 0; pass < 2; pass++) {
            for (String n : names) {
                boolean on = n.equals(name);
                if ((pass == 0) != on) continue;
                android.content.ComponentName c = new android.content.ComponentName(context, "io.github.nourish.Icon" + Character.toUpperCase(n.charAt(0)) + n.substring(1));
                pm.setComponentEnabledSetting(c, on ? android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_ENABLED : android.content.pm.PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                        android.content.pm.PackageManager.DONT_KILL_APP);
            }
        }
        JSONObject o = new JSONObject();
        o.put("icon", name);
        return o;
    }

    // ---------------------------------------------------------------------------------- recipe library

    // Wi-Fi or mobile data, so the recipe library only refreshes in the background on Wi-Fi.
    private JSONObject network() throws Exception {
        JSONObject o = new JSONObject();
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        Network n = cm == null ? null : cm.getActiveNetwork();
        NetworkCapabilities c = n == null ? null : cm.getNetworkCapabilities(n);
        o.put("known", cm != null);
        o.put("online", c != null && c.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET));
        o.put("wifi", c != null && (c.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || c.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)));
        o.put("expensive", cm != null && cm.isActiveNetworkMetered());
        // The phone's AI is working: the app's background recipe refresh waits, so it doesn't slow it down.
        o.put("aiBusy", generating || selfTestRunning);
        return o;
    }

    private JSONObject library(JSONObject a) throws Exception {
        switch (a.optString("op")) {
            case "list": return RecipeLibrary.list(context);
            case "read": return RecipeLibrary.read(context, a.optString("path"));
            case "range": return RecipeLibrary.range(context, a.optString("path"), a.optLong("offset"), a.optInt("length"));
            case "where": {
                JSONObject o = new JSONObject();
                o.put("folder", "Inside the Nourish app (use Add files)");
                o.put("path", RecipeLibrary.root(context).getAbsolutePath());
                o.put("foldersMade", true);
                return o;
            }
            case "open":
            case "add": {
                java.util.concurrent.CompletableFuture<Integer> done = new java.util.concurrent.CompletableFuture<>();
                host.pickLibraryFiles(done::complete);
                JSONObject o = new JSONObject();
                o.put("added", done.get(10, java.util.concurrent.TimeUnit.MINUTES));
                synchronized (RecipeLibrary.lastRejected) { o.put("rejected", new JSONArray(RecipeLibrary.lastRejected)); }
                o.put("folder", RecipeLibrary.root(context).getAbsolutePath());
                return o;
            }
            default: throw new IllegalArgumentException("Unknown library request");
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
        // Cups and °F only for US, Liberia and Myanmar; everywhere else cooks in metric.
        String country = java.util.Locale.getDefault().getCountry();
        o.put("measurement", "US".equals(country) || "LR".equals(country) || "MM".equals(country) ? "imperial" : "metric");
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
                throw new SecurityException(url.getHost() + " points to " + addr.getHostAddress()
                        + ", a private or blocked address, so it was blocked. (An ad blocker, VPN or DNS filter can do this.)");
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
            if ("error".equals(state)) downloadErrors.put(file, error == null ? "error" : error);
            if ("done".equals(state)) downloadErrors.remove(file);
            event("download", o);
        } catch (Exception ignored) {
        }
    }

    private void runDownload(URL start, String file, long expected) {
        File part = new File(modelsDir(), file + ".part");
        File done = new File(modelsDir(), file);
        long have = part.exists() ? part.length() : 0;   // resume where a previous try stopped
        long startedAt = System.currentTimeMillis();
        log("Download " + file + ": GET " + start.getHost() + start.getPath() + (have > 0 ? " (resuming from " + have + " bytes)" : "")
                + (prefs().getString(KEY_HF_TOKEN, null) != null ? " with Hugging Face sign-in" : ""), "info");
        try {
            URL url = start;
            HttpURLConnection c = null;
            for (int hop = 0; hop < 6; hop++) {
                // Downloads only start at huggingface.co (checked above); its redirects go to its own
                // download servers, which must stay https. The token is only ever sent to huggingface.co.
                if (!"https".equals(url.getProtocol())) throw new Exception("The download was redirected to an insecure address (" + url.getHost() + ").");
                c = open(url, "GET", null, "hf", false, 30000);
                if (have > 0) c.setRequestProperty("Range", "bytes=" + have + "-");
                int status = c.getResponseCode();
                String location = c.getHeaderField("Location");
                if (status >= 300 && status < 400 && location != null) {
                    URL next = new URL(url, location);
                    log("Download " + file + ": HTTP " + status + " → redirected to " + next.getHost(), "info");
                    url = next;
                    c.disconnect();
                    c = null;
                    continue;
                }
                log("Download " + file + ": server answered HTTP " + status + " from " + url.getHost() + ", size " + c.getContentLengthLong() + " bytes", status >= 300 ? "warn" : "info");
                if (status == 401 || status == 403) throw new Exception("Hugging Face refused the download. This model may need you to sign in and accept its licence.");
                if (status == 416) { have = 0; part.delete(); c.disconnect(); c = null; url = start; continue; }
                if (status >= 300) throw new Exception("Download failed (HTTP " + status + (location != null ? ", sent to " + new URL(url, location).getHost() : "") + ")");
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
            long secs = Math.max(1, (System.currentTimeMillis() - startedAt) / 1000);
            log("Download " + file + ": finished, " + done.length() + " bytes in " + secs + " s (" + (done.length() / secs / 1048576) + " MB/s)", "info");
            progress(file, done.length(), done.length(), "done", null);
        } catch (Exception e) {
            log("Download " + file + ": failed after " + part.length() + " bytes: " + e.getMessage(), "error");
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
        long t0 = System.currentTimeMillis();
        try {
            engine = Llm.load(model.getAbsolutePath(), nCtx, 0, threads);
        } catch (RuntimeException e) {
            log("Loading " + model.getName() + " failed: " + e.getMessage(), "error");
            throw e;
        }
        loadedKey = key;
        log("Loaded " + model.getName() + " in " + (System.currentTimeMillis() - t0) + " ms (" + threads + " threads, context " + nCtx + ")", "info");
    }

    /** Downloads a model straight away (used by the automated build test). Returns null or an error. */
    String downloadNow(String url, String file, long size) {
        try {
            URL u = new URL(url);
            if (!isHuggingFace(u)) return "not a Hugging Face address";
            runDownload(u, safeName(file), size);
        } catch (Exception e) {
            return e.getMessage();
        }
        if (downloadErrors.containsKey(file)) return downloadErrors.get(file);
        return new File(modelsDir(), file).exists() ? null : "the file wasn't saved";
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
