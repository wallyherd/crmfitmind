import type { VitePWAOptions } from "vite-plugin-pwa";

export const CACHE_API_LEITURA = "api-leitura";

// Única leitura de /api que o desenho (§4.1) deixa ficar em cache para ver offline.
export const PADRAO_API_LEITURA = /^\/api\/(hoje|vendas|painel|conversas)(\/[^?]*)?$/;

const COR = "#08080a";

export const opcoesPwa: Partial<VitePWAOptions> = {
  registerType: "prompt",
  injectRegister: false,
  includeAssets: ["favicon-48x48.png", "apple-touch-icon-180x180.png"],
  manifest: {
    id: "/",
    name: "CRM Mentoria de Vendas",
    short_name: "CRM Vendas",
    description: "Conversas, funil, vendas e plano do dia do seu WhatsApp.",
    lang: "pt-BR",
    start_url: "/?origem=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: COR,
    theme_color: COR,
    categories: ["business", "productivity"],
    icons: [
      { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
      { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
      { src: "pwa-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  },
  workbox: {
    globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
    // As 4 logos originais e os recortes que nenhuma tela usa (~570 KB) ficam fora da instalação; a tela usa logo-escura-recorte.
    globIgnores: ["marca/[1-4]-*", "marca/logo-clara-recorte.png", "marca/simbolo-recorte.png"],
    navigateFallback: "/index.html",
    navigateFallbackDenylist: [/^\/api\//],
    cleanupOutdatedCaches: true,
    runtimeCaching: [
      {
        urlPattern: ({ url, sameOrigin }) => sameOrigin && PADRAO_API_LEITURA.test(url.pathname),
        handler: "NetworkFirst",
        method: "GET",
        options: {
          cacheName: CACHE_API_LEITURA,
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 60, maxAgeSeconds: 86400 },
          cacheableResponse: { statuses: [200] },
        },
      },
      {
        urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
        handler: "CacheFirst",
        options: {
          cacheName: "fontes",
          expiration: { maxEntries: 20, maxAgeSeconds: 31536000 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
};
