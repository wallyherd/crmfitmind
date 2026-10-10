// O cache do service worker é indexado só pela URL: sem isto, outro usuário no mesmo aparelho veria os dados do anterior.
export async function limparCacheApi() {
  try {
    if (typeof caches !== "undefined") await caches.delete("api-leitura");
  } catch {
    // sem Cache API (navegador antigo ou contexto inseguro): não há o que limpar
  }
}
