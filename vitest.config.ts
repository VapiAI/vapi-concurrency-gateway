import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Load `.env.test` without adding a dotenv dependency. Tests point at a
// SEPARATE database from the demo, because the helper truncates every table
// before each test and must never be able to reach the demo's data.
function envTest(): Record<string, string> {
  // Resolved against THIS FILE, not the cwd. A cwd-relative path silently
  // yields no DATABASE_URL when the suite is invoked from the repo root, and
  // the failure surfaces later as a confusing "Missing required env var".
  const envPath = join(dirname(fileURLToPath(import.meta.url)), '.env.test');
  if (!existsSync(envPath)) return {};
  const parsed = Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );

  // A real environment variable WINS over the file. Without this, `env` here
  // clobbers the command line and `DATABASE_URL=... npx vitest run` silently
  // hits the file's database instead. That matters because two suites sharing
  // one database destroy each other: `resetDb` truncates every table, so a
  // parallel run wipes the other's fixtures mid-test.
  for (const key of Object.keys(parsed)) {
    if (process.env[key]) delete parsed[key];
  }

  return parsed;
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: envTest(),
    // The admission tests exercise real Postgres row locks. Running files in
    // parallel would have them fighting over the same tables.
    fileParallelism: false,
    // Generous, because a hosted test database adds a network round trip to
    // every query and the burst test issues a lot of them.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
