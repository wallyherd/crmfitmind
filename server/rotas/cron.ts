// Rotas chamadas pelo pg_cron (via pg_net) com `Authorization: Bearer <CRON_SECRET>`; sem JWT.
// Todo agendamento mora no banco (banco/agendamentos.sql); a Vercel só executa o trabalho.
import type { Express, RequestHandler } from "express";
import { fusoValido } from "../arquivo-completo.js";
import { segredoConfere, tokenBearer } from "../auth.js";
import { assincrono, type Contexto } from "../contexto.js";
import { cotaDiariaDoAmbiente, lerComprovantesPendentes, limiteDoAmbiente } from "../comprovante-leitura.js";
import { apagarComprovantes } from "../comprovantes.js";
import { apagarArquivos, subirArquivo } from "../ia/arquivos.js";
import { hojeNoFuso } from "../ia/acesso.js";
import { coletarLotes, enviarLotes } from "../ia/motor-api.js";
import type { Db } from "../supabase.js";

const LOTES_POR_CHAMADA = 10;

export function registrarRotasCron(app: Express, ctx: Contexto) {
  const exigirSegredo: RequestHandler = (req, res, next) =>
    segredoConfere(tokenBearer(req), ctx.segredoCron()) ? next() : res.status(401).json({ erro: "nao_autenticado" });

  // Gera os lotes do dia anterior de cada empresa cujo relógio local já passou de 04:30 e ainda não tem lote.
  app.post(
    "/api/cron/exportar",
    exigirSegredo,
    assincrono(async (_req, res) => {
      const db = ctx.db();
      await expirarLotesParciais(db, ctx.agora());
      const { data: devidos, error } = await db.rpc("crm_lotes_devidos", { _limite: LOTES_POR_CHAMADA, _hora: "04:30" });
      if (error) throw error;
      const resultado = { devidos: (devidos || []).length, gerados: 0, partes: 0, erros: 0 };
      for (const d of (devidos || []) as { partner_id: string; dia: string }[]) {
        try {
          const lotes = await exportarDia(db, d.partner_id, String(d.dia).slice(0, 10));
          resultado.gerados++;
          resultado.partes += lotes.length;
        } catch (e) {
          resultado.erros++;
          console.error("[cron/exportar]", d.partner_id, d.dia, e instanceof Error ? e.message : e);
        }
      }
      return res.json(resultado);
    }),
  );

  app.post(
    "/api/cron/ia-enviar",
    exigirSegredo,
    assincrono(async (_req, res) => {
      const r = await enviarLotes({ db: ctx.db(), cliente: ctx.anthropic(), modelo: ctx.modeloIa(), agora: ctx.agora });
      return res.json(r);
    }),
  );

  app.post(
    "/api/cron/ia-coletar",
    exigirSegredo,
    assincrono(async (_req, res) => {
      const r = await coletarLotes({ db: ctx.db(), cliente: ctx.anthropic(), modelo: ctx.modeloIa(), agora: ctx.agora });
      return res.json(r);
    }),
  );

  // Tarefa Q2: a IA lê os comprovantes dos últimos 3 dias que ainda não foram lidos (valor, data, banco, ID da transação).
  // É só pista para o mentorado. Sem chave da Anthropic ou sem empresa com consentimento, não faz nada e não dá erro.
  app.post(
    "/api/cron/ler-comprovantes",
    exigirSegredo,
    assincrono(async (_req, res) => {
      let cliente;
      try {
        cliente = ctx.anthropic();
      } catch {
        return res.json({ lidas: 0, motivo: "sem_chave_da_ia" });
      }
      const modelo = ctx.modeloComprovante();
      const r = await lerComprovantesPendentes({ db: ctx.db(), cliente, modelo, agora: ctx.agora, limite: limiteDoAmbiente(), cotaDiaria: cotaDiariaDoAmbiente() });
      // Custo: quantas leituras e quantos tokens saíram nesta execução.
      console.log(`[cron/ler-comprovantes] modelo=${modelo} empresas=${r.empresas} candidatos=${r.candidatos} lidas=${r.lidas} falhas=${r.falhas} ignoradas=${r.ignoradas} sem_cota=${r.sem_cota} interrompida=${r.interrompida} tokens_entrada=${r.tokens_entrada} tokens_saida=${r.tokens_saida}`);
      return res.json({ ...r, modelo });
    }),
  );

  // Reservas vencidas voltam para a fila; retenção apaga corpo, payload e arquivos vencidos (R3).
  app.post(
    "/api/cron/manutencao",
    exigirSegredo,
    assincrono(async (_req, res) => {
      const db = ctx.db();
      const liberadas = await db.rpc("ia_liberar_reservas_vencidas");
      if (liberadas.error) throw liberadas.error;
      const retencao = await db.rpc("crm_retencao");
      if (retencao.error) throw retencao.error;
      const { arquivos = [], comprovantes_apagar: comprovantes = [], ...contagens } = (retencao.data ?? {}) as { arquivos?: string[]; comprovantes_apagar?: string[] };
      let apagados = 0;
      if (arquivos.length) {
        const falha = await apagarArquivos(db, arquivos);
        if (falha) console.error("[cron/manutencao] storage:", falha);
        else {
          const marcados = await db.rpc("ia_marcar_arquivos_apagados", { _caminhos: arquivos });
          if (marcados.error) throw marcados.error;
          apagados = Number(marcados.data ?? 0);
        }
      }
      // Comprovantes vencidos, de conversa que virou privada ou de pessoa apagada: saem do Storage e da fila do banco.
      // Se o Storage falhar, o caminho continua na fila e a próxima manutenção tenta de novo.
      let comprovantesApagados = 0;
      if (comprovantes.length) {
        const r = await apagarComprovantes(db, comprovantes);
        comprovantesApagados = r.apagados;
        if (r.falha) console.error("[cron/manutencao] storage (comprovantes):", r.falha);
      }
      return res.json({ reservas_liberadas: Number(liberadas.data ?? 0), ...contagens, arquivos_apagados: apagados, comprovantes_apagados: comprovantesApagados });
    }),
  );
}

export type LoteExportado = { id: string; parte: number; status: string };

// Monta o dia no banco e sobe cada parte no bucket privado. Se qualquer parte falhar, TODAS viram 'erro':
// um dia só com parte dos lotes não pode ficar como 'pronto' (o próximo ciclo tenta uma versão nova).
// `parcial` (hora local, HH:MM) marca no cabeçalho do arquivo que o dia ainda não terminou (teste do mesmo dia).
export async function exportarDia(db: Db, partnerId: string, dia: string, parcial?: string): Promise<LoteExportado[]> {
  const { data, error } = await db.rpc("crm_lote_montar", { _partner_id: partnerId, _dia: dia });
  if (error) throw error;
  const partes = ((data as any)?.partes ?? []) as { lote_id: string; parte: number; arquivo_path: string; texto: string }[];
  let falha: string | null = null;
  for (const p of partes) {
    falha = await subirArquivo(db, p.arquivo_path, parcial ? marcarDiaParcial(p.texto, parcial) : p.texto);
    if (falha) break;
  }
  const lotes: LoteExportado[] = [];
  for (const p of partes) {
    const { data: status, error: e2 } = await db.rpc("crm_lote_publicar", { _lote_id: p.lote_id, _ok: !falha, _erro: falha });
    if (e2) throw e2;
    lotes.push({ id: p.lote_id, parte: p.parte, status: String(status) });
  }
  if (falha) throw new Error(`upload no Storage falhou: ${falha}`);
  return lotes;
}

// A IA lê o cabeçalho `#@`: sem esta linha ela trataria "o cliente ainda não respondeu" como "sumiu".
function marcarDiaParcial(texto: string, hora: string): string {
  const linhas = texto.split("\n");
  const f = linhas.findIndex((l) => l.startsWith("#@ fuso: "));
  if (f < 0) return texto;
  linhas.splice(f + 1, 0, `#@ dia_parcial: sim (gerado às ${hora}; o dia ainda não terminou, então números e conversas valem só até esta hora: não conclua que o cliente sumiu nem que a meta do dia falhou)`);
  const k = linhas.findIndex((l) => l.startsWith("#@ linhas: "));
  const n = k >= 0 ? Number(linhas[k].slice("#@ linhas: ".length)) : NaN;
  if (Number.isFinite(n)) linhas[k] = `#@ linhas: ${n + 1}`;
  return linhas.join("\n");
}

// Lote de teste do mesmo dia (gerado antes de o dia acabar) não pode barrar o lote do dia completo: crm_lotes_devidos
// pula o dia que já tem lote pronto ou concluído. Depois das 04:30 do dia seguinte o parcial vira 'expirado' e o ciclo normal refaz.
// A análise já aplicada continua nas tabelas dela; só o lote deixa de contar como "dia feito".
export async function expirarLotesParciais(db: Db, agora: Date): Promise<number> {
  const desde = new Date(agora.getTime() - 5 * 864e5).toISOString().slice(0, 10);
  const { data, error } = await db
    .from("ia_lotes")
    .select("id, dia, fuso, gerado_em")
    .in("status", ["pronto", "concluido", "ignorado"])
    .gte("dia", desde)
    .not("gerado_em", "is", null);
  if (error) throw error;
  const ids: string[] = [];
  for (const l of (data || []) as { id: string; dia: string; fuso: string; gerado_em: string }[]) {
    const dia = String(l.dia).slice(0, 10);
    const fuso = fusoValido(l.fuso);
    const hoje = hojeNoFuso(agora, fuso);
    const hora = new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(agora);
    const geradoNoProprioDia = hojeNoFuso(new Date(l.gerado_em), fuso) <= dia;
    const amanha = somarUmDia(dia);
    if (geradoNoProprioDia && (hoje > amanha || (hoje === amanha && hora >= "04:30"))) ids.push(l.id);
  }
  if (ids.length === 0) return 0;
  const { error: e2 } = await db.from("ia_lotes").update({ status: "expirado" }).in("id", ids);
  if (e2) throw e2;
  return ids.length;
}

function somarUmDia(dia: string): string {
  return new Date(new Date(`${dia}T00:00:00Z`).getTime() + 864e5).toISOString().slice(0, 10);
}
