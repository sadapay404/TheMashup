// Private Express head. The browser reaches search/playback only through the
// same-origin host; no auth, downloads or library endpoints are exposed.
import express from "express";
import { httpResolver } from "./services/resolverClient.js";
import { searchRouter } from "./routes/search.js";
import { lyricsRouter } from "./routes/lyrics.js";
import { windowsPlaybackRouter } from "./routes/windowsPlayback.js";
import { windowsDownloadsRouter } from "./routes/windowsDownloads.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

const app = express();
app.disable("x-powered-by");
app.use("/api/search", searchRouter(httpResolver));
app.use("/api/lyrics", lyricsRouter(httpResolver));
app.use("/api/playback", express.json({ limit: "2kb", strict: true }), windowsPlaybackRouter(httpResolver));
app.use("/api/downloads", express.json({ limit: "64kb", strict: true }), windowsDownloadsRouter(httpResolver));
app.use(notFoundHandler);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind the private search gateway");
  console.log(`THEMASHUP_GATEWAY_PORT=${address.port}`);
});
