package local.themashup.player;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * TheMashup — scoped-storage downloader.
 *
 * Android 10+ (Q): writes through MediaStore.Downloads (IS_PENDING handoff).
 *   This is the scoped-storage-correct route: no runtime permission needed,
 *   the file lands in the shared Downloads collection visible to other apps.
 * Android 9 and below: writes directly into the public Downloads folder
 *   (WRITE_EXTERNAL_STORAGE is declared in the manifest with maxSdkVersion=28).
 *
 * Registered from {@link MainActivity#onCreate}; exposed to the WebView as
 * `DownloadSaver.save({ name, base64 })` (see apps/web/src/lib/mobile.ts).
 */
@CapacitorPlugin(name = "DownloadSaver")
public class DownloadSaver extends Plugin {

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

    @PluginMethod()
    public void save(PluginCall call) {
        String name = call.getString("name");
        String base64 = call.getString("base64");
        if (name == null || name.isEmpty() || base64 == null) {
            call.reject("name and base64 are required");
            return;
        }
        // Never allow directory traversal out of Downloads.
        name = name.replace(File.separatorChar, '_').replace('/', '_');
        if (name.contains("..")) {
            call.reject("invalid name");
            return;
        }

        try {
            byte[] bytes = Base64.decode(base64, Base64.NO_WRAP);
            JSObject ret = new JSObject();

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // Scoped-storage path: MediaStore.Downloads, no runtime permission.
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, name);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeFor(name));
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri uri = getContext().getContentResolver().insert(
                    MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    call.reject("Could not create Downloads entry");
                    return;
                }
                OutputStream os = getContext().getContentResolver().openOutputStream(uri);
                if (os == null) {
                    call.reject("Could not open output stream");
                    return;
                }
                try {
                    os.write(bytes);
                } finally {
                    os.close();
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, values, null, null);
                ret.put("uri", uri.toString());
            } else {
                File dir = Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_DOWNLOADS);
                if (!dir.exists() && !dir.mkdirs()) {
                    call.reject("Downloads directory unavailable");
                    return;
                }
                File out = new File(dir, name);
                FileOutputStream fos = new FileOutputStream(out);
                try {
                    fos.write(bytes);
                } finally {
                    fos.close();
                }
                ret.put("path", out.getAbsolutePath());
            }

            call.resolve(ret);
        } catch (Exception e) {
            call.reject("save failed: " + e.getMessage());
        }
    }
}
