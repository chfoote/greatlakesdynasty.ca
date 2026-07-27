import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
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
