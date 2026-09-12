import type { Express } from "express";
import type { AddressInfo } from "node:net";

/**
 * Binds the app to an ephemeral port, runs the body against its base URL, then
 * closes it. Avoids adding supertest as a dependency for a handful of routes.
 */
export async function withServer(
  app: Express,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", () => resolve());
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
