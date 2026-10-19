import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    lib: {
      entry: "webview/main.ts",
      formats: ["iife"],
      name: "ErPostieWebview",
      fileName: () => "webview.js",
    },
    outDir: "dist",
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        assetFileNames: (asset) =>
          asset.name?.endsWith(".css") ? "webview.css" : "[name][extname]",
      },
    },
  },
});
