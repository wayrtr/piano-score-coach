import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: { "@": path.join(root, "src") },
  },
  test: {
    environment: "node",
    // Deliberately opt-in: the normal test configuration does not discover
    // this benchmark because its filename is neither *.test.ts nor *.spec.ts.
    include: ["scripts/benchmarks/query.ts", "scripts/benchmarks/parser.ts"],
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
