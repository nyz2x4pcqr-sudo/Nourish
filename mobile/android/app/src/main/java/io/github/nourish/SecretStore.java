package io.github.nourish;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * API keys for the free recipe and nutrition services (Settings → Recipe and nutrition services).
 * Each key is encrypted with an AES key that lives in the Android Keystore (it never leaves the
 * phone's secure hardware where there is one) and stored encrypted in private app storage, which is
 * left out of backups (backup_rules.xml). Never in the web app's storage, logs or sync data.
 */
final class SecretStore {
    private static final String ALIAS = "nourish_service_keys";
    private static final String PREFS = "nourish_secrets";
    private final SharedPreferences prefs;

    SecretStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static boolean validName(String name) {
        return name != null && name.matches("^[a-z0-9_]{1,40}$");
    }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build());
        return gen.generateKey();
    }

    String get(String name) throws Exception {
        String stored = prefs.getString(name, null);
        if (stored == null) return "";
        byte[] all = Base64.decode(stored, Base64.NO_WRAP);
        byte[] iv = new byte[12];
        System.arraycopy(all, 0, iv, 0, 12);
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    }

    void set(String name, String value) throws Exception {
        if (value == null || value.trim().isEmpty()) { delete(name); return; }
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV();
        byte[] body = c.doFinal(value.trim().getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + body.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(body, 0, all, iv.length, body.length);
        prefs.edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
    }

    void delete(String name) {
        prefs.edit().remove(name).apply();
    }

    List<String> names() {
        List<String> out = new ArrayList<>(prefs.getAll().keySet());
        Collections.sort(out);
        return out;
    }
}
