import type { RequestHandler } from "express";

/**
 * Wraps an async route handler so a rejected promise cannot escape.
 *
 * Express 4 does not await handlers, so a throw inside an async one becomes an
 * unhandled rejection: the client hangs with no response and Node 22 exits the
 * process by default. Verified directly, an async handler that throws produced
 * an unhandledRejection and no response at all.
 *
 * Every `await` in a route is a throw site, so a single database hiccup during
 * a dial would otherwise take the whole service down. This turns that into a
 * logged 500 and keeps the process alive.
 *
 * The webhook route does NOT use this. It owns a stricter contract, it must
 * never return 5xx on the admission path, so it carries its own try/catch that
 * answers 200 with a spoken reject instead.
 */
export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch((error) => {
      console.error(`[route] ${req.method} ${req.path} failed`, error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error" });
      }
    });
  };
}
