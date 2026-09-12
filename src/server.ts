import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { config } from "./config.js";
import { migrate } from "./db/migrate.js";
import { startCycle } from "./demo/simulate.js";
import { startReconciler } from "./optional/reconciler.js";
import { createDemoRouter } from "./routes/demo.js";
import { createDialRouter } from "./routes/dial.js";
import { createStateRouter } from "./routes/state.js";
import { createWebhookRouter } from "./routes/webhook.js";

export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/vapi", createWebhookRouter());
  app.use("/api", createStateRouter());
  app.use("/api", createDialRouter());

  // DEMO ONLY. Off unless DEMO_MODE=true.
  if (config.demoMode) app.use("/api", createDemoRouter());

  // An unknown /api path must not fall through to the SPA fallback below, or a
  // client typo returns an HTML page and reads as a broken deploy.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const uiDist = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "ui",
    "dist",
  );
  if (existsSync(uiDist)) {
    app.use(express.static(uiDist));
    app.get("*", (_req, res) => {
      res.sendFile(join(uiDist, "index.html"));
    });
  } else {
    console.warn(`[isv-cap] no built UI at ${uiDist}, serving the API only`);
  }

  return app;
}

export async function startServer(): Promise<void> {
  await migrate();

  const app = createApp();

  app.listen(config.port, () => {
    console.log(`[isv-cap] listening on ${config.port}`);
  });

  if (config.reconciliationEnabled) {
    startReconciler();
  }

  // DEMO ONLY. Moves a filled tenant between cap and cap minus one so the
  // meter has something to show without a real call.
  if (config.demoMode) {
    startCycle();
  }
}

// A rejected promise anywhere outside a request would otherwise exit the
// process by default on Node 22. The routes are wrapped individually, this is
// the backstop for the background workers.
process.on("unhandledRejection", (reason) => {
  console.error("[isv-cap] unhandled rejection", reason);
});

if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
