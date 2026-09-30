import path from "node:path";

import { defineConfig } from "drizzle-kit";

const storageRoot =
  process.env.PIANO_COACH_STORAGE_DIR ?? path.join(process.cwd(), "storage");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url:
      process.env.NODE_ENV === "test"
        ? path.join(storageRoot, "test", "app.test.db")
        : path.join(storageRoot, "app.db"),
  },
});
