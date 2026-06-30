import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const isProduction = process.env.NODE_ENV === "production";
const isReplit = process.env.REPL_ID !== undefined;

const port = process.env.PORT ? Number(process.env.PORT) : 5173;
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(async () => {
  const plugins: import("vite").PluginOption[] = [
    react(),
    tailwindcss(),
  ];

  if (!isProduction && isReplit) {
    const [{ default: runtimeErrorOverlay }, { cartographer }, { devBanner }] =
      await Promise.all([
        import("@replit/vite-plugin-runtime-error-modal"),
        import("@replit/vite-plugin-cartographer"),
        import("@replit/vite-plugin-dev-banner"),
      ]);
    plugins.push(
      runtimeErrorOverlay(),
      cartographer({ root: path.resolve(import.meta.dirname, "..") }),
      devBanner(),
    );
  }

  return {
    base: basePath,
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      strictPort: true,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: { strict: true },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
