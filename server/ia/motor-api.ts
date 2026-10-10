// Motor da API Batch da Anthropic (chave do Erick). enviar(): lotes 'pronto' de empresas com motor api_batch e
// consentimento LGPD viram UMA requisição cada (uma por parte do dia) num batch; coletar(): resultado vira
// aplicarResultado (o mesmo caminho dos outros motores) ou falha com tentativa a mais (3 e vira 'erro').
import Anthropic from "@anthropic-ai/sdk";
import type { Db } from "../supabase.js";
import { aplicarResultado } from "./aplicar.js";
import { montarLoteTxt } from "./arquivos.js";
import { schemaParaApi } from "./contrato.js";
import { INSTRUCOES_ANALISTA } from "./contrato-gerado.js";

// Só o que o worker usa do SDK: os testes entregam um falso com este formato.
export type ClienteAnthropic = Pick<Anthropic, "messages">;

export const MODELO_PADRAO = "claude-sonnet-5-5";
export const MAX_TOKENS_LOTE = 64000;
const RESERVA_MINUTOS = 26 * 60; // o batch pode levar até 24 h
const RESERVA_CURTA_MINUTOS = 30; // até o batch existir: se a função cair no meio, o lote volta logo
const REQUISICOES_POR_BATCH = 100;
const DIAS_ATRAS = 7;

export function modeloDoAmbiente(): string {
  const m = (process.env.IA_MODELO || "").trim();
  return /^claude-[a-z0-9.-]+$/.test(m) ? m : MODELO_PADRAO;
}

export function clienteAnthropicDoAmbiente(): ClienteAnthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY precisa estar configurada no ambiente do servidor");
  return new Anthropic();
}

// O Haiku 4.5 não aceita `effort`; os modelos 4.6+ e 5.x aceitam.
const ACEITA_EFFORT = /^claude-(sonnet|opus|fable)-(4-[6-9]|5)/;

export function montarRequisicao(loteId: string, texto: string, modelo: string): any {
  return {
    custom_id: loteId,
    params: {
      model: modelo,
      max_tokens: MAX_TOKENS_LOTE,
      // As instruções não mudam entre lotes: ficam em cache (prefixo estável antes do conteúdo do dia).
      system: [{ type: "text", text: INSTRUCOES_ANALISTA, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Analise o lote abaixo e responda só com o JSON do contrato v1 (engine.tipo = "api_batch", engine.modelo = "${modelo}").\n\n${texto}`,
        },
      ],
      output_config: {
        format: { type: "json_schema", schema: schemaParaApi() },
        ...(ACEITA_EFFORT.test(modelo) ? { effort: "medium" } : {}),
      },
    },
  };
}

export type DepsMotor = { db: Db; cliente: ClienteAnthropic; modelo: string; agora: () => Date };

export type LoteFila = { id: string; partner_id: string; dia: string; arquivo_path: string; arquivo_apagado_em: string | null };

export async function enviarLotes({ db, cliente, modelo, agora }: DepsMotor): Promise<{ enviados: number; batches: string[]; falhas: number }> {
  const { data: configs, error: erroCfg } = await db
    .from("ia_retroalimentacao_config")
    .select("partner_id")
    .eq("motor", "api_batch")
    .not("consentimento_ia_em", "is", null);
  if (erroCfg) throw erroCfg;
  const partners = (configs || []).map((c: { partner_id: string }) => c.partner_id);
  if (partners.length === 0) return { enviados: 0, batches: [], falhas: 0 };

  const desde = new Date(agora().getTime() - DIAS_ATRAS * 864e5).toISOString().slice(0, 10);
  const { data: lotes, error: erroLotes } = await db
    .from("ia_lotes")
    .select("id, partner_id, dia, arquivo_path, arquivo_apagado_em")
    .eq("status", "pronto")
    .in("partner_id", partners)
    .gte("dia", desde)
    .order("dia", { ascending: true })
    .limit(300);
  if (erroLotes) throw erroLotes;

  const pedidos: { lote: LoteFila; reserva: string; requisicao: any }[] = [];
  const comBatch = new Set<string>();
  let falhas = 0;
  const batches: string[] = [];
  let enviados = 0;
  try {
    for (const lote of (lotes || []) as LoteFila[]) {
      // Reservar antes de montar: se outro motor pegou o lote, o NULL aqui impede o envio em dois batches.
      const { data: reserva, error } = await db.rpc("ia_reservar_lote", { _lote_id: lote.id, _quem: "api_batch", _minutos: RESERVA_CURTA_MINUTOS });
      if (error) throw error;
      if (!reserva) continue;
      let texto: string | null = null;
      try {
        texto = await montarLoteTxt(db, lote, null);
      } catch {
        texto = null;
      }
      if (!texto) {
        await db.rpc("ia_registrar_falha", { _lote_id: lote.id, _reserva_id: reserva, _motivo: "arquivo do lote indisponível no Storage" });
        falhas++;
        continue;
      }
      pedidos.push({ lote, reserva, requisicao: montarRequisicao(lote.id, texto, modelo) });
    }

    for (let i = 0; i < pedidos.length; i += REQUISICOES_POR_BATCH) {
      const grupo = pedidos.slice(i, i + REQUISICOES_POR_BATCH);
      let batchId: string;
      try {
        const batch = await cliente.messages.batches.create({ requests: grupo.map((p) => p.requisicao) });
        batchId = batch.id;
      } catch (e) {
        const motivo = `falha ao criar o batch: ${e instanceof Error ? e.message : String(e)}`.slice(0, 280);
        for (const p of grupo) await db.rpc("ia_registrar_falha", { _lote_id: p.lote.id, _reserva_id: p.reserva, _motivo: motivo });
        for (const p of grupo) comBatch.add(p.lote.id);
        falhas += grupo.length;
        continue;
      }
      for (const p of grupo) comBatch.add(p.lote.id);
      batches.push(batchId);
      enviados += grupo.length;
      // Só agora a reserva passa para 26 h, junto com o batch_id.
      const ids = grupo.map((p) => p.lote.id);
      const gravar = () =>
        db.from("ia_lotes").update({ batch_id: batchId, reservado_ate: new Date(agora().getTime() + RESERVA_MINUTOS * 60e3).toISOString() }).in("id", ids);
      let { error } = await gravar();
      if (error) ({ error } = await gravar());
      if (error) {
        // Sem o batch_id o resultado não teria dono: cancela o batch (melhor esforço) e deixa a reserva curta vencer.
        console.error("[ia] batch criado mas batch_id não gravado:", batchId, error.message);
        try {
          await cliente.messages.batches.cancel(batchId);
        } catch {
          /* o cancelamento é só para não pagar à toa */
        }
      }
    }
  } catch (e) {
    // Parou no meio: o que ainda não foi para um batch volta para a fila em vez de esperar a reserva vencer.
    for (const p of pedidos) if (!comBatch.has(p.lote.id)) await db.rpc("ia_registrar_falha", { _lote_id: p.lote.id, _reserva_id: p.reserva, _motivo: "envio interrompido" });
    throw e;
  }
  return { enviados, batches, falhas };
}

// Da resposta do modelo ao aplicarResultado, igual para o batch e para o teste direto. O modelo só vê o próprio
// lote: a identificação vem da linha do banco, nunca do que ele escreveu. Falha devolve o motivo para o chamador registrar.
export async function aplicarMensagem(
  db: Db,
  lote: { id: string; partner_id: string; dia: string },
  msg: Pick<Anthropic.Message, "model" | "stop_reason" | "content">,
  batchId: string,
): Promise<{ ok: boolean; corpo?: Record<string, unknown>; motivo?: string }> {
  if (msg.stop_reason === "refusal") return { ok: false, motivo: `refusal:${(msg as any).stop_details?.category ?? "sem_categoria"}` };
  // max_tokens: o JSON veio cortado e não serve; a tentativa conta e o lote volta para a fila.
  if (msg.stop_reason !== "end_turn") return { ok: false, motivo: `stop_reason:${msg.stop_reason}` };
  const bloco = msg.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  let json: any;
  try {
    json = JSON.parse(bloco?.text ?? "");
  } catch {
    return { ok: false, motivo: "json_invalido" };
  }
  if (json && typeof json === "object") {
    json.engine = { tipo: "api_batch", modelo: msg.model };
    json.lote_id = lote.id;
    json.partner_id = lote.partner_id;
    json.dia = String(lote.dia).slice(0, 10);
  }
  const dia = String(lote.dia).slice(0, 10);
  const resp = await aplicarResultado(db, json, { tipo: "batch", batchId }, { loteEsperado: { id: lote.id, partner_id: lote.partner_id, dia } });
  if (resp.http === 200) return { ok: true, corpo: resp.corpo };
  const detalhe = Array.isArray(resp.corpo.detalhes) ? ` ${(resp.corpo.detalhes as string[]).slice(0, 3).join("; ")}` : "";
  return { ok: false, motivo: `aplicar:${resp.http}:${String(resp.corpo.erro ?? "")}${detalhe}` };
}

export type ResultadoAgora = { ok: boolean; corpo?: Record<string, unknown>; http?: number; erro?: string; motivo?: string };

// Teste do mesmo dia: UM lote vai direto para a API (sem Batch, para a resposta voltar na hora) e o resultado entra
// pelo mesmo aplicarResultado. Mesma reserva e mesmas regras de falha do batch; o lote só vira concluído se aplicar.
export async function analisarLoteAgora(db: Db, cliente: ClienteAnthropic, modelo: string, lote: LoteFila): Promise<ResultadoAgora> {
  const { data: reserva, error } = await db.rpc("ia_reservar_lote", { _lote_id: lote.id, _quem: "api_direto", _minutos: RESERVA_CURTA_MINUTOS });
  if (error) throw error;
  if (!reserva) return { ok: false, http: 409, erro: "lote_indisponivel" };
  const falhar = async (motivo: string, http: number): Promise<ResultadoAgora> => {
    const rpc = FALHA_DEFINITIVA.test(motivo) ? "ia_encerrar_lote" : "ia_registrar_falha";
    await db.rpc(rpc, { _lote_id: lote.id, _reserva_id: reserva, _motivo: motivo.slice(0, 280) });
    return { ok: false, http, erro: "analise_falhou", motivo };
  };
  let texto: string | null = null;
  try {
    texto = await montarLoteTxt(db, lote, null);
  } catch {
    texto = null;
  }
  if (!texto) return falhar("arquivo do lote indisponível no Storage", 410);

  let msg: Anthropic.Message;
  try {
    const { params } = montarRequisicao(lote.id, texto, modelo);
    // Streaming: com max_tokens alto o SDK recusa a chamada comum.
    msg = await cliente.messages.stream(params).finalMessage();
  } catch (e) {
    return falhar(`falha na chamada à API: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
  // O aplicarResultado confere o batch_id do lote: aqui ele é só o rótulo desta chamada, gravado depois da resposta
  // para o ia-coletar nunca tentar ler um batch que não existe.
  const rotulo = `direto:${reserva}`;
  const { error: erroRotulo } = await db.from("ia_lotes").update({ batch_id: rotulo }).eq("id", lote.id);
  if (erroRotulo) return falhar("batch_id não gravado", 500);
  const feito = await aplicarMensagem(db, lote, msg, rotulo);
  if (!feito.ok) return falhar(feito.motivo!, 502);
  return { ok: true, corpo: feito.corpo };
}

type LoteReservado = { id: string; partner_id: string; dia: string; batch_id: string; reserva_id: string | null };

// Falhas que se repetiriam iguais no próximo envio (mesma entrada, mesmo modelo): não vale pagar de novo.
const FALHA_DEFINITIVA = /^(refusal|stop_reason:max_tokens|batch:errored:invalid_request)/;

export async function coletarLotes({ db, cliente }: DepsMotor): Promise<{ batches: number; aplicados: number; falhas: number }> {
  const { data, error } = await db.from("ia_lotes").select("id, partner_id, dia, batch_id, reserva_id").eq("status", "reservado").not("batch_id", "is", null);
  if (error) throw error;
  const porBatch = new Map<string, LoteReservado[]>();
  for (const l of (data || []) as LoteReservado[]) porBatch.set(l.batch_id, [...(porBatch.get(l.batch_id) ?? []), l]);

  let aplicados = 0;
  let falhas = 0;
  let prontos = 0;
  for (const [batchId, lotes] of porBatch) {
    const tratados = new Set<string>();
    const falhar = async (lote: LoteReservado, motivo: string) => {
      tratados.add(lote.id);
      falhas++;
      if (!lote.reserva_id) return;
      const rpc = FALHA_DEFINITIVA.test(motivo) ? "ia_encerrar_lote" : "ia_registrar_falha";
      await db.rpc(rpc, { _lote_id: lote.id, _reserva_id: lote.reserva_id, _motivo: motivo.slice(0, 280) });
    };
    let batch;
    try {
      batch = await cliente.messages.batches.retrieve(batchId);
    } catch (e) {
      // Um batch que não abre não pode travar os outros. 404 não melhora com o tempo: os lotes dele voltam para a fila.
      console.error("[ia] batch não pôde ser lido:", batchId, e instanceof Error ? e.message : e);
      if ((e as { status?: number })?.status === 404) for (const lote of lotes) await falhar(lote, "batch_nao_encontrado");
      continue;
    }
    if (batch.processing_status !== "ended") continue;
    prontos++;
    const porId = new Map(lotes.map((l) => [l.id, l]));

    // A ordem dos resultados é qualquer: a chave é o custom_id (= id do lote).
    for await (const item of await cliente.messages.batches.results(batchId)) {
      const lote = porId.get(item.custom_id);
      if (!lote || tratados.has(lote.id)) continue;
      const r = item.result;
      if (r.type !== "succeeded") {
        await falhar(lote, r.type === "errored" ? `batch:errored:${(r.error as any)?.error?.type ?? "?"}` : `batch:${r.type}`);
        continue;
      }
      const feito = await aplicarMensagem(db, lote, r.message, batchId);
      if (feito.ok) {
        tratados.add(lote.id);
        aplicados++;
      } else await falhar(lote, feito.motivo!);
    }
    for (const lote of lotes) if (!tratados.has(lote.id)) await falhar(lote, "sem_resultado_no_batch");
  }
  return { batches: prontos, aplicados, falhas };
}
