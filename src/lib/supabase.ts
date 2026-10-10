import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = (import.meta.env.VITE_SUPABASE_URL || "").trim();
const chaveAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim();

export const supabaseConfigurado = Boolean(url && chaveAnon);

// Só a URL pública do projeto; a chave anon nunca é exibida na tela.
export const supabaseUrlPublica = url;

// Lido antes do createClient: o supabase-js limpa o hash da URL ao consumir o link de recuperação.
const hashInicial = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
const paramsHash = new URLSearchParams(hashInicial);

export const chegouPorLinkDeRecuperacao = paramsHash.get("type") === "recovery";

// Link de e-mail vencido ou já usado volta com #error=...; o App avisa em vez de ignorar.
export const linkDeAuthInvalido = Boolean(paramsHash.get("error") || paramsHash.get("error_code"));

function clienteAusente(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get() {
      throw new Error(
        "Supabase não configurado: defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no build."
      );
    },
  });
}

/**
 * RLS que nega UPDATE/DELETE não devolve erro, só não altera nada.
 * Use com `.select("id")` no fim da query para confirmar que alguma linha mudou.
 */
export function exigirLinhas<T>(res: { data: T[] | null; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  if (!res.data || res.data.length === 0) {
    throw new Error("Nada foi alterado: registro não encontrado ou sem permissão.");
  }
  return res.data;
}

export const supabase: SupabaseClient = supabaseConfigurado
  ? createClient(url, chaveAnon, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : clienteAusente();
