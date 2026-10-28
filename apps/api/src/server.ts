import os from "node:os";
import Bonjour from "bonjour-service";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const app = createApp();

app.listen(config.port, config.host, () => {
  log.info(`TheMashup API gateway → http://${config.host}:${config.port}`);
  log.info(`resolver backend: ${config.resolverUrl}`);
  log.info(`lyrics: ${config.mockUpstream ? "MOCK fixtures" : config.lyricsBase}`);
  advertiseOnLan();
});

/**
 * mDNS advertisement so the Android app can find this gateway on the LAN
 * (`_themashup._tcp` → NsdManager, see mobile/.../NsdDiscovery.java).
 * Purely best-effort: multicast can be blocked (Docker, some routers) — the
 * app then falls back to its manual address screen. Set MDNS_OFF=1 to disable.
 */
function advertiseOnLan(): void {
  if (process.env.MDNS_OFF === "1" || process.env.NODE_ENV === "test") return;
  try {
    const bonjour = new Bonjour();
    const lan = lanIPv4();
    const service = bonjour.publish({
      name: "TheMashup Gateway",
      type: "themashup",
      protocol: "tcp",
      port: config.port,
      ...(lan ? { host: lan } : {}),
      txt: { app: "themashup", path: "/api/health" },
    });
    service.start?.();
    const down = () => {
      try {
        service.stop();
        bonjour.destroy();
      } catch {
        /* already gone */
      }
    };
    process.once("SIGINT", down);
    process.once("SIGTERM", down);
    log.info(`mDNS: advertising _themashup._tcp.local. (port ${config.port}${lan ? `, host ${lan}` : ""})`);
  } catch (err) {
    log.warn(`mDNS advertisement disabled (${(err as Error).message})`);
  }
}

/**
 * Pick a phone-reachable IPv4: skip loopback, link-local (169.254) and
 * virtual/tunnel interfaces (docker, veth, wg, tun, …). Without this the
 * probe could advertise only unreachable addresses and the phone would time
 * out even though the gateway is fine — the manual screen stays as fallback.
 */
function lanIPv4(): string | undefined {
  const skip = /^(docker|veth|br-|virbr|tun|wg|zt|cni|flannel|lo)/i;
  const all: string[] = [];
  const fallback: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list ?? []) {
      const isV4 = iface.family === "IPv4" || (iface.family as unknown as number) === 4;
      if (!isV4 || iface.internal || iface.address.startsWith("169.254.")) continue;
      const name = (iface as { name?: string }).name ?? "";
      if (skip.test(name)) fallback.push(iface.address);
      else all.push(iface.address);
    }
  }
  return all[0] ?? fallback[0];
}
