import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // 既定は node。DOM が要るテストだけファイル先頭に
    // `// @vitest-environment happy-dom` を書く。
    environment: "node",
    include: ["tests/**/*.test.ts", "shared/**/*.test.ts", "src/**/*.test.ts"],
  },
});
