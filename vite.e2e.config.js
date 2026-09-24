import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 4174,
    strictPort: true,
  },
  build: {
    outDir: "dist-e2e",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(process.cwd(), "e2e/index.html"),
    },
  },
});
