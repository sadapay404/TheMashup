import { createApp } from "./app.js";
import { config } from "./config.js";
import { log } from "./logger.js";

const app = createApp();

app.listen(config.port, config.host, () => {
  log.info(`TheMashup API gateway → http://${config.host}:${config.port}`);
  log.info(`resolver backend: ${config.resolverUrl}`);
  log.info(`lyrics: ${config.mockUpstream ? "MOCK fixtures" : config.lyricsBase}`);
});
