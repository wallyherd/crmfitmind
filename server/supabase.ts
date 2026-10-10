import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type Db = SupabaseClient;

let cliente: SupabaseClient | null = null;

// Cliente com a service role, criado só na primeira requisição: importar o
// módulo não pode quebrar quando faltar variável de ambiente.
export function supabaseDoAmbiente(): Db {
  if (cliente) return cliente;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error("SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas no ambiente do servidor");
  }
  cliente = createClient(url, chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cliente;
}
