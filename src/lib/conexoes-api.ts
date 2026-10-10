import { apiJson, comQuery } from "@/lib/api";
import { listaDeConexoes } from "@/lib/whatsapp";
import type { ConexaoPainel, EstadoConversa, OpcoesConexao, PrivacidadeConversa } from "@/types";

export async function listarConexoes(partnerId: string): Promise<ConexaoPainel[]> {
  return listaDeConexoes(await apiJson(comQuery("/api/conexoes", { partnerId })));
}

/** Cria uma conexão (no servidor ou no computador do mentorado). Devolve o id quando o servidor informa. */
export async function criarConexao(partnerId: string, nome: string, modo: "gateway" | "pc" = "gateway"): Promise<string | null> {
  const r = await apiJson<any>("/api/conexoes", {
    method: "POST",
    body: JSON.stringify({ partnerId, nome, modo }),
  });
  return r?.id ?? r?.conexao?.id ?? null;
}

const caminhoDaConexao = (id: string) => `/api/conexoes/${encodeURIComponent(id)}`;

export function pedirPareamento(id: string, pedido: { metodo: "qr" } | { metodo: "codigo"; telefone: string }) {
  return apiJson(`${caminhoDaConexao(id)}/parear`, { method: "POST", body: JSON.stringify(pedido) });
}

export function desconectarConexao(id: string) {
  return apiJson(`${caminhoDaConexao(id)}/desconectar`, { method: "POST", body: "{}" });
}

/** Tira a conexão da lista e libera a cota da empresa; no servidor, o WhatsApp sai do aparelho. */
export function arquivarConexao(id: string) {
  return apiJson(`${caminhoDaConexao(id)}/arquivar`, { method: "POST", body: "{}" });
}

export function salvarOpcoesConexao(id: string, opcoes: Partial<OpcoesConexao>) {
  return apiJson(`${caminhoDaConexao(id)}/opcoes`, { method: "PATCH", body: JSON.stringify(opcoes) });
}

export function atualizarConversa(
  id: string,
  mudanca: { privacidade?: PrivacidadeConversa; estado?: EstadoConversa }
) {
  return apiJson(`/api/conversas/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(mudanca) });
}
