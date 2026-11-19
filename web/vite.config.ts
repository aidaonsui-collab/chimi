import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: { host: "127.0.0.1", port: 5173 },
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({
      vercel: {
        // The fee flywheel's daily run (src/server/flywheel.ts), at 00:10 KST, just after the day it pays closes.
        config: { crons: [{ path: "/api/keeper/flywheel", schedule: "10 15 * * *" }] },
        functions: { maxDuration: 60 },
      },
    }),
    viteReact(),
  ],
});
