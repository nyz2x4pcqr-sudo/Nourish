package io.github.nourish;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

/**
 * Nourish for Android. By default the app runs entirely on the phone: the built-in copy of
 * Nourish (in the APK's assets) with on-device AI. In Settings you can instead connect to
 * Nourish running on your PC; the app then shows the PC's copy (the "connect" page finds it).
 */
public class MainActivity extends Activity implements NativeBridge.Host {
    private static final String TAG = "Nourish";
    private static final String PREFS = "nourish";
    private static final String KEY_SERVER = "server_url";
    private static final String KEY_MODE = "mode";                 // "local" (default) or "server"
    private static final String CONNECT_PAGE = "file:///android_asset/connect.html";
    // The built-in app is served from this (virtual) https address so it gets normal web storage.
    private static final String LOCAL_HOST = "appassets.androidplatform.net";
    private static final String LOCAL_URL = "https://" + LOCAL_HOST + "/app/index.html";

    private WebView web;
    private NativeBridge bridge;
    private String serverUrl;
    private String connectError;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.parseColor("#14110F"));
        getWindow().setNavigationBarColor(Color.parseColor("#1F1B18"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#14110F"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);      // the app keeps your plan and settings in localStorage
        s.setDatabaseEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setUserAgentString(s.getUserAgentString() + " NourishApp/" + appVersion() + " (Android)");

        bridge = new NativeBridge(this, web, this);
        web.setWebChromeClient(new WebChromeClient());  // enables alert()/confirm() dialogs
        web.setWebViewClient(new Client());
        web.addJavascriptInterface(bridge, "NourishAndroid");

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        Intent intent = getIntent();
        // A server can be passed when launching (used by the automated build test).
        String fromIntent = intent.getStringExtra(KEY_SERVER);
        if (fromIntent != null && !fromIntent.isEmpty()) {
            prefs.edit().putString(KEY_SERVER, fromIntent).putString(KEY_MODE, "server").apply();
        }
        if (intent.getBooleanExtra("local", false)) prefs.edit().putString(KEY_MODE, "local").apply();
        serverUrl = prefs.getString(KEY_SERVER, null);

        String selftest = intent.getStringExtra("selftest_model");
        if (selftest != null) runSelfTest(selftest, intent.getStringExtra("selftest_grammar"));

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            loadForMode();
        }
    }

    private void loadForMode() {
        String mode = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_MODE, "local");
        if ("server".equals(mode) && serverUrl != null) web.loadUrl(serverUrl);
        else if ("server".equals(mode)) showConnect(null);
        else web.loadUrl(LOCAL_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    // ---------------------------------------------------------------------------------- NativeBridge.Host

    @Override
    public void setMode(String mode) {
        runOnUiThread(() -> {
            if ("server".equals(mode)) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_MODE, "server").apply();
                showConnect(null);   // pick (or confirm) the PC
            } else {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_MODE, "local").apply();
                web.loadUrl(LOCAL_URL);
            }
        });
    }

    /** Matches the status and navigation bars to the page's light or dark theme. */
    @Override
    public void setTheme(String theme) {
        final boolean light = "light".equals(theme);
        runOnUiThread(() -> {
            getWindow().setStatusBarColor(Color.parseColor(light ? "#F6F3F0" : "#0F0D0C"));
            getWindow().setNavigationBarColor(Color.parseColor(light ? "#FFFFFF" : "#1A1716"));
            web.setBackgroundColor(Color.parseColor(light ? "#F6F3F0" : "#14110F"));
            View decor = getWindow().getDecorView();
            int flags = decor.getSystemUiVisibility();
            int lightBars = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(light ? (flags | lightBars) : (flags & ~lightBars));
        });
    }

    @Override
    public void runOnUi(Runnable r) {
        runOnUiThread(r);
    }

    // ---------------------------------------------------------------------------------- helpers

    private void showConnect(String error) {
        connectError = error;
        web.loadUrl(CONNECT_PAGE);
    }

    private boolean isServerUrl(Uri uri) {
        if (serverUrl == null) return false;
        Uri server = Uri.parse(serverUrl);
        return uri.getHost() != null && uri.getHost().equals(server.getHost()) && uri.getPort() == server.getPort();
    }

    private String appVersion() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "unknown";
        }
    }

    private static String localIpv4() {
        try {
            for (NetworkInterface nif : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!nif.isUp() || nif.isLoopback()) continue;
                for (InetAddress addr : Collections.list(nif.getInetAddresses())) {
                    if (addr instanceof Inet4Address && addr.isSiteLocalAddress()) return addr.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".webmanifest")) return "application/manifest+json";
        return "application/octet-stream";
    }

    /**
     * Automated build test: runs a model file from the app's model folder with the app's own
     * engine and writes the result to the log, so CI can check real on-device generation.
     */
    private void runSelfTest(String modelFile, String grammarFile) {
        final String downloadUrl = getIntent().getStringExtra("selftest_download_url");
        new Thread(() -> {
            try {
                if (downloadUrl != null) {
                    String err = bridge.downloadNow(downloadUrl, modelFile, getIntent().getLongExtra("selftest_download_size", -1));
                    if (err != null) { Log.e(TAG, "NOURISH_DOWNLOAD_FAIL " + err); Log.e(TAG, "NOURISH_SELFTEST_FAIL download: " + err); return; }
                    Log.i(TAG, "NOURISH_DOWNLOAD_OK " + new File(bridge.modelsDir(), modelFile).length());
                }
                File model = new File(bridge.modelsDir(), modelFile);
                String grammar = null;
                if (grammarFile != null) {
                    try (InputStream in = new FileInputStream(new File(bridge.modelsDir(), grammarFile))) {
                        grammar = new String(readAll(in), StandardCharsets.UTF_8);
                    }
                }
                long t0 = System.currentTimeMillis();
                String out = bridge.runModel(model, 2048,
                        new String[]{"system", "user"},
                        new String[]{"You are a meal-planning chef. Reply with JSON only.", "Plan Day 1 (Monday): breakfast, lunch and dinner."},
                        grammar, 0.7f, 900);
                JSONObject o = new JSONObject().put("ms", System.currentTimeMillis() - t0).put("text", out);
                Log.i(TAG, "NOURISH_SELFTEST_OK " + o);
            } catch (Throwable t) {
                Log.e(TAG, "NOURISH_SELFTEST_FAIL " + t);
            }
        }).start();
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!LOCAL_HOST.equals(uri.getHost())) return null;
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (!path.startsWith("/app/") || path.contains("..")) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            try {
                InputStream in = getAssets().open("webapp/" + path.substring(5));
                return new WebResourceResponse(mimeType(path), "utf-8", in);
            } catch (Exception e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if (scheme.equals("nourishapp")) {
                SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
                if ("open".equals(uri.getHost())) {
                    String url = uri.getQueryParameter("url");
                    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                        serverUrl = url;
                        prefs.edit().putString(KEY_SERVER, url).putString(KEY_MODE, "server").apply();
                        view.loadUrl(url);
                    }
                } else if ("connect".equals(uri.getHost())) {
                    showConnect(null);
                } else if ("local".equals(uri.getHost())) {
                    prefs.edit().putString(KEY_MODE, "local").apply();
                    view.loadUrl(LOCAL_URL);
                }
                return true;
            }
            if (scheme.equals("file") || LOCAL_HOST.equals(uri.getHost()) || isServerUrl(uri)) return false;
            // Anything else (e.g. a recipe's original website) opens in the browser.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !request.getUrl().toString().startsWith("file:") && !LOCAL_HOST.equals(request.getUrl().getHost())) {
                showConnect("Couldn't reach Nourish at " + serverUrl + ". Is it running on your PC, and is this phone on the same Wi-Fi?");
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url.startsWith(CONNECT_PAGE)) {
                try {
                    JSONObject info = new JSONObject();
                    info.put("last", serverUrl == null ? JSONObject.NULL : serverUrl);
                    info.put("error", connectError == null ? JSONObject.NULL : connectError);
                    String ip = localIpv4();
                    info.put("ip", ip == null ? JSONObject.NULL : ip);
                    view.evaluateJavascript("window.nourishInit(" + info + ")", null);
                } catch (Exception ignored) {
                }
            }
        }
    }
}
