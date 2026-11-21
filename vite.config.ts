import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import nhlWorker from "./worker/index";

// https://vite.dev/config/
export default defineConfig({
  build: { manifest: true },
  server: {
    proxy: {
      "/nhl-api": {
        target: "https://api.nhle.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nhl-api/, "/stats/rest/en"),
      },
      "/nhl-web-api": {
        target: "https://api-web.nhle.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nhl-web-api/, "/v1"),
      },
      "/nhl-search-api": {
        target: "https://search.d3.nhle.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/nhl-search-api/, "/api/v1"),
      },
    },
  },
  plugins: [
    {
      name: "nhl-live-snapshot-dev",
      configureServer(server) {
        // Run the same bundle handler locally, ahead of Vite's existing proxies.
        server.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/nhl-web-api/live-snapshot")) return next();
          const request = new Request(`http://localhost${req.url}`, { method: req.method });
          const env = { ASSETS: { async fetch() { return new Response(null, { status: 404 }); } } };
          void nhlWorker.fetch(request, env).then(async (response) => {
            res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
            res.end(Buffer.from(await response.arrayBuffer()));
          }).catch(next);
        });
      },
    },
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        // This will transform your SVG to a React component
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
});
