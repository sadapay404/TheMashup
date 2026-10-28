package local.themashup.player;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * LAN gateway discovery (Phase 8 fix cycle).
 *
 * Wraps Android's NsdManager (mDNS/DNS-SD) so the WebView can find the
 * Express gateway advertised as `_themashup._tcp` by apps/api — no manual IP
 * typing on the first launch. Results are collected for `timeoutMs` then
 * returned as `{ hosts: [{ host, port, name }] }`.
 *
 * Registered from {@link MainActivity#onCreate}.
 */
@CapacitorPlugin(name = "NsdDiscovery")
public class NsdDiscovery extends Plugin {

    private static final int MAX_HOSTS = 6;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private NsdManager manager;
    private NsdManager.DiscoveryListener activeListener;
    private Runnable timeoutTask;

    @PluginMethod()
    public void discover(PluginCall call) {
        String serviceType = call.getString("serviceType", "_themashup._tcp.");
        Integer timeout = call.getInt("timeoutMs", 4000);
        int timeoutMs = timeout != null ? timeout : 4000;

        if (manager == null) {
            manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE);
        }
        if (manager == null) {
            call.reject("NsdManager unavailable");
            return;
        }
        stopActiveDiscovery();

        final PluginCall active = call;
        final JSArray hosts = new JSArray();
        final boolean[] settled = { false };

        timeoutTask = () -> finish(active, settled, hosts);
        handler.postDelayed(timeoutTask, timeoutMs);

        activeListener = new NsdManager.DiscoveryListener() {
            @Override
            public void onDiscoveryStarted(String regType) {
            }

            @Override
            public void onServiceFound(NsdServiceInfo info) {
                if (settled[0]) return;
                String type = info.getServiceType() != null ? info.getServiceType() : "";
                if (!type.contains("themashup")) return;
                try {
                    if (hosts.length() >= MAX_HOSTS) return;
                } catch (Exception ignored) {
                    return;
                }
                resolveService(info, hosts);
            }

            @Override
            public void onServiceLost(NsdServiceInfo info) {
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                finish(active, settled, hosts);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
            }
        };

        try {
            manager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, activeListener);
        } catch (Exception e) {
            finish(active, settled, hosts);
        }
    }

    @SuppressWarnings("deprecation")
    private void resolveService(NsdServiceInfo info, final JSArray hosts) {
        try {
            manager.resolveService(info, new NsdManager.ResolveListener() {
                @Override
                public void onServiceResolved(NsdServiceInfo resolved) {
                    if (resolved.getHost() == null) return;
                    try {
                        String host = resolved.getHost().getHostAddress();
                        if (host == null) return;
                        if (host.contains(":") && !host.startsWith("[")) host = "[" + host + "]";
                        String key = host + ":" + resolved.getPort();
                        // Dedupe by host:port.
                        for (int i = 0; i < hosts.length(); i++) {
                            if (key.equals(hosts.getString(i))) return;
                        }
                        JSONObject entry = new JSONObject();
                        entry.put("host", host);
                        entry.put("port", resolved.getPort());
                        entry.put("name", resolved.getServiceName() != null ? resolved.getServiceName() : "");
                        hosts.put(entry.toString());
                    } catch (Exception ignored) {
                    }
                }

                @Override
                public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                }
            });
        } catch (Exception ignored) {
            // A resolve can throw if one is already pending — the next
            // found service will get its chance.
        }
    }

    private void finish(PluginCall call, boolean[] settled, JSArray hosts) {
        if (settled[0]) return;
        settled[0] = true;
        stopActiveDiscovery();
        if (timeoutTask != null) {
            handler.removeCallbacks(timeoutTask);
            timeoutTask = null;
        }
        // hosts entries were stored as JSON strings — unwrap for the bridge.
        JSArray out = new JSArray();
        try {
            for (int i = 0; i < hosts.length(); i++) {
                out.put(new JSONObject(hosts.getString(i)));
            }
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("hosts", out);
        call.resolve(ret);
    }

    private void stopActiveDiscovery() {
        if (activeListener != null && manager != null) {
            try {
                manager.stopServiceDiscovery(activeListener);
            } catch (Exception ignored) {
            }
            activeListener = null;
        }
    }
}
