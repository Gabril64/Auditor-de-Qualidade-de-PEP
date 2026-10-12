import { createApp } from "./app.js";
import { startResultsConsumer } from "./queue/resultsConsumer.js";
import { runSeed } from "./seed.js";
import { purgeOldNotifications } from "./services/results.js";

const PORT = Number(process.env.PORT) || 3001;
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

createApp().listen(PORT, () => {
  console.log(`Producer API listening on port ${PORT}`);
});

if (process.env.DISABLE_BACKGROUND_JOBS !== "1") {
  await runSeed();
  void startResultsConsumer(process.env.REDIS_URL || "redis://localhost:6379");
  purgeOldNotifications();
  setInterval(() => purgeOldNotifications(), PURGE_INTERVAL_MS).unref();
}
