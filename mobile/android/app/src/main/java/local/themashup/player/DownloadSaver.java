package local.themashup.player;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * TheMashup — scoped-storage downloader (v2: native streaming).
 *
 * Streams the gateway URL straight to the shared Downloads collection —
 * no base64 payloads cross the WebView bridge, so large FLACs/MP4s are fine:
 *
 * - Android 10+ (Q): MediaStore.Downloads with IS_PENDING handoff (the
 *   scoped-storage-correct route; no runtime permission).
 * - Android 9 and below: direct write into public Downloads
 *   (WRITE_EXTERNAL_STORAGE is declared with maxSdkVersion="28").
 *
 * Identity for the file route rides in the URL query string (?dev_user= /
 * ?access_token=), so no headers are needed. Cleartext http is allowed via
 * android:usesCleartextTraffic="true" (LAN gateway).
 *
 * Registered from {@link MainActivity#onCreate}; exposed to the WebView as
 * `DownloadSaver.download({ url, name })` (apps/web/src/lib/mobile.ts).
 */
@CapacitorPlugin(name = "DownloadSaver")
public class DownloadSaver extends Plugin {

    private static final ExecutorService IO = Executors.newCachedThreadPool();

    private static String mimeFor(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".opus") || lower.endsWith(".ogg")) return "audio/ogg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".m4a")) return "audio/mp4";
        if (lower.endsWith(".mp4")) return "video/mp4";
        return "application/octet-stream";
    }

    private static String sanitize(String name) {
        String clean = name.replace(File.separatorChar, '_').replace('/', '_');
        if (clean.contains("..") || clean.isEmpty()) return "download.bin";
        return clean;
    }

    private void runOnMain(Runnable r) {
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(r);
        else r.run();
    }

    @PluginMethod()
    public void download(PluginCall call) {
        final String url = call.getString("url");
        final String rawName = call.getString("name");
        if (url == null || url.isEmpty() || rawName == null) {
            call.reject("url and name are required");
            return;
        }
        final String name = sanitize(rawName);

        IO.execute(() -> {
            HttpURLConnection conn = null;
            try {
                conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(180000);
                conn.setInstanceFollowRedirects(true);
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    final String msg = "gateway returned " + code;
                    runOnMain(() -> call.reject("download failed: " + msg));
                    return;
                }

                InputStream in = conn.getInputStream();
                JSObject ret = new JSObject();

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    Uri uri = writeScoped(in, name);
                    if (uri == null) {
                        runOnMain(() -> call.reject("Could not create Downloads entry"));
                        return;
                    }
                    ret.put("uri", uri.toString());
                } else {
                    File out = writeLegacy(in, name);
                    ret.put("path", out.getAbsolutePath());
                }
                final JSObject result = ret;
                runOnMain(() -> call.resolve(result));
            } catch (Exception e) {
                final String msg = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
                runOnMain(() -> call.reject("download failed: " + msg));
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    /** Android 10+: MediaStore.Downloads, IS_PENDING until fully written. */
    private Uri writeScoped(InputStream in, String name) throws IOException {
        ContentValues values = new ContentValues();
        values.put(MediaStore.Downloads.DISPLAY_NAME, name);
        values.put(MediaStore.Downloads.MIME_TYPE, mimeFor(name));
        values.put(MediaStore.Downloads.IS_PENDING, 1);

        Uri uri = getContext().getContentResolver().insert(
            MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
        if (uri == null) return null;
        try {
            OutputStream os = getContext().getContentResolver().openOutputStream(uri);
            if (os == null) throw new IOException("Could not open output stream");
            try {
                stream(in, os);
            } finally {
                os.close();
            }
        } catch (IOException e) {
            // Don't leave a broken pending row behind.
            try {
                getContext().getContentResolver().delete(uri, null, null);
            } catch (Exception ignored) {
            }
            throw e;
        }
        values.clear();
        values.put(MediaStore.Downloads.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, values, null, null);
        return uri;
    }

    /** Android 9 and below: legacy public Downloads folder. */
    private File writeLegacy(InputStream in, String name) throws IOException {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Downloads directory unavailable");
        File out = new File(dir, name);
        FileOutputStream fos = new FileOutputStream(out);
        try {
            stream(in, fos);
        } finally {
            fos.close();
        }
        return out;
    }

    private static void stream(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
        out.flush();
    }
}
