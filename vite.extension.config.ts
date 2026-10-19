import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "node20",
    lib: {
      entry: "src/extension.ts",
      formats: ["cjs"],
      fileName: () => "extension.cjs",
    },
    rollupOptions: {
      external: ["vscode"],
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
