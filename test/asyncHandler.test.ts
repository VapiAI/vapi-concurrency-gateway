import express from "express";
import { afterAll, expect, it } from "vitest";
import { asyncHandler } from "../src/routes/asyncHandler.js";
import { closeDb } from "./helpers/db.js";
import { withServer } from "./helpers/server.js";

afterAll(closeDb);

it("turns a rejected async handler into a 500 instead of hanging the client", async () => {
  const app = express();
  app.get(
    "/boom",
    asyncHandler(async () => {
      throw new Error("database is down");
    }),
  );

  await withServer(app, async (baseUrl) => {
    // Unwrapped, Express 4 leaves this an unhandled rejection: no response at
    // all, and Node exits the process by default. Verified directly.
    const response = await fetch(`${baseUrl}/boom`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal error" });
  });
});

it("does not interfere with a handler that responds normally", async () => {
  const app = express();
  app.get(
    "/fine",
    asyncHandler(async (_req, res) => {
      res.status(200).json({ ok: true });
    }),
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/fine`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

it("leaves an already-sent response alone", async () => {
  const app = express();
  app.get(
    "/late",
    asyncHandler(async (_req, res) => {
      res.status(202).json({ accepted: true });
      throw new Error("thrown after responding");
    }),
  );

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/late`);
    expect(response.status).toBe(202);
  });
});
