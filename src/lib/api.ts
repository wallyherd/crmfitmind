import { supabase } from "@/lib/supabase";
import { criarClienteApi } from "@/lib/api-nucleo";
import { limparCacheApi } from "@/pwa/limparCacheApi";

export { MENSAGEM_SAIDA, comQuery, lerJson, ErroApi, erroDaResposta } from "@/lib/api-nucleo";
export type { MotivoSaida } from "@/lib/api-nucleo";

const cliente = criarClienteApi({
  obterToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  sair: async () => {
    await limparCacheApi();
    await supabase.auth.signOut({ scope: "local" });
  },
});

/** Todo fetch para /api/* passa por aqui: injeta o Bearer; 401 e conta bloqueada derrubam a sessão. */
export const apiFetch = cliente.apiFetch;
export const apiJson = cliente.apiJson;
export const aoPerderAcesso = cliente.aoPerderAcesso;
