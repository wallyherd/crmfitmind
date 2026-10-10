import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { opcoesPwa, PADRAO_API_LEITURA, CACHE_API_LEITURA } from "../../pwa-config.ts";

const raiz = resolve(import.meta.dirname, "../..");

test("manifest em português, instalável e standalone", () => {
  const m: any = opcoesPwa.manifest;
  assert.equal(m.lang, "pt-BR");
  assert.equal(m.display, "standalone");
  assert.ok(m.name && m.short_name && m.theme_color && m.start_url);
  assert.ok(m.start_url.startsWith(m.scope));
  const tamanhos = m.icons.map((i: any) => `${i.sizes}:${i.purpose ?? "any"}`);
  for (const t of ["192x192:any", "512x512:any", "512x512:maskable"]) assert.ok(tamanhos.includes(t), t);
  for (const i of m.icons) assert.ok(existsSync(resolve(raiz, "public", i.src)), `falta public/${i.src}`);
});

test("registro por aviso (prompt), nunca troca de versão sozinho", () => {
  assert.equal(opcoesPwa.registerType, "prompt");
});

test("service worker só guarda a leitura de /api autorizada pelo desenho", () => {
  for (const ok of ["/api/hoje", "/api/vendas", "/api/painel", "/api/conversas", "/api/conversas/abc"]) {
    assert.ok(PADRAO_API_LEITURA.test(ok), ok);
  }
  for (const no of ["/api/admin/usuarios", "/api/whatsapp/pareamento", "/api/ia/x", "/api/cron/x", "/api/hojexyz", "/api/me", "/hoje"]) {
    assert.ok(!PADRAO_API_LEITURA.test(no), no);
  }
  const regras: any[] = (opcoesPwa.workbox as any).runtimeCaching;
  const api = regras.filter((r) => r.options?.cacheName === CACHE_API_LEITURA);
  assert.equal(api.length, 1);
  assert.equal(api[0].method, "GET");
  assert.equal(api[0].handler, "NetworkFirst");
  assert.deepEqual(api[0].options.cacheableResponse.statuses, [200]);
  // nenhuma outra regra pode capturar /api
  for (const r of regras.filter((r) => r !== api[0])) {
    assert.ok(r.urlPattern instanceof RegExp && !r.urlPattern.test("https://x.com/api/admin"), "regra extra pega /api");
  }
  // /api nunca vira index.html offline
  const negados: RegExp[] = (opcoesPwa.workbox as any).navigateFallbackDenylist;
  assert.ok(negados.some((r) => r.test("/api/qualquer")));
});

test("logout limpa o cache da leitura e o toast de atualização existe", () => {
  const app = readFileSync(resolve(raiz, "src/App.tsx"), "utf8");
  const api = readFileSync(resolve(raiz, "src/lib/api.ts"), "utf8");
  const limpa = readFileSync(resolve(raiz, "src/pwa/limparCacheApi.ts"), "utf8");
  assert.ok(limpa.includes(`"${CACHE_API_LEITURA}"`));
  assert.match(app, /limparCacheApi\(\);\s*await supabase\.auth\.signOut/);
  assert.match(api, /limparCacheApi\(\);\s*await supabase\.auth\.signOut/);
  assert.ok(app.includes("<AtualizacaoApp"));
  const aviso = readFileSync(resolve(raiz, "src/pwa/AtualizacaoApp.tsx"), "utf8");
  assert.ok(aviso.includes("Atualizar"));
});

test("vercel.json: sw.js sem cache e manifest com o tipo certo", () => {
  const v = JSON.parse(readFileSync(resolve(raiz, "vercel.json"), "utf8"));
  const h = (src: string) => v.headers.find((x: any) => x.source === src)?.headers[0];
  assert.match(h("/sw.js").value, /max-age=0/);
  assert.equal(h("/manifest.webmanifest").value, "application/manifest+json");
});

test("build gerado (se existir dist/) tem manifest e sw", { skip: !existsSync(resolve(raiz, "dist/sw.js")) }, () => {
  const arquivos = readdirSync(resolve(raiz, "dist"));
  assert.ok(arquivos.includes("manifest.webmanifest"));
  assert.ok(arquivos.includes("sw.js"));
  assert.ok(!readFileSync(resolve(raiz, "dist/sw.js"), "utf8").includes(["it", "mind", "123"].join("")));
});
