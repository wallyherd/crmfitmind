// Leituras diretas da Central de Chat (supabase-js, sob a RLS da conversa).
// Pedem as colunas que existem depois da 002; num banco ainda sem ela, caem para o que houver.
import { supabase } from "@/lib/supabase";
import { temAnuncio } from "@/lib/whatsapp";
import type { AnuncioWhatsApp, Mensagem } from "@/types";

const COLUNAS_MENSAGEM = [
  "id",
  "conversa_id",
  "direcao",
  "tipo",
  "corpo",
  "status",
  "erro",
  "wa_id",
  "created_at",
  "enviada_em",
  "agendado_para",
  "enviada_por",
  "disparo_id",
  "autor",
  "wa_em",
  "momento",
  "participante_jid",
  "participante_telefone",
  "participante_nome",
  "midia",
  "anuncio",
  "origem_evento",
  "citado_wa_id",
  "wa_entregue_em",
  "wa_lida_em",
  "editada_em",
  "apagada_em",
  "arquivo_path",
].join(", ");

// 42703 = coluna inexistente (Postgres); PGRST204/PGRST200 = o PostgREST não achou a coluna/relação.
function colunaAusente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}

let bancoSemColunasDaFase1 = false;

/** As mais recentes primeiro pela hora do WhatsApp (momento); o chamador reordena para exibir. */
export async function buscarMensagens(
  conversaId: string,
  limite: number
): Promise<{ mensagens: Mensagem[]; erro: string | null }> {
  if (!bancoSemColunasDaFase1) {
    const { data, error } = await supabase
      .from("bot_mensagens")
      .select(COLUNAS_MENSAGEM)
      .eq("conversa_id", conversaId)
      .order("momento", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limite);
    if (!error) return { mensagens: (data as unknown as Mensagem[]) || [], erro: null };
    if (!colunaAusente(error)) return { mensagens: [], erro: error.message };
    bancoSemColunasDaFase1 = true;
  }

  const { data, error } = await supabase
    .from("bot_mensagens")
    .select("*")
    .eq("conversa_id", conversaId)
    .order("created_at", { ascending: false })
    .limit(limite);
  if (error) return { mensagens: [], erro: error.message };
  return { mensagens: (data as Mensagem[]) || [], erro: null };
}

// URL do PostgREST com 100 uuids fica perto de 4 KB: seguro em qualquer proxy.
const LOTE_IDS = 100;

/**
 * Primeiro anúncio (CTWA) de cada conversa, para o selo da lista. O dado é o bruto que o
 * gateway mandou (revisão C3): aqui só se mostra, não se decide a origem do lead.
 * null quando o banco ainda não tem a coluna.
 */
export async function buscarAnunciosDasConversas(ids: string[]): Promise<Map<string, AnuncioWhatsApp> | null> {
  const resultado = new Map<string, AnuncioWhatsApp>();
  if (bancoSemColunasDaFase1 || ids.length === 0) return bancoSemColunasDaFase1 ? null : resultado;

  for (let i = 0; i < ids.length; i += LOTE_IDS) {
    const lote = ids.slice(i, i + LOTE_IDS);
    const { data, error } = await supabase
      .from("bot_mensagens")
      .select("conversa_id, anuncio")
      .in("conversa_id", lote)
      .not("anuncio", "is", null)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) {
      if (colunaAusente(error)) {
        bancoSemColunasDaFase1 = true;
        return null;
      }
      throw new Error(error.message);
    }
    for (const linha of (data as Array<{ conversa_id: string; anuncio: AnuncioWhatsApp | null }>) || []) {
      if (!resultado.has(linha.conversa_id) && temAnuncio(linha.anuncio)) {
        resultado.set(linha.conversa_id, linha.anuncio);
      }
    }
  }
  return resultado;
}
