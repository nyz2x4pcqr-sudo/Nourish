package io.github.nourish;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

/**
 * Nourish for Android: a full-screen web view of the Nourish app running on your PC.
 * The first time (or when the PC can't be reached) it shows a "connect" page that can
 * find the PC on your Wi-Fi. The address is remembered.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "nourish";
    private static final String KEY_SERVER = "server_url";
    private static final String CONNECT_PAGE = "file:///android_asset/connect.html";

    private WebView web;
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

        web.setWebChromeClient(new WebChromeClient());  // enables alert()/confirm() dialogs
        web.setWebViewClient(new Client());

        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        // A server can also be passed when launching (used by the automated build test).
        String fromIntent = getIntent().getStringExtra(KEY_SERVER);
        if (fromIntent != null && !fromIntent.isEmpty()) {
            prefs.edit().putString(KEY_SERVER, fromIntent).apply();
        }
        serverUrl = prefs.getString(KEY_SERVER, null);
        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else if (serverUrl != null) {
            web.loadUrl(serverUrl);
        } else {
            showConnect(null);
        }
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

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            if (scheme.equals("nourishapp")) {
                if ("open".equals(uri.getHost())) {
                    String url = uri.getQueryParameter("url");
                    if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                        serverUrl = url;
                        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, url).apply();
                        view.loadUrl(url);
                    }
                } else if ("connect".equals(uri.getHost())) {
                    showConnect(null);
                }
                return true;
            }
            if (scheme.equals("file") || isServerUrl(uri)) return false;
            // Anything else (e.g. a recipe's original website) opens in the browser.
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
            }
            return true;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !request.getUrl().toString().startsWith("file:")) {
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
