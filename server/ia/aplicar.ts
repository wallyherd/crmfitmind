// Ponto único de entrada do resultado da IA, igual para os três motores (rotina do dono, API Batch e
// importação manual): contrato, motor coerente com a credencial, lote/partner/dia, reserva, idempotência
// e, por fim, ia_aplicar_analise no banco.
import { createHash } from "node:crypto";
import { ERRO_SEM_CONTEUDO, podeNaEmpresa, podeVerConteudo, type Autenticacao } from "../auth.js";
import type { Db } from "../supabase.js";
import { empresasDaRotina } from "./acesso.js";
import { conferirComLote, podar, validarAnalise, type AnaliseV1 } from "./contrato.js";

export type Principal =
  | { tipo: "token"; id: string; partnerIds: string[] }
  | { tipo: "usuario"; auth: Autenticacao }
  | { tipo: "batch"; batchId: string };

export type OpcoesAplicar = {
  // Batch: o lote da linha do banco; a resposta do modelo tem de apontar para o mesmo.
  loteEsperado?: { id: string; partner_id: string; dia: string };
  reservaId?: string;
  substituir?: boolean;
  // Busca o texto do lote no Storage; quando devolve texto, o servidor confere trecho e valor contra ele.
  buscarTexto?: (lote: { id: string; arquivo_path: string; arquivo_apagado_em: string | null }) => Promise<string | null>;
};

export type RespostaAplicar = { http: number; corpo: Record<string, unknown> };

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

const MOTOR_DO_PRINCIPAL = { token: "rotina_dono", usuario: "manual", batch: "api_batch" } as const;

export function principalComoTexto(p: Principal): string {
  return p.tipo === "token" ? `token:${p.id}` : p.tipo === "batch" ? `batch:${p.batchId}` : `usuario:${p.auth.profileId}`;
}

// A análise manual grava conteúdo da empresa: o admin só entra com o opt-in do dono.
async function podeNoPartner(db: Db, p: Principal, partnerId: string): Promise<boolean> {
  if (p.tipo === "batch") return true;
  // O token só vale na empresa que escolheu a rotina, deu o consentimento e mantém a liberação do mentor.
  // Conferido antes de baixar o lote: a conferência de trecho e valor responderia sobre o texto das conversas.
  if (p.tipo === "token") return p.partnerIds.includes(partnerId) && (await empresasDaRotina(db, [partnerId])).length > 0;
  return podeVerConteudo(db, p.auth, partnerId, "crm");
}

export async function aplicarResultado(db: Db, bruto: unknown, principal: Principal, op: OpcoesAplicar = {}): Promise<RespostaAplicar> {
  const validacao = validarAnalise(principal.tipo === "batch" ? podar(bruto) : bruto);
  if (!validacao.analise) return { http: 422, corpo: { erro: "contrato_invalido", detalhes: validacao.detalhes } };
  const a: AnaliseV1 = validacao.analise;

  const esperado = MOTOR_DO_PRINCIPAL[principal.tipo];
  if (a.engine.tipo !== esperado) {
    return { http: 422, corpo: { erro: "engine_nao_confere", esperado, detalhes: [`engine.tipo: deve ser ${esperado} para esta credencial`] } };
  }
  if (!(await podeNoPartner(db, principal, a.partner_id))) {
    const soFaltaLiberacao = principal.tipo === "usuario" && podeNaEmpresa(principal.auth, a.partner_id, "crm");
    return { http: 403, corpo: { erro: soFaltaLiberacao ? ERRO_SEM_CONTEUDO : "sem_acesso" } };
  }
  if (principal.tipo === "batch") {
    const e = op.loteEsperado;
    if (!e || e.id !== a.lote_id || e.partner_id !== a.partner_id || e.dia !== a.dia) {
      return { http: 422, corpo: { erro: "lote_trocado_pelo_modelo", detalhes: ["lote_id, partner_id e dia devem ser os do lote enviado neste pedido"] } };
    }
  }

  const { data: lote, error: erroLote } = await db
    .from("ia_lotes")
    .select("id, partner_id, dia, status, reserva_id, batch_id, refs, arquivo_path, arquivo_apagado_em")
    .eq("id", a.lote_id)
    .maybeSingle();
  if (erroLote) throw erroLote;
  if (!lote || lote.partner_id !== a.partner_id || String(lote.dia).slice(0, 10) !== a.dia) {
    return { http: 422, corpo: { erro: "lote_nao_confere", detalhes: ["lote_id, partner_id e dia precisam bater com o cabeçalho do lote"] } };
  }
  if (lote.status === "expirado" || lote.status === "ignorado") return { http: 409, corpo: { erro: `lote_${lote.status}` } };
  if (lote.status === "gerando") return { http: 409, corpo: { erro: "lote_em_geracao" } };
  if (principal.tipo === "token" && lote.status === "reservado" && op.reservaId !== lote.reserva_id) {
    return { http: 409, corpo: { erro: "reserva_de_outro" } };
  }
  if (principal.tipo === "batch") {
    if (lote.batch_id !== principal.batchId) return { http: 409, corpo: { erro: "lote_de_outro_batch" } };
    // Outro motor (ou o mentorado, à mão) já fechou este lote: o batch não refaz.
    if (lote.status === "concluido") return { http: 200, corpo: { ok: true, ignorado: "lote_ja_concluido" } };
  }

  const refsDoLote = Object.keys(lote.refs ?? {}).filter((k) => /^c\d+$/.test(k));
  const analisadas = new Set(a.contatos.map((c) => c.ref));
  const faltando = refsDoLote.filter((k) => !analisadas.has(k));
  const avisos: string[] = [];
  if (faltando.length) {
    if (principal.tipo !== "batch") return { http: 422, corpo: { erro: "conversas_sem_analise", detalhes: faltando.slice(0, 50).map((r) => `contatos: faltou analisar a conversa ${r}`) } };
    avisos.push(`conversas sem análise: ${faltando.slice(0, 20).join(", ")}`);
  }
  if (op.buscarTexto && principal.tipo !== "batch" && !lote.arquivo_apagado_em) {
    const texto = await op.buscarTexto(lote);
    const erros = texto ? conferirComLote(a, texto) : [];
    if (erros.length) return { http: 422, corpo: { erro: "contrato_invalido", detalhes: erros } };
  }

  const idem = sha256(`${a.partner_id}|${a.dia}|${a.engine.tipo}|${a.lote_id}`);
  const payloadSha = sha256(JSON.stringify(a));
  const { data: existente, error: erroBusca } = await db
    .from("ia_analises")
    .select("id, status, resultado, payload_sha")
    .eq("idem_chave", idem)
    .maybeSingle();
  if (erroBusca) throw erroBusca;

  let analiseId: string | null = null;
  if (existente && existente.payload_sha === payloadSha) {
    if (existente.status === "aplicada") return { http: 200, corpo: { ok: true, duplicado: true, analise_id: existente.id, resultado: existente.resultado } };
    analiseId = existente.id; // chegou antes mas não terminou de aplicar: tenta de novo
  } else if (existente) {
    // Análise que falhou ao aplicar ('erro') não vale nada: qualquer principal pode refazê-la. A 'aplicada' só o mentorado troca, de propósito.
    const substituivel = existente.status === "erro" || (principal.tipo === "usuario" && op.substituir === true && existente.status !== "recebida");
    if (!substituivel) return { http: 409, corpo: { erro: "ja_existe_analise_deste_motor", analise_id: existente.id } };
    const { error } = await db.from("ia_analises").update({ idem_chave: `${idem}:substituida:${existente.id}` }).eq("id", existente.id);
    if (error) throw error;
  }

  if (!analiseId) {
    const { data: nova, error } = await db
      .from("ia_analises")
      .insert({
        lote_id: a.lote_id,
        partner_id: a.partner_id,
        dia: a.dia,
        engine_tipo: a.engine.tipo,
        modelo: a.engine.modelo,
        idem_chave: idem,
        payload_sha: payloadSha,
        payload: a,
        principal: principalComoTexto(principal),
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { http: 409, corpo: { erro: "envio_simultaneo" } };
      throw error;
    }
    analiseId = nova.id as string;
  }

  const { data: resultado, error: erroAplicar } = await db.rpc("ia_aplicar_analise", { _analise_id: analiseId });
  if (erroAplicar) {
    await db.from("ia_analises").update({ status: "erro", resultado: { erro: String(erroAplicar.message ?? erroAplicar).slice(0, 300) } }).eq("id", analiseId);
    return { http: 500, corpo: { erro: "falha_ao_aplicar" } };
  }
  return { http: 200, corpo: { ok: true, analise_id: analiseId, resultado, ...(avisos.length ? { avisos } : {}) } };
}
