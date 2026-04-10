import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory: "coverage",
      include: [
        "src/lib/memory.ts",
        "src/lib/rate-limit.ts",
        "src/lib/rate-limit-config.ts",
        "src/lib/request-guards.ts",
      ],
    },
  },
});
