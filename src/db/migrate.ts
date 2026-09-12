import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

export async function migrate(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, "schema.sql"), "utf8");
  await pool.query(sql);
}

// Allow `npm run migrate` to run this file directly.
if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrate()
    .then(() => {
      console.log("schema applied");
      return pool.end();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
