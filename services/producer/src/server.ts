import { createApp } from "./app.js";
import { startResultsConsumer } from "./queue/resultsConsumer.js";
import { runSeed } from "./seed.js";

const PORT = Number(process.env.PORT) || 3001;

createApp().listen(PORT, () => {
  console.log(`Producer API listening on port ${PORT}`);
});

if (process.env.DISABLE_BACKGROUND_JOBS !== "1") {
  await runSeed();
  void startResultsConsumer(process.env.REDIS_URL || "redis://localhost:6379");
}
