// P2: testar a análise da IA no mesmo dia. POST /api/ia/lotes/gerar e /api/ia/lotes/:id/analisar-agora sobre um
// PGlite com as migrações 001–005 reais: quem pode, o intervalo de dias, a marca de dia parcial no arquivo,
// a versão nova sem estragar a anterior, a chamada direta à API e o lote parcial que não barra o cron do dia seguinte.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../../server/app.ts";
import { SupabasePglite } from "./supabase-pglite.ts";
import { montarCenario, DIA, q, um } from "../banco/cenario-fase23.mjs";
import { criarUsuario, novoBanco, FASE6 } from "../banco/pg.mjs";

const SEGREDO_CRON = "segredo-do-cron-so-para-teste-0123456789";
const EXEMPLO = JSON.parse(readFileSync(new URL("../../ia/rotina/exemplos/analise-exemplo.json", import.meta.url), "utf8"));
const somar = (dia: string, n: number) => new Date(new Date(`${dia}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

// Anthropic falso para a chamada direta: guarda o que o servidor mandou e devolve o que o teste combinar.
class AnthropicDireto {
  chamadas: any[] = [];
  falha: Error | null = null;
  resposta: (params: any) => any = () => ({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "{}" }] });
  messages = {
    stream: (params: any) => {
      this.chamadas.push(params);
      return {
        finalMessage: async () => {
          if (this.falha) throw this.falha;
          return this.resposta(params);
        },
      };
    },
  };
}

let pg: any, falso: SupabasePglite, servidor: Server, servidorAmanha: Server, servidorSemChave: Server;
let base = "", baseAmanha = "", baseSemChave = "";
let ana: any, B: any, admin: any, membro: any;
const anthropic = new AnthropicDireto();

async function http(raiz: string, metodo: string, caminho: string, op: { token?: string; corpo?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (op.token) headers.authorization = `Bearer ${op.token}`;
  if (op.corpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(raiz + caminho, { method: metodo, headers, body: op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined });
  const t = await r.text();
  let json: any = null;
  try { json = JSON.parse(t); } catch { /* texto puro */ }
  return { status: r.status, json, texto: t };
}
const api = (metodo: string, caminho: string, op: { token?: string; corpo?: unknown } = {}) => http(base, metodo, caminho, op);
const P = () => ana.p as string;
const gerar = (token: string, corpo: Record<string, unknown> = {}, partnerId = P()) => api("POST", "/api/ia/lotes/gerar", { token, corpo: { partnerId, ...corpo } });
const arquivo = async (loteId: string) => {
  const l = await um(pg, `SELECT arquivo_path FROM public.ia_lotes WHERE id = $1`, [loteId]);
  return falso.arquivos.get(`conversas-ia/${l.arquivo_path}`)!;
};
const estado = (id: string) => um(pg, `SELECT status, versao, batch_id, tentativas, ultimo_erro FROM public.ia_lotes WHERE id = $1`, [id]);

function app(opcoes: Record<string, unknown>) {
  const a = criarApp({ supabase: falso as any, origens: ["https://app.teste"], segredoCron: SEGREDO_CRON, modeloIa: "claude-sonnet-5-5", ...opcoes });
  const s = a.listen(0, "127.0.0.1");
  return once(s, "listening").then(() => ({ s, url: `http://127.0.0.1:${(s.address() as AddressInfo).port}` }));
}

before(async () => {
  delete process.env.ANTHROPIC_API_KEY;
  pg = await novoBanco({ extras: FASE6 });
  ana = await montarCenario(pg);
  B = await criarUsuario(pg, { email: "b@x.com", empresa: "Studio B" });
  admin = await criarUsuario(pg, { email: "admin@x.com", admin: true });
  membro = await criarUsuario(pg, { email: "membro@x.com" });
  await pg.query(`INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes) VALUES ($1, $2, 'membro', ARRAY['robo','crm'])`, [P(), membro.profileId]);

  falso = new SupabasePglite(pg);
  falso.tokens.set("tok-a", { id: ana.emp.uid, email: "ana@mentoria.test" });
  falso.tokens.set("tok-b", { id: B.uid, email: "b@x.com" });
  falso.tokens.set("tok-admin", { id: admin.uid, email: "admin@x.com" });
  falso.tokens.set("tok-membro", { id: membro.uid, email: "membro@x.com" });

  // "Hoje" é o DIA do cenário (15:00 UTC = 11:00 em Cuiabá); o app de amanhã roda o cron depois das 04:30 do dia seguinte.
  const hoje = await app({ agora: () => new Date(`${DIA}T15:00:00Z`), anthropic });
  ({ s: servidor, url: base } = hoje);
  const amanha = await app({ agora: () => new Date(`${somar(DIA, 1)}T09:00:00Z`), anthropic });
  ({ s: servidorAmanha, url: baseAmanha } = amanha);
  const semChave = await app({ agora: () => new Date(`${DIA}T15:00:00Z`) });
  ({ s: servidorSemChave, url: baseSemChave } = semChave);
});
after(async () => {
  for (const s of [servidor, servidorAmanha, servidorSemChave]) await new Promise<void>((ok) => s.close(() => ok()));
});

describe("POST /api/ia/lotes/gerar: quem pode", () => {
  test("sem login 401; outra empresa 403; membro que não é o dono 403", async () => {
    assert.equal((await api("POST", "/api/ia/lotes/gerar", { corpo: { partnerId: P() } })).status, 401);
    const outra = await gerar("tok-b");
    assert.deepEqual([outra.status, outra.json.erro], [403, "sem_acesso"]);
    const m = await gerar("tok-membro");
    assert.deepEqual([m.status, m.json.erro], [403, "so_o_dono"]);
  });

  test("admin sem o opt-in do dono 403 sem_permissao_conteudo, e nenhum lote nasce", async () => {
    const r = await gerar("tok-admin");
    assert.deepEqual([r.status, r.json.erro], [403, "sem_permissao_conteudo"]);
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.ia_lotes WHERE partner_id = $1`, [P()])).n, 0);
  });

  test("partnerId ausente 400; inválido não passa", async () => {
    assert.equal((await api("POST", "/api/ia/lotes/gerar", { token: "tok-a", corpo: {} })).status, 400);
    assert.ok([400, 403].includes((await api("POST", "/api/ia/lotes/gerar", { token: "tok-a", corpo: { partnerId: "x" } })).status));
  });
});

describe("POST /api/ia/lotes/gerar: o dia", () => {
  test("8 dias atrás, amanhã e formato inválido -> 400; nada é gerado", async () => {
    for (const dia of [somar(DIA, -8), somar(DIA, 1), "2026-13-45", "ontem", 20261001]) {
      const r = await gerar("tok-a", { dia });
      assert.equal(r.status, 400, `${dia}: ${r.texto}`);
    }
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.ia_lotes WHERE partner_id = $1`, [P()])).n, 0);
  });

  test("7 dias atrás ainda vale e não é marcado como parcial", async () => {
    const r = await gerar("tok-a", { dia: somar(DIA, -7) });
    assert.equal(r.status, 200, r.texto);
    assert.ok(Array.isArray(r.json.lotes));
    for (const l of r.json.lotes) assert.ok(!(await arquivo(l.id)).includes("dia_parcial"));
  });

  test("padrão é hoje no fuso da empresa: lote pronto com a marca de dia parcial no cabeçalho", async () => {
    const r = await gerar("tok-a");
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.lotes.map((l: any) => [l.parte, l.status]), [[1, "pronto"]]);
    assert.deepEqual(Object.keys(r.json.lotes[0]).sort(), ["id", "parte", "status"]);
    const txt = await arquivo(r.json.lotes[0].id);
    const cab = txt.split("\n").filter((l) => l.startsWith("#@ "));
    assert.ok(cab.some((l) => l.startsWith("#@ dia_parcial: sim (gerado às 11:00")), cab.join("\n"));
    assert.ok(txt.includes(`#@ dia: ${DIA}`));
    // a contagem de linhas do cabeçalho continua batendo com o arquivo
    const declaradas = Number(/^#@ linhas: (\d+)$/m.exec(txt)![1]);
    assert.equal(declaradas, txt.replace(/\n$/, "").split("\n").length);
    assert.ok(!txt.includes("5565999990"), "o teste do dia também não leva telefone");
  });

  test("gerar de novo cria a versão seguinte e a anterior vira expirada (nada é apagado)", async () => {
    const antes = await q(pg, `SELECT id FROM public.ia_lotes WHERE partner_id = $1 AND dia = $2 AND status = 'pronto'`, [P(), DIA]);
    assert.equal(antes.length, 1);
    const r = await gerar("tok-a", { dia: DIA });
    assert.equal(r.status, 200, r.texto);
    const todos = await q(pg, `SELECT versao, status FROM public.ia_lotes WHERE partner_id = $1 AND dia = $2 ORDER BY versao`, [P(), DIA]);
    assert.deepEqual(todos.map((l: any) => [l.versao, l.status]), [[1, "expirado"], [2, "pronto"]]);
    assert.equal((await estado(antes[0].id)).status, "expirado");
  });
});

describe("POST /api/ia/lotes/:id/analisar-agora", () => {
  let loteId = "";
  const analisar = (token: string, id = loteId, raiz = base) => http(raiz, "POST", `/api/ia/lotes/${id}/analisar-agora`, { token, corpo: {} });
  const analiseDoLote = (id: string) => {
    const a = structuredClone(EXEMPLO);
    Object.assign(a, { lote_id: id, partner_id: P(), dia: DIA });
    a.engine = { tipo: "api_batch", modelo: "claude-sonnet-5-5" };
    return a;
  };

  before(async () => {
    loteId = (await um(pg, `SELECT id FROM public.ia_lotes WHERE partner_id = $1 AND dia = $2 AND status = 'pronto'`, [P(), DIA])).id;
  });

  test("quem não é da empresa vê 404; admin sem opt-in 403; membro 403; sem login 401", async () => {
    assert.equal((await http(base, "POST", `/api/ia/lotes/${loteId}/analisar-agora`)).status, 401);
    assert.equal((await analisar("tok-b")).status, 404);
    const a = await analisar("tok-admin");
    assert.deepEqual([a.status, a.json.erro], [403, "sem_permissao_conteudo"]);
    const m = await analisar("tok-membro");
    assert.deepEqual([m.status, m.json.erro], [403, "so_o_dono"]);
    assert.equal((await analisar("tok-a", "id-torto")).status, 400);
    assert.equal(anthropic.chamadas.length, 0, "nenhuma dessas chamou a API");
  });

  test("motor manual 409; api_batch sem consentimento 409", async () => {
    const manual = await analisar("tok-a");
    assert.deepEqual([manual.status, manual.json.erro], [409, "motor_nao_e_api_batch"]);
    await pg.query(`INSERT INTO public.ia_retroalimentacao_config (partner_id, motor) VALUES ($1, 'api_batch') ON CONFLICT (partner_id) DO UPDATE SET motor = 'api_batch'`, [P()]);
    const sem = await analisar("tok-a");
    assert.deepEqual([sem.status, sem.json.erro], [409, "consentimento_necessario"]);
    assert.equal(anthropic.chamadas.length, 0);
  });

  test("sem ANTHROPIC_API_KEY 503 com mensagem clara, e o lote continua pronto", async () => {
    await pg.query(`UPDATE public.ia_retroalimentacao_config SET consentimento_ia_em = now() WHERE partner_id = $1`, [P()]);
    const r = await analisar("tok-a", loteId, baseSemChave);
    assert.equal(r.status, 503, r.texto);
    assert.equal(r.json.erro, "ia_indisponivel");
    assert.match(r.json.mensagem, /ANTHROPIC_API_KEY/);
    const e = await estado(loteId);
    assert.deepEqual([e.status, e.tentativas], ["pronto", 0]);
  });

  test("falha da API devolve 502, registra a tentativa e o lote volta para a fila", async () => {
    anthropic.falha = new Error("API fora do ar");
    const r = await analisar("tok-a");
    assert.equal(r.status, 502, r.texto);
    assert.match(r.json.motivo, /API fora do ar/);
    const e = await estado(loteId);
    assert.deepEqual([e.status, e.tentativas], ["pronto", 1]);
    anthropic.falha = null;
  });

  test("JSON inválido do modelo: 502 json_invalido, lote de novo na fila", async () => {
    anthropic.resposta = () => ({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "não é json" }] });
    const r = await analisar("tok-a");
    assert.deepEqual([r.status, r.json.motivo], [502, "json_invalido"]);
    assert.equal((await estado(loteId)).status, "pronto");
  });

  test("sucesso: manda só este lote direto (sem Batch), aplica pelo aplicarResultado e conclui", async () => {
    anthropic.chamadas.length = 0;
    anthropic.resposta = () => ({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(analiseDoLote(loteId)) }] });
    const r = await analisar("tok-a");
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.json.ok, true);
    assert.equal(r.json.lote_id, loteId);
    assert.ok(r.json.resumo.analise_id);
    assert.equal(anthropic.chamadas.length, 1);
    const enviado = anthropic.chamadas[0];
    assert.equal(enviado.model, "claude-sonnet-5-5");
    const prompt = enviado.messages[0].content as string;
    assert.ok(prompt.includes(`lote_id: ${loteId}`) && prompt.includes("dia_parcial: sim"), "a IA recebe o aviso de dia parcial");
    assert.ok(!prompt.includes("5565999990"), "nem telefone");
    const e = await estado(loteId);
    assert.equal(e.status, "concluido");
    assert.match(e.batch_id, /^direto:/);
    const a = await um(pg, `SELECT engine_tipo, principal FROM public.ia_analises WHERE lote_id = $1`, [loteId]);
    assert.deepEqual([a.engine_tipo, a.principal.startsWith("batch:direto:")], ["api_batch", true]);
  });

  test("analisar de novo o mesmo lote 409 (não paga duas vezes); gerar o dia já concluído 409 e preserva o lote", async () => {
    anthropic.chamadas.length = 0;
    const de = await analisar("tok-a");
    assert.deepEqual([de.status, de.json.erro], [409, "lote_indisponivel"]);
    assert.equal(anthropic.chamadas.length, 0);
    const g = await gerar("tok-a", { dia: DIA });
    assert.deepEqual([g.status, g.json.erro], [409, "lote_em_andamento"]);
    assert.equal((await estado(loteId)).status, "concluido");
  });

  test("o ia-coletar do cron não mexe no lote do teste direto", async () => {
    const r = await http(base, "POST", "/api/cron/ia-coletar", { token: SEGREDO_CRON, corpo: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.falhas, 0, r.texto);
  });
});

describe("lote parcial não bloqueia o dia completo", () => {
  test("depois das 04:30 do dia seguinte o parcial vira expirado; parcial de gerado_em posterior ao dia fica", async () => {
    const parcial = await um(pg, `SELECT id FROM public.ia_lotes WHERE partner_id = $1 AND dia = $2 AND status = 'concluido'`, [P(), DIA]);
    // gerado durante o próprio dia (é assim que o teste de hoje nasce)
    await pg.query(`UPDATE public.ia_lotes SET gerado_em = $2::timestamptz WHERE id = $1`, [parcial.id, `${DIA}T18:00:00Z`]);
    // gerado no dia seguinte (lote do cron, completo): não é parcial
    const completo = await um(pg, `INSERT INTO public.ia_lotes (partner_id, dia, versao, parte, partes, fuso, motor, status, arquivo_path, arquivo_bytes, conversas_sha256, refs, metricas, marca_em, gerado_em)
      VALUES ($1, $2, 1, 1, 1, 'America/Cuiaba', 'manual', 'pronto', $3, 1, 'x', '{}', '{}', now(), $4::timestamptz) RETURNING id`,
      [P(), somar(DIA, -2), `${P()}/completo.txt`, `${somar(DIA, -1)}T08:00:00Z`]);

    // ainda no mesmo dia (app "hoje"): nada expira
    await http(base, "POST", "/api/cron/exportar", { token: SEGREDO_CRON, corpo: {} });
    assert.equal((await estado(parcial.id)).status, "concluido");

    const r = await http(baseAmanha, "POST", "/api/cron/exportar", { token: SEGREDO_CRON, corpo: {} });
    assert.equal(r.status, 200, r.texto);
    assert.equal((await estado(parcial.id)).status, "expirado");
    assert.equal((await estado(completo.id)).status, "pronto");
    // a análise do teste continua guardada
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.ia_analises WHERE lote_id = $1`, [parcial.id])).n, 1);
  });
});
