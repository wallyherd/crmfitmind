// Chamadas das telas das Fases 2 e 3. Um lugar só para o CONTRATO DE API FASES 2/3:
// se o servidor mudar um caminho ou um campo, muda aqui.
import { apiFetch, apiJson, comQuery, erroDaResposta, lerJson } from "@/lib/api";
import type { RespostaApagarContato } from "@/lib/lgpd";
import type {
  AlteracaoConfigIa,
  ConfigIa,
  CorrecaoContato,
  DadosProduto,
  DadosRastreio,
  DecisaoVenda,
  LoteIa,
  MensagemRastreio,
  MetaDiaria,
  NovaVendaManual,
  Pendencia,
  Produto,
  RelatorioDia,
  RespostaSugestao,
  LoteGerado,
  ResultadoImportacao,
  TokenIa,
  VendasResposta,
} from "@/types";

const id = (valor: string) => encodeURIComponent(valor);

function json(metodo: string, corpo?: unknown): RequestInit {
  return corpo === undefined ? { method: metodo } : { method: metodo, body: JSON.stringify(corpo) };
}

/** Lista que pode vir crua ([...]) ou embrulhada ({chave: [...]}). */
function lista<T>(resposta: unknown, chave: string): T[] {
  if (Array.isArray(resposta)) return resposta as T[];
  const valor = (resposta as Record<string, unknown> | null)?.[chave];
  return Array.isArray(valor) ? (valor as T[]) : [];
}

// ------------------------------------------------------------- relatório e pendências
export const buscarRelatorioDia = (partnerId: string, dia: string) =>
  apiJson<RelatorioDia>(comQuery("/api/relatorios/dia", { partnerId, dia }));

export const buscarPendencias = async (partnerId: string) =>
  lista<Pendencia>(await apiJson(comQuery("/api/pendencias", { partnerId })), "pendencias");

// ---------------------------------------------------------------------------- vendas
export const buscarVendas = (partnerId: string, de: string, ate: string) =>
  apiJson<VendasResposta>(comQuery("/api/vendas", { partnerId, de, ate }));

export const criarVendaManual = (dados: NovaVendaManual) => apiJson("/api/vendas", json("POST", dados));

export const decidirVenda = (vendaId: string, decisao: DecisaoVenda) =>
  apiJson(`/api/vendas/${id(vendaId)}/decidir`, json("POST", decisao));

// -------------------------------------------------------------------------- produtos
export const listarProdutos = async (partnerId: string) =>
  lista<Produto>(await apiJson(comQuery("/api/produtos", { partnerId })), "produtos");

export const criarProduto = (partnerId: string, dados: DadosProduto) =>
  apiJson<Produto>("/api/produtos", json("POST", { partnerId, ...dados }));

export const alterarProduto = (produtoId: string, dados: Partial<DadosProduto> & { ativo?: boolean }) =>
  apiJson<Produto>(`/api/produtos/${id(produtoId)}`, json("PATCH", dados));

export const apagarProduto = (produtoId: string) => apiJson(`/api/produtos/${id(produtoId)}`, json("DELETE"));

// ------------------------------------------------------------- rastreio do tráfego
export const listarRastreios = async (partnerId: string) =>
  lista<MensagemRastreio>(await apiJson(comQuery("/api/rastreamento", { partnerId })), "rastreamento");

export const criarRastreio = (partnerId: string, dados: DadosRastreio) =>
  apiJson<MensagemRastreio>("/api/rastreamento", json("POST", { partnerId, ...dados }));

export const alterarRastreio = (rastreioId: string, dados: Partial<DadosRastreio> & { ativo?: boolean }) =>
  apiJson<MensagemRastreio>(`/api/rastreamento/${id(rastreioId)}`, json("PATCH", dados));

export const apagarRastreio = (rastreioId: string) =>
  apiJson(`/api/rastreamento/${id(rastreioId)}`, json("DELETE"));

// ----------------------------------------------------------------------------- metas
export const buscarMetas = async (partnerId: string) =>
  lista<MetaDiaria>(await apiJson(comQuery("/api/metas", { partnerId })), "metas");

/** Substitui as metas da empresa: tipo que não vier fica sem meta. */
export const salvarMetas = (partnerId: string, metas: MetaDiaria[]) =>
  apiJson(comQuery("/api/metas", { partnerId }), json("PUT", { metas }));

// ---------------------------------------------------------------- configuração da IA
export const buscarConfigIa = (partnerId: string) => apiJson<ConfigIa>(comQuery("/api/ia/config", { partnerId }));

export const salvarConfigIa = (partnerId: string, alteracao: AlteracaoConfigIa) =>
  apiJson<ConfigIa>(comQuery("/api/ia/config", { partnerId }), json("PUT", alteracao));

// ------------------------------------------------------------- correções do mentorado
/** LGPD: só o dono da empresa. */
export const apagarDadosDoContato = (contatoId: string) =>
  apiJson<RespostaApagarContato>(`/api/contatos/${id(contatoId)}`, json("DELETE"));

export const corrigirContato = (contatoId: string, correcao: CorrecaoContato) =>
  apiJson(`/api/contatos/${id(contatoId)}`, json("PATCH", correcao));

export const responderSugestao = (sugestaoId: string, resposta: RespostaSugestao) =>
  apiJson(`/api/ia/sugestoes/${id(sugestaoId)}`, json("POST", resposta));

// ------------------------------------------------------------------- motor manual
export const listarLotes = async (partnerId: string, dia: string) =>
  lista<LoteIa>(await apiJson(comQuery("/api/ia/lotes", { partnerId, dia })), "lotes");

/** O .txt pseudonimizado do lote (text/plain). */
export async function baixarArquivoLote(loteId: string): Promise<string> {
  const res = await apiFetch(`/api/ia/lotes/${id(loteId)}/arquivo`);
  if (!res.ok) throw erroDaResposta(res.status, await lerJson(res));
  return res.text();
}

/**
 * Envia o JSON do contrato v1. O partner sai do partner_id do próprio JSON (o middleware
 * confere o acesso por ele). `substituir` reimporta uma análise corrigida do mesmo lote.
 * 422 chega como ErroApi com `detalhes`.
 */
export const importarAnalise = (analise: unknown, substituir = false) =>
  apiJson<ResultadoImportacao>(
    substituir ? "/api/ia/resultado?substituir=1" : "/api/ia/resultado",
    json("POST", analise),
  );

// ---------------------------------------------------- teste no mesmo dia
/** Gera o lote de hoje (ou de um dos últimos 7 dias) na hora, marcado como dia parcial. Só o dono (ou o mentor liberado). */
export const gerarLoteDeTeste = async (partnerId: string, dia?: string) =>
  lista<LoteGerado>(await apiJson("/api/ia/lotes/gerar", json("POST", { partnerId, ...(dia ? { dia } : {}) })), "lotes");

/** Motor automático: manda só este lote para a IA agora e devolve o resumo do que foi aplicado. */
export const analisarLoteAgora = (loteId: string) =>
  apiJson<{ ok: boolean; lote_id: string; resumo: ResultadoImportacao }>(`/api/ia/lotes/${id(loteId)}/analisar-agora`, json("POST", {}));

// ------------------------------------------------------------------ admin: tokens
export const listarTokensIa = async (): Promise<TokenIa[]> =>
  lista<any>(await apiJson("/api/admin/ia/tokens"), "tokens").map((t) => ({
    id: t.id,
    nome: t.nome,
    partner_ids: t.partner_ids ?? t.partnerIds ?? [],
    criado_em: t.criado_em ?? t.created_at ?? null,
    ultimo_uso_em: t.ultimo_uso_em ?? null,
    revogado_em: t.revogado_em ?? null,
  }));

export const criarTokenIa = (nome: string, partnerIds: string[]) =>
  apiJson<{ token: string }>("/api/admin/ia/tokens", json("POST", { nome, partnerIds }));

export const revogarTokenIa = (tokenId: string) => apiJson(`/api/admin/ia/tokens/${id(tokenId)}`, json("DELETE"));
