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
        "src/app/api/auth/**/*.ts",
        "src/app/api/chat/route.ts",
        "src/app/api/conversations/**/*.ts",
        "src/app/api/memory/route.ts",
        "src/hooks/useChatStream.ts",
        "src/lib/auth.ts",
        "src/lib/auth-guard.ts",
        "src/lib/chat.ts",
        "src/lib/memory.ts",
        "src/lib/rate-limit.ts",
        "src/lib/rate-limit-config.ts",
        "src/lib/request-guards.ts",
        "src/lib/cwd-store.ts",
      ],
    },
  },
});
