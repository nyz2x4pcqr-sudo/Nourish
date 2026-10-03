package io.github.nourish;

import android.content.ContentResolver;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * The personal recipe library on Android: Nourish/Recipe Books and Nourish/My Recipes in the app's
 * own files folder (reachable from a PC over USB under Android/data/io.github.nourish/files). Files
 * are added with the system file picker ("Add recipe files" in Settings), which copies them here.
 * The web app lists and reads them (library.js).
 */
final class RecipeLibrary {
    static final String[] FOLDERS = { "Recipe Books", "My Recipes" };
    private static final long MAX_BYTES = 40L * 1024 * 1024;

    private RecipeLibrary() {}

    static File root(Context c) {
        File base = c.getExternalFilesDir(null);
        File dir = new File(base != null ? base : c.getFilesDir(), "Nourish");
        for (String f : FOLDERS) //noinspection ResultOfMethodCallIgnored
            new File(dir, f).mkdirs();
        return dir;
    }

    static String kind(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        int dot = n.lastIndexOf('.');
        String ext = dot >= 0 ? n.substring(dot + 1) : "";
        switch (ext) {
            case "txt": case "text": case "md": case "markdown": return "text";
            case "html": case "htm": case "mhtml": case "webarchive": return "html";
            case "pdf": return "pdf";
            case "jpg": case "jpeg": case "png": case "heic": case "webp": return "image";
            default: return null;
        }
    }

    static JSONObject list(Context c) throws Exception {
        File root = root(c);
        JSONArray files = new JSONArray();
        for (String f : FOLDERS) walk(root, new File(root, f), f, files);
        JSONObject o = new JSONObject();
        o.put("folder", root.getAbsolutePath());
        o.put("files", files);
        return o;
    }

    private static void walk(File root, File dir, String folder, JSONArray out) throws Exception {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            if (out.length() >= 2000 || f.getName().startsWith(".")) continue;
            if (f.isDirectory()) { walk(root, f, folder, out); continue; }
            if (kind(f.getName()) == null) continue;
            JSONObject o = new JSONObject();
            o.put("path", root.toURI().relativize(f.toURI()).getPath());
            o.put("folder", folder);
            o.put("size", f.length());
            o.put("mtime", f.lastModified() / 1000);
            out.put(o);
        }
    }

    static JSONObject read(Context c, String rel) throws Exception {
        File root = root(c).getCanonicalFile();
        File f = new File(root, rel).getCanonicalFile();
        if (!f.getPath().startsWith(root.getPath() + File.separator) || !f.isFile()) throw new IllegalArgumentException("That file isn't in the recipe library.");
        if (f.length() > MAX_BYTES) throw new IllegalArgumentException("That file is too big to read (over 40 MB).");
        String kind = kind(f.getName());
        JSONObject o = new JSONObject();
        o.put("kind", kind);
        if ("text".equals(kind)) o.put("text", new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8));
        else if ("html".equals(kind)) o.put("html", new String(readAll(new FileInputStream(f)), StandardCharsets.UTF_8));
        else if ("pdf".equals(kind)) { o.put("text", ""); o.put("note", "PDFs can't be read on Android yet: open them in Nourish on your PC, or save the recipe as text."); }
        else if ("image".equals(kind)) o.put("image", Base64.encodeToString(readAll(new FileInputStream(f)), Base64.NO_WRAP));
        else throw new IllegalArgumentException("Nourish can't read that kind of file.");
        return o;
    }

    /** Copies files chosen in the system picker into My Recipes. Returns how many were added. */
    static int copyIn(Context c, List<Uri> uris) {
        File dest = new File(root(c), "My Recipes");
        ContentResolver cr = c.getContentResolver();
        int added = 0;
        for (Uri uri : uris) {
            String name = displayName(cr, uri);
            if (name == null || kind(name) == null) continue;
            File out = new File(dest, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
                if (in == null) continue;
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                added++;
            } catch (Exception e) {
                android.util.Log.w("Nourish", "Couldn't copy " + name + ": " + e);
            }
        }
        return added;
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        try (Cursor cur = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cur != null && cur.moveToFirst()) return cur.getString(0);
        } catch (Exception ignored) { }
        return uri.getLastPathSegment();
    }

    private static byte[] readAll(InputStream in) throws Exception {
        try (InputStream i = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = i.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        }
    }

    static List<Uri> urisFrom(android.content.Intent data) {
        List<Uri> uris = new ArrayList<>();
        if (data == null) return uris;
        if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
        else if (data.getData() != null) uris.add(data.getData());
        return uris;
    }
}
