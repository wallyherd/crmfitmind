// Fase 1 no servidor: gateway com HMAC sobre o corpo cru (gateway/CONTRATO.md), conector do PC,
// fila e confirmação, campainha, rotas da tela Conectar e os arquivos COMPLETOS (.txt).
// As funções do banco rodam de verdade num PGlite com a 002 (testes/banco/pg.mjs); leitura e
// escrita simples de tabela passam pelo Supabase falso, com as linhas espelhadas do PGlite.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../../server/app.ts";
import { CAMINHO_ACORDAR, criarCampainha } from "../../server/campainha.ts";
import { CABECALHO_ARQUIVO, descreverMensagem, formatarQuando, inicioDoDia, montarArquivo } from "../../server/arquivo-completo.ts";
import { roboBloqueado } from "../../server/bot-engine.ts";
import { SupabaseFalso } from "./supabase-falso.ts";
import { novoBanco, FASE1, criarUsuario } from "../banco/pg.mjs";
import { waIdDaFila } from "../../gateway/mapear.mjs";

// Vetores do CONTRATO §1 (segredo de exemplo, nunca usado de verdade).
const SEGREDO = "exemplo-de-segredo-so-para-teste-0123456789";
const TS_VETOR = 1791000000000;
const CONEXAO_VETOR = "8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f";
const CORPO_VETOR = '{"conexaoId":"8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f","eventos":[{"tipo":"batimento","versao":"2.00.00"}]}';
const AGORA = new Date(TS_VETOR + 60_000);
const TEL = "556599990000";

const sha256hex = (b: string) => createHash("sha256").update(b).digest("hex");
const assinar = (ts: number | string, metodo: string, caminho: string, corpo = "", segredo = SEGREDO) =>
  createHmac("sha256", segredo).update(`${ts}.${metodo}.${caminho}.${sha256hex(corpo)}`).digest("hex");

// rpc() do supabase-js executado no PGlite, com argumentos nomeados como o PostgREST faz.
function rpcNoPglite(pg: any, nomes: string[]) {
  const json = (v: any): any =>
    v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(json)
      : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, json(x)])) : v;
  const rpcs: Record<string, (args: any) => Promise<any>> = {};
  for (const nome of nomes) {
    rpcs[nome] = async (args: Record<string, unknown>) => {
      const chaves = Object.keys(args);
      const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(", ");
      const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k]));
      try {
        const { rows: [f] } = await pg.query(`SELECT proretset FROM pg_proc WHERE proname = $1 LIMIT 1`, [nome]);
        if (f.proretset) return { data: json((await pg.query(`SELECT * FROM public.${nome}(${lista})`, valores)).rows), error: null };
        const { rows: [l] } = await pg.query(`SELECT public.${nome}(${lista}) AS r`, valores);
        return { data: json(l.r), error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    };
  }
  return rpcs;
}

let pg: any;
let falso: SupabaseFalso;
let servidor: Server;
let base = "";
let A: any, B: any;
let pcA: string, gwB: string;
const toques: { conexaoId: string; motivo: string; linha: any }[] = [];
let campainhaQuebrada = false;
const motorChamadas: any[] = [];

async function espelhar(...tabelas: string[]) {
  for (const t of tabelas) {
    const { rows } = await pg.query(`SELECT * FROM public.${t}`);
    falso.tabelas[t] = rows.map((r: any) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
  }
}

async function http(metodo: string, caminho: string, op: { corpo?: string; headers?: Record<string, string>; token?: string } = {}) {
  const headers: Record<string, string> = { ...(op.headers || {}) };
  if (op.token) headers.authorization = `Bearer ${op.token}`;
  if (op.corpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + caminho, { method: metodo, headers, body: op.corpo });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* texto */ }
  return { status: r.status, json, texto, headers: r.headers };
}

// Chamada do gateway, assinada como o nuvem.mjs assina (ou com a assinatura/ts pedidos).
function gateway(metodo: string, caminho: string, corpo?: string, op: { ts?: number; assinatura?: string; caminhoAssinado?: string; segredo?: string } = {}) {
  const ts = op.ts ?? AGORA.getTime();
  const assinatura = op.assinatura ?? assinar(ts, metodo, op.caminhoAssinado ?? caminho.split("?")[0], corpo ?? "", op.segredo);
  return http(metodo, caminho, { corpo, headers: { "x-gateway-ts": String(ts), "x-gateway-assinatura": assinatura } });
}

const pc = (metodo: string, caminho: string, corpo?: unknown, segredo = "segredo-do-pc-a") =>
  http(metodo, caminho, { corpo: corpo === undefined ? undefined : JSON.stringify(corpo), headers: { "x-bot-conexao": pcA, "x-bot-segredo": segredo } });

const eventos = (conexaoId: string, lista: unknown[]) => gateway("POST", "/api/bot/eventos", JSON.stringify({ conexaoId, eventos: lista }));

function mensagem(extra: Record<string, unknown> = {}) {
  return {
    tipo: "mensagem", waId: "3EB0C767D82A1E4F1B2C", chatJid: `${TEL}@s.whatsapp.net`, grupo: false, grupoNome: null,
    telefone: TEL, telefoneConfirmado: true, lid: "103843987759126@lid", nome: "João", deMim: false,
    participanteJid: null, participanteTelefone: null, participanteNome: null, tipoMidia: "texto", corpo: "Oi! Vi o anúncio",
    midia: null, citadoWaId: null, anuncio: null, origemEvento: "tempo_real", waEm: new Date().toISOString(), ...extra,
  };
}

before(async () => {
  pg = await novoBanco({ extras: FASE1 });
  A = await criarUsuario(pg, { email: "a@x.com", empresa: "Studio A" });
  B = await criarUsuario(pg, { email: "b@x.com", empresa: "Studio B" });
  await pg.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Cuiaba' WHERE partner_id = $1`, [A.partnerId]);
  await pg.query(
    `INSERT INTO public.bot_conexoes (id, escopo, owner_id, nome, modo, numero, status) VALUES ($1, 'parceiro', $2, 'Número do Studio', 'gateway', '5565988887777', 'conectado')`,
    [CONEXAO_VETOR, A.partnerId]);
  pcA = (await pg.query(`INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo, webhook_segredo) VALUES ('parceiro', $1, 'PC', 'pc', 'segredo-do-pc-a') RETURNING id`, [A.partnerId])).rows[0].id;
  gwB = (await pg.query(`INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('parceiro', $1, 'Número B', 'gateway') RETURNING id`, [B.partnerId])).rows[0].id;

  falso = new SupabaseFalso();
  await espelhar("profiles", "partners", "partner_members", "partner_acesso_config", "bot_conexoes", "bot_conversas");
  falso.tokens.set("tok-a", { id: A.uid, email: "a@x.com" });
  falso.tokens.set("tok-b", { id: B.uid, email: "b@x.com" });
  Object.assign(falso.rpcs, rpcNoPglite(pg, ["bot_registrar_eventos", "bot_reservar_fila", "bot_confirmar_envio", "bot_arquivo_completo"]));

  const app = criarApp({
    supabase: falso as any,
    agora: () => AGORA,
    origens: ["https://app.teste"],
    segredoGateway: SEGREDO,
    campainha: async (conexaoId, motivo) => {
      toques.push({ conexaoId, motivo, linha: { ...falso.tabela("bot_conexoes").find((c) => c.id === conexaoId) } });
      if (campainhaQuebrada) throw new Error("gateway fora do ar");
      return true;
    },
    motor: (async (_db: unknown, entrada: any) => {
      motorChamadas.push(entrada);
      return { acao: "teste", enfileiradas: 1 };
    }) as any,
  });
  servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => servidor.close(() => ok())));

describe("assinatura do gateway (HMAC sobre o corpo cru)", () => {
  test("vetor do CONTRATO: POST /api/bot/eventos com a assinatura exata passa e chega ao banco", async () => {
    const r = await gateway("POST", "/api/bot/eventos", CORPO_VETOR, {
      ts: TS_VETOR, assinatura: "9423923d6a794b5b175e21dcdb858054fafdbbde7a0c8fc87053df7a78675cd4",
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json, { ok: true, processados: 1, erros: [] });
    const { rows: [c] } = await pg.query(`SELECT versao, visto_em FROM public.bot_conexoes WHERE id = $1`, [CONEXAO_VETOR]);
    assert.equal(c.versao, "2.00.00");
    assert.ok(c.visto_em);
  });

  test("vetor do CONTRATO: GET /api/gateway/fila?limite=50 (a query não entra na assinatura)", async () => {
    const r = await gateway("GET", "/api/gateway/fila?limite=50", undefined, {
      ts: TS_VETOR, assinatura: "81a751499d7914d98bf8a32bedd305a4209e8e10dac0b00ec2fa8060e2c3d63c",
    });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json, { mensagens: [] });
  });

  test("assinatura inválida, vencida, do futuro, com corpo adulterado ou caminho sem /api -> 401", async () => {
    const corpo = JSON.stringify({ conexaoId: CONEXAO_VETOR, eventos: [{ tipo: "batimento", versao: "2.00.01" }] });
    const casos: [string, Promise<any>][] = [
      ["assinatura trocada", gateway("POST", "/api/bot/eventos", corpo, { assinatura: "0".repeat(64) })],
      ["outro segredo", gateway("POST", "/api/bot/eventos", corpo, { segredo: "outro-segredo-com-mais-de-32-caracteres-xx" })],
      ["vencida (5 min e 1 s)", gateway("POST", "/api/bot/eventos", corpo, { ts: AGORA.getTime() - 301_000 })],
      ["do futuro", gateway("POST", "/api/bot/eventos", corpo, { ts: AGORA.getTime() + 301_000 })],
      ["caminho sem /api", gateway("POST", "/api/bot/eventos", corpo, { caminhoAssinado: "/bot/eventos" })],
      ["ts em segundos", gateway("POST", "/api/bot/eventos", corpo, { ts: Math.floor(AGORA.getTime() / 1000) })],
    ];
    for (const [nome, p] of casos) assert.equal((await p).status, 401, nome);

    // corpo adulterado: assinado um, enviado outro (mesmo JSON com um espaço a mais)
    const ts = AGORA.getTime();
    const adulterado = await http("POST", "/api/bot/eventos", {
      corpo: corpo.replace('"eventos":', '"eventos": '),
      headers: { "x-gateway-ts": String(ts), "x-gateway-assinatura": assinar(ts, "POST", "/api/bot/eventos", corpo) },
    });
    assert.equal(adulterado.status, 401);
    const { rows: [c] } = await pg.query(`SELECT versao FROM public.bot_conexoes WHERE id = $1`, [CONEXAO_VETOR]);
    assert.equal(c.versao, "2.00.00", "nada recusado chegou ao banco");
  });

  test("vale o byte cru: JSON com espaços, assinado como foi enviado, passa", async () => {
    const cru = `{ "conexaoId" : "${CONEXAO_VETOR}",\n  "eventos": [ { "tipo": "batimento", "versao": "2.00.02" } ] }`;
    const r = await gateway("POST", "/api/bot/eventos", cru);
    assert.equal(r.status, 200, r.texto);
  });

  test("sem GATEWAY_SECRET (ou curto demais) nenhuma chamada do gateway passa", async () => {
    for (const segredo of [undefined, "curto"]) {
      const app = criarApp({ supabase: falso as any, agora: () => AGORA, segredoGateway: segredo ?? "" });
      const srv = app.listen(0, "127.0.0.1");
      await once(srv, "listening");
      const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
      const ts = AGORA.getTime();
      const r = await fetch(`${url}/api/gateway/conexoes`, {
        headers: { "x-gateway-ts": String(ts), "x-gateway-assinatura": assinar(ts, "GET", "/api/gateway/conexoes", "", segredo || "x") },
      });
      await new Promise<void>((ok) => srv.close(() => ok()));
      assert.equal(r.status, 401, String(segredo));
    }
  });

  test("cabeçalho do gateway não cai para o segredo do PC", async () => {
    const r = await http("GET", "/api/bot/fila", {
      headers: { "x-gateway-ts": String(AGORA.getTime()), "x-gateway-assinatura": "0".repeat(64), "x-bot-conexao": pcA, "x-bot-segredo": "segredo-do-pc-a" },
    });
    assert.equal(r.status, 401);
  });
});

describe("conector modo PC", () => {
  test("segredo errado, conexão de outro modo ou sem cabeçalho -> 401", async () => {
    assert.equal((await pc("POST", "/api/bot/eventos", { eventos: [] }, "segredo-errado")).status, 401);
    assert.equal((await pc("GET", "/api/bot/fila", undefined, "segredo-errado")).status, 401);
    const gw = falso.tabela("bot_conexoes").find((c) => c.id === CONEXAO_VETOR)!;
    const r = await http("POST", "/api/bot/eventos", {
      corpo: '{"eventos":[]}', headers: { "x-bot-conexao": CONEXAO_VETOR, "x-bot-segredo": gw.webhook_segredo },
    });
    assert.equal(r.status, 401, "conexão do gateway não aceita o segredo do PC");
    assert.equal((await http("GET", "/api/bot/fila", { token: "tok-a" })).status, 401);
  });

  test("eventos sem conexaoId no corpo (vem do cabeçalho); evento solto também vale", async () => {
    const lote = await pc("POST", "/api/bot/eventos", { eventos: [mensagem({ waId: "PC1" }), { tipo: "status", status: "conectado", numero: "5565911112222" }] });
    assert.deepEqual(lote.json, { ok: true, processados: 2, erros: [] });
    const solto = await pc("POST", "/api/bot/eventos", { tipo: "batimento", versao: "1.04.00" });
    assert.deepEqual(solto.json, { ok: true, processados: 1, erros: [] });
    const { rows: [c] } = await pg.query(`SELECT status, numero, versao FROM public.bot_conexoes WHERE id = $1`, [pcA]);
    assert.deepEqual(c, { status: "conectado", numero: "5565911112222", versao: "1.04.00" });
    assert.equal((await pc("GET", "/api/bot/atualizacao")).json.atualizacao, false, "atualização automática desligada");
  });
});

describe("POST /api/bot/eventos: envelope e travas da rota", () => {
  test("envelope inválido -> 4xx; evento ruim -> 200 com erro no índice", async () => {
    assert.equal((await gateway("POST", "/api/bot/eventos", JSON.stringify({ conexaoId: CONEXAO_VETOR, eventos: "x" }))).status, 400);
    assert.equal((await gateway("POST", "/api/bot/eventos", JSON.stringify({ eventos: [] }))).status, 400, "gateway sem conexaoId");
    assert.equal((await gateway("POST", "/api/bot/eventos", "[]")).status, 400);
    assert.equal((await eventos("00000000-0000-4000-8000-000000000000", [])).status, 404);
    assert.equal((await eventos(pcA, [])).status, 403, "conexão do PC não recebe pelo gateway");
    const muitos = Array.from({ length: 501 }, () => ({ tipo: "batimento", versao: "2.00.00" }));
    assert.equal((await eventos(CONEXAO_VETOR, muitos)).status, 413);

    const r = await eventos(CONEXAO_VETOR, [{ tipo: "batimento", versao: "2.00.00" }, { tipo: "inventado" }]);
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.processados, r.json.erros.map((e: any) => e.indice)], [1, [1]]);
  });

  test("conexão apagada: 200 com todos recusados (o gateway tira do spool), nada gravado", async () => {
    const linha = falso.tabela("bot_conexoes").find((c) => c.id === gwB)!;
    linha.arquivado_em = AGORA.toISOString();
    try {
      const r = await eventos(gwB, [mensagem({ waId: "ARQ1" }), { tipo: "batimento", versao: "2.00.00" }]);
      assert.deepEqual(r.json, { ok: true, processados: 0, erros: [{ indice: 0, erro: "conexao_arquivada" }, { indice: 1, erro: "conexao_arquivada" }] });
    } finally {
      linha.arquivado_em = null;
    }
  });

  test("robô: só tempo real, individual e do cliente, com robô ligado; enfileirou -> campainha 'fila'", async () => {
    await pg.query(`UPDATE public.bot_conexoes SET bot_ativo = true WHERE id = $1`, [CONEXAO_VETOR]);
    const linha = falso.tabela("bot_conexoes").find((c) => c.id === CONEXAO_VETOR)!;
    linha.bot_ativo = true;
    motorChamadas.length = 0;
    toques.length = 0;
    try {
      const r = await eventos(CONEXAO_VETOR, [
        mensagem({ waId: "BOT1", chatJid: "556511110001@s.whatsapp.net", telefone: "556511110001", lid: null }),
        mensagem({ waId: "BOT2", chatJid: "556511110002@s.whatsapp.net", telefone: "556511110002", lid: null, origemEvento: "offline" }),
        mensagem({ waId: "BOT3", chatJid: "556511110003@s.whatsapp.net", telefone: "556511110003", lid: null, deMim: true, nome: null }),
      ]);
      assert.deepEqual(r.json.erros, []);
      assert.equal(motorChamadas.length, 1);
      assert.equal(motorChamadas[0].telefone, "556511110001");
      assert.equal(motorChamadas[0].texto, "Oi! Vi o anúncio");
      assert.deepEqual(toques.map((t) => [t.conexaoId, t.motivo]), [[CONEXAO_VETOR, "fila"]]);

      // trava da rota: a conexão desligada no servidor segura o robô mesmo que o banco diga "responder"
      linha.bot_ativo = false;
      motorChamadas.length = 0;
      await eventos(CONEXAO_VETOR, [mensagem({ waId: "BOT4", chatJid: "556511110004@s.whatsapp.net", telefone: "556511110004", lid: null })]);
      assert.equal(motorChamadas.length, 0);
    } finally {
      linha.bot_ativo = false;
      await pg.query(`UPDATE public.bot_conexoes SET bot_ativo = false WHERE id = $1`, [CONEXAO_VETOR]);
    }
  });

  test("trava 2 do motor (bot-engine): grupo, privacidade, robô desligado e resposta humana recente", () => {
    const agora = Date.parse("2026-10-05T12:00:00Z");
    const conversa = { id: "x", estado: "bot", fluxo_id: null, passo_atual_id: null, tentativas_passo: 0, tipo: "individual", privacidade: "normal", ultima_saida_em: null };
    assert.equal(roboBloqueado(conversa, true, agora), null);
    assert.equal(roboBloqueado(conversa, false, agora), "robo_desligado");
    assert.equal(roboBloqueado(conversa, undefined, agora), "robo_desligado");
    assert.equal(roboBloqueado({ ...conversa, tipo: "grupo" }, true, agora), "grupo");
    assert.equal(roboBloqueado({ ...conversa, privacidade: "so_metadados" }, true, agora), "privacidade");
    assert.equal(roboBloqueado({ ...conversa, ultima_saida_em: "2026-10-05T11:45:00Z" }, true, agora), "humano_recente");
    assert.equal(roboBloqueado({ ...conversa, ultima_saida_em: "2026-10-05T11:00:00Z" }, true, agora), null);
  });
});

describe("fila do gateway e confirmação", () => {
  test("reserva, não reentrega no poll seguinte, confirma de forma idempotente", async () => {
    await pg.query(`UPDATE public.bot_conexoes SET bot_ativo = true WHERE id = $1`, [CONEXAO_VETOR]);
    try {
      await eventos(CONEXAO_VETOR, [mensagem({ waId: "FILA0", chatJid: "556522223333@s.whatsapp.net", telefone: "556522223333", lid: null })]);
      const { rows: [cv] } = await pg.query(`SELECT id FROM public.bot_conversas WHERE conexao_id = $1 AND telefone = '556522223333'`, [CONEXAO_VETOR]);
      const { rows: [m] } = await pg.query(
        `INSERT INTO public.bot_mensagens (conversa_id, direcao, corpo, status, enviada_por) VALUES ($1, 'saida', 'Seguem os horários', 'pendente', $2) RETURNING id`,
        [cv.id, A.profileId]);

      const r1 = await gateway("GET", "/api/gateway/fila?limite=50");
      assert.deepEqual(r1.json.mensagens, [{ id: m.id, conexaoId: CONEXAO_VETOR, para: "556522223333@s.whatsapp.net", corpo: "Seguem os horários", tipo: "texto" }]);
      assert.deepEqual((await gateway("GET", "/api/gateway/fila?limite=50")).json.mensagens, [], "reservada não volta");
      assert.equal((await pc("GET", "/api/bot/fila")).json.mensagens.length, 0, "o PC não vê a fila do gateway");

      const confirmar = (dados: unknown) => gateway("POST", "/api/bot/confirmar", JSON.stringify(dados));
      assert.equal((await confirmar({ id: m.id, status: "talvez" })).status, 400);
      assert.equal((await confirmar({ id: "nao-e-uuid", status: "enviada" })).status, 400);
      assert.deepEqual((await confirmar({ id: m.id, status: "enviada", waId: waIdDaFila(m.id) })).json, { ok: true });
      assert.deepEqual((await confirmar({ id: m.id, status: "enviada", waId: waIdDaFila(m.id) })).json, { ok: true, jaConfirmada: true });
      assert.equal((await confirmar({ id: "00000000-0000-4000-8000-000000000000", status: "enviada" })).status, 404);
      // o PC não confirma mensagem do gateway
      assert.equal((await pc("POST", "/api/bot/confirmar", { id: m.id, status: "erro", erro: "x" })).status, 404);

      const { rows: [final] } = await pg.query(`SELECT status, autor, wa_id, tentativas FROM public.bot_mensagens WHERE id = $1`, [m.id]);
      assert.deepEqual(final, { status: "enviada", autor: "crm", wa_id: waIdDaFila(m.id), tentativas: 1 });

      // o eco do envio, se escapar do filtro do gateway, não vira 'humano'
      const eco = await eventos(CONEXAO_VETOR, [mensagem({ waId: waIdDaFila(m.id), chatJid: "556522223333@s.whatsapp.net", telefone: "556522223333", lid: null, deMim: true, nome: null, corpo: "Seguem os horários" })]);
      assert.deepEqual(eco.json.erros, []);
      const { rows: [n] } = await pg.query(`SELECT count(*)::int AS n FROM public.bot_mensagens WHERE conversa_id = $1 AND autor = 'humano'`, [cv.id]);
      assert.equal(n.n, 0);
    } finally {
      await pg.query(`UPDATE public.bot_conexoes SET bot_ativo = false WHERE id = $1`, [CONEXAO_VETOR]);
    }
  });
});

describe("tela Conectar WhatsApp", () => {
  test("GET /api/conexoes: só da empresa pedida, sem segredo, no formato do contrato", async () => {
    const r = await http("GET", `/api/conexoes?partnerId=${A.partnerId}`, { token: "tok-a" });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.map((c: any) => c.id).sort(), [CONEXAO_VETOR, pcA].sort());
    const gw = r.json.find((c: any) => c.id === CONEXAO_VETOR);
    assert.deepEqual(Object.keys(gw).sort(), ["grupos_disponiveis", "id", "modo", "nome", "numero", "opcoes", "pareamento", "status", "status_detalhe", "visto_em"]);
    assert.equal(gw.modo, "gateway");
    assert.deepEqual(gw.opcoes, { gruposPermitidos: [], historicoDias: 7, botAtivo: false });
    assert.ok(!r.texto.includes("segredo-do-pc-a") && !r.texto.includes("webhook_segredo"));
    assert.equal((await http("GET", `/api/conexoes?partnerId=${B.partnerId}`, { token: "tok-a" })).status, 403);
    assert.equal((await http("GET", "/api/conexoes", { token: "tok-a" })).status, 400);
  });

  test("nova conexão nasce no modo gateway, desconectada e com o robô desligado", async () => {
    const r = await http("POST", "/api/conexoes", { token: "tok-a", corpo: JSON.stringify({ partnerId: A.partnerId, nome: "Celular da recepção" }) });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.json.modo, "gateway");
    assert.equal(r.json.opcoes.botAtivo, false);
    const linha = falso.tabela("bot_conexoes").find((c) => c.id === r.json.id)!;
    assert.deepEqual([linha.owner_id, linha.escopo, linha.status, linha.bot_ativo], [A.partnerId, "parceiro", "desconectado", false]);
    assert.equal((await http("POST", "/api/conexoes", { token: "tok-a", corpo: JSON.stringify({ partnerId: B.partnerId, nome: "x" }) })).status, 403);
    assert.equal((await http("POST", "/api/conexoes", { token: "tok-a", corpo: JSON.stringify({ partnerId: A.partnerId, nome: "" }) })).status, 400);
  });

  test("parear grava o pedido e toca a campainha; o gateway vê o pedido na lista", async () => {
    toques.length = 0;
    const ruim = await http("POST", `/api/conexoes/${CONEXAO_VETOR}/parear`, { token: "tok-a", corpo: JSON.stringify({ metodo: "codigo", telefone: "123" }) });
    assert.equal(ruim.status, 400);
    assert.equal((await http("POST", `/api/conexoes/${pcA}/parear`, { token: "tok-a", corpo: JSON.stringify({ metodo: "qr" }) })).status, 400);
    assert.equal((await http("POST", `/api/conexoes/${gwB}/parear`, { token: "tok-a", corpo: JSON.stringify({ metodo: "qr" }) })).status, 403);

    const r = await http("POST", `/api/conexoes/${CONEXAO_VETOR}/parear`, { token: "tok-a", corpo: JSON.stringify({ metodo: "codigo", telefone: "(65) 98888-7777" }) });
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(r.json.pareamento, { estado: "solicitado", atualizadoEm: AGORA.toISOString() });
    assert.deepEqual(toques.map((t) => t.motivo), ["parear"]);

    const lista = await gateway("GET", "/api/gateway/conexoes");
    const item = lista.json.conexoes.find((c: any) => c.id === CONEXAO_VETOR);
    assert.deepEqual(item, {
      id: CONEXAO_VETOR, deveRodar: true,
      pareamento: { metodo: "codigo", telefone: "5565988887777", solicitadoEm: AGORA.toISOString() },
      opcoes: { gruposPermitidos: [], historicoDias: 7, botAtivo: false },
    });
    assert.ok(!lista.json.conexoes.some((c: any) => c.id === pcA), "conexão do PC não vai para o gateway");
  });

  test("opções: validação, robô ligado e campainha que falha não derruba a rota", async () => {
    const patch = (corpo: unknown) => http("PATCH", `/api/conexoes/${CONEXAO_VETOR}/opcoes`, { token: "tok-a", corpo: JSON.stringify(corpo) });
    assert.equal((await patch({ gruposPermitidos: ["556599990000@s.whatsapp.net"] })).status, 400);
    assert.equal((await patch({ historicoDias: 31 })).status, 400);
    assert.equal((await patch({ botAtivo: "sim" })).status, 400);
    campainhaQuebrada = true;
    toques.length = 0;
    try {
      const r = await patch({ gruposPermitidos: ["120363000000000001@g.us"], historicoDias: 0, botAtivo: true });
      assert.equal(r.status, 200, r.texto);
      assert.deepEqual(r.json.opcoes, { gruposPermitidos: ["120363000000000001@g.us"], historicoDias: 0, botAtivo: true });
      assert.deepEqual(toques.map((t) => t.motivo), ["opcoes"]);
    } finally {
      campainhaQuebrada = false;
    }
    const lista = await gateway("GET", "/api/gateway/conexoes");
    assert.deepEqual(lista.json.conexoes.find((c: any) => c.id === CONEXAO_VETOR).opcoes,
      { gruposPermitidos: ["120363000000000001@g.us"], historicoDias: 0, botAtivo: true });
    await patch({ botAtivo: false });
  });

  test("desconectar grava deveRodar:false ANTES de tocar a campainha", async () => {
    toques.length = 0;
    const r = await http("POST", `/api/conexoes/${CONEXAO_VETOR}/desconectar`, { token: "tok-a", corpo: "{}" });
    assert.equal(r.status, 200, r.texto);
    assert.equal(toques.length, 1);
    assert.equal(toques[0].motivo, "desconectar");
    assert.ok(toques[0].linha.desconectada_em, "quando a campainha tocou, o pedido já estava gravado");
    const item = (await gateway("GET", "/api/gateway/conexoes")).json.conexoes.find((c: any) => c.id === CONEXAO_VETOR);
    assert.deepEqual([item.deveRodar, item.desconectar, item.pareamento], [false, true, null]);

    // parear de novo volta a rodar
    await http("POST", `/api/conexoes/${CONEXAO_VETOR}/parear`, { token: "tok-a", corpo: JSON.stringify({ metodo: "qr" }) });
    const de_novo = (await gateway("GET", "/api/gateway/conexoes")).json.conexoes.find((c: any) => c.id === CONEXAO_VETOR);
    assert.deepEqual([de_novo.deveRodar, "desconectar" in de_novo, de_novo.pareamento.metodo], [true, false, "qr"]);
  });

  test("enviar pelo CRM: robô desligado -> 409; no gateway só para quem já escreveu", async () => {
    const enviar = (telefone: string) => http("POST", "/api/bot/disparos/enviar-direta", {
      token: "tok-a", corpo: JSON.stringify({ conexaoId: CONEXAO_VETOR, telefone, texto: "Oi!" }),
    });
    const linha = falso.tabela("bot_conexoes").find((c) => c.id === CONEXAO_VETOR)!;
    linha.bot_ativo = false;
    assert.deepEqual([(await enviar("5565900001111")).status, (await enviar("5565900001111")).json.erro], [409, "envio_desligado"]);
    linha.bot_ativo = true;
    try {
      const fria = await enviar("5565900001111");
      assert.deepEqual([fria.status, fria.json.erro], [409, "contato_nunca_escreveu"]);
    } finally {
      linha.bot_ativo = false;
    }
  });
});

describe("conversa: privacidade e estado", () => {
  let conversaGrupo: string, conversaA: string, conversaB: string;
  before(async () => {
    const G = "120363000000000009@g.us";
    await pg.query(`UPDATE public.bot_conexoes SET opcoes = jsonb_build_object('gruposPermitidos', jsonb_build_array($2::text), 'historicoDias', 7) WHERE id = $1`, [CONEXAO_VETOR, G]);
    await eventos(CONEXAO_VETOR, [
      mensagem({ waId: "CV1", chatJid: G, grupo: true, grupoNome: "Turma", telefone: null, lid: null, nome: null, participanteNome: "Ana" }),
      mensagem({ waId: "CV2", chatJid: "556533334444@s.whatsapp.net", telefone: "556533334444", lid: null }),
    ]);
    await eventos(gwB, [mensagem({ waId: "CVB", chatJid: "556544445555@s.whatsapp.net", telefone: "556544445555", lid: null })]);
    await espelhar("bot_conversas");
    const cs = falso.tabela("bot_conversas");
    conversaGrupo = cs.find((c) => c.jid === G)!.id;
    conversaA = cs.find((c) => c.telefone === "556533334444")!.id;
    conversaB = cs.find((c) => c.telefone === "556544445555")!.id;
  });

  test("PATCH valida, respeita a empresa e não liga robô em grupo", async () => {
    const patch = (id: string, corpo: unknown, token = "tok-a") => http("PATCH", `/api/conversas/${id}`, { token, corpo: JSON.stringify(corpo) });
    assert.equal((await patch(conversaA, { privacidade: "secreta" })).status, 400);
    assert.equal((await patch(conversaA, {})).status, 400);
    assert.equal((await patch(conversaB, { privacidade: "ignorar" })).status, 403);
    assert.equal((await patch(conversaGrupo, { estado: "bot" })).status, 400);
    const ok = await patch(conversaA, { privacidade: "so_metadados", estado: "encerrada" });
    assert.equal(ok.status, 200, ok.texto);
    assert.deepEqual([ok.json.conversa.privacidade, ok.json.conversa.estado, ok.json.conversa.encerrada_em], ["so_metadados", "encerrada", AGORA.toISOString()]);
  });
});

describe("arquivo COMPLETO (.txt) para o dono", () => {
  let conversaJoao: string, conversaB: string;
  before(async () => {
    await eventos(CONEXAO_VETOR, [
      mensagem({ waId: "TXT1", waEm: "2026-10-06T02:30:00.000Z", corpo: "Oi! Vi o anúncio do plano",
        anuncio: { titulo: "Plano trimestral", sourceUrl: "https://fb.me/abc", entryPointConversionApp: "instagram" } }),
      mensagem({ waId: "TXT2", waEm: "2026-10-06T02:31:00.000Z", deMim: true, nome: null, corpo: "Oi João!\nTemos horário amanhã." }),
      mensagem({ waId: "TXT3", waEm: "2026-10-06T02:35:00.000Z", tipoMidia: "audio", corpo: null, midia: { duracaoSeg: 42, ptt: true } }),
      mensagem({ waId: "TXT4", waEm: "2026-10-06T04:30:00.000Z", corpo: "isto já é dia 06 em Cuiabá" }),
    ]);
    await eventos(gwB, [mensagem({ waId: "TXTB", waEm: "2026-10-06T02:30:00.000Z", corpo: "mensagem da empresa B" })]);
    await espelhar("bot_conversas");
    conversaJoao = falso.tabela("bot_conversas").find((c) => c.conexao_id === CONEXAO_VETOR && c.telefone === TEL)!.id;
    conversaB = falso.tabela("bot_conversas").find((c) => c.conexao_id === gwB && c.telefone === TEL)!.id;
  });

  test("sem token -> 401; outra empresa -> 403; dia inválido -> 400", async () => {
    assert.equal((await http("GET", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-10-05`)).status, 401);
    assert.equal((await http("GET", `/api/conversas/${conversaJoao}/completa.txt`)).status, 401);
    assert.equal((await http("GET", `/api/conversas/dia-completo.txt?partnerId=${B.partnerId}&dia=2026-10-05`, { token: "tok-a" })).status, 403);
    assert.equal((await http("GET", `/api/conversas/${conversaB}/completa.txt`, { token: "tok-a" })).status, 403);
    assert.equal((await http("GET", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-02-30`, { token: "tok-a" })).status, 400);
    assert.equal((await http("GET", `/api/conversas/${conversaJoao}/completa.txt?de=2026-10-06&ate=2026-10-01`, { token: "tok-a" })).status, 400);
  });

  test("dia completo no fuso America/Cuiaba: 02:30Z do dia 06 aparece em 05/10 22:30", async () => {
    const r = await http("GET", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-10-05`, { token: "tok-a" });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(r.headers.get("content-disposition") || "", /^attachment; filename="conversas-completas-2026-10-05\.txt"/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const linhas = r.texto.split("\n");
    assert.equal(linhas[0], CABECALHO_ARQUIVO);
    assert.ok(linhas.includes("Dia: 05/10/2026 (horário de America/Cuiaba)"));
    assert.ok(linhas.includes("Nome no WhatsApp: João"));
    assert.ok(linhas.includes("Telefone: +55 65 9999-0000"));
    assert.ok(linhas.includes(`WhatsApp: https://wa.me/${TEL}`));
    assert.ok(linhas.includes('Origem: anúncio (clique para o WhatsApp) — "Plano trimestral" — https://fb.me/abc — via instagram'));
    assert.ok(linhas.includes("05/10 22:30 João: Oi! Vi o anúncio do plano"));
    assert.ok(linhas.includes("05/10 22:31 Você: Oi João!"));
    assert.ok(linhas.includes("    Temos horário amanhã."));
    assert.ok(linhas.includes("05/10 22:35 João: [áudio 0:42]"));
    assert.ok(!r.texto.includes("isto já é dia 06"), "00:30 do dia 06 em Cuiabá fica para o arquivo do dia 06");
    assert.ok(!r.texto.includes("empresa B"));

    const chamada = falso.chamadas.filter((x) => x.tipo === "rpc:bot_arquivo_completo").pop()!;
    assert.deepEqual(chamada.args, { _partner_id: A.partnerId, _conversa_id: null, _de: "2026-10-05T04:00:00.000Z", _ate: "2026-10-06T04:00:00.000Z" });

    const dia6 = await http("GET", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-10-06`, { token: "tok-a" });
    assert.ok(dia6.texto.includes("06/10 00:30 João: isto já é dia 06 em Cuiabá"));
  });

  test("conversa completa, com e sem período", async () => {
    const tudo = await http("GET", `/api/conversas/${conversaJoao}/completa.txt`, { token: "tok-a" });
    assert.equal(tudo.status, 200, tudo.texto);
    assert.match(tudo.headers.get("content-disposition") || "", new RegExp(`filename="conversa-completa-${TEL}\\.txt"`));
    assert.ok(tudo.texto.startsWith(CABECALHO_ARQUIVO));
    assert.ok(tudo.texto.includes("Período: a conversa inteira"));
    assert.ok(tudo.texto.includes("05/10 22:30 João: Oi! Vi o anúncio do plano"));
    assert.ok(tudo.texto.includes("06/10 00:30 João: isto já é dia 06 em Cuiabá"));

    const so6 = await http("GET", `/api/conversas/${conversaJoao}/completa.txt?de=2026-10-06&ate=2026-10-06`, { token: "tok-a" });
    assert.ok(so6.texto.includes("Período: 06/10/2026 a 06/10/2026"));
    assert.ok(so6.texto.includes("06/10 00:30 João"));
    assert.ok(!so6.texto.includes("22:30"));
  });
});

describe("campainha e formato (unidades)", () => {
  test("campainha assina como o CONTRATO §6 e tem timeout curto; sem URL não toca", async () => {
    const pedidos: any[] = [];
    const tocar = criarCampainha({
      url: () => "https://gw.exemplo.com.br/qualquer/caminho",
      segredo: () => SEGREDO,
      agora: () => TS_VETOR,
      fetch: (async (url: any, init: any) => { pedidos.push({ url: String(url), init }); return new Response('{"ok":true}', { status: 202 }); }) as any,
    });
    assert.equal(await tocar(CONEXAO_VETOR, "fila"), true);
    assert.equal(pedidos[0].url, `https://gw.exemplo.com.br${CAMINHO_ACORDAR}`);
    assert.equal(pedidos[0].init.body, '{"conexaoId":"8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f","motivo":"fila"}');
    assert.equal(pedidos[0].init.headers["x-gateway-ts"], String(TS_VETOR));
    assert.equal(pedidos[0].init.headers["x-gateway-assinatura"], "4fdb4cd5b421cdd4887de940e063f3d8bb51e20c1fec18c4e068c82bc43c24fd");

    const lenta = criarCampainha({
      url: () => "https://gw.exemplo.com.br", segredo: () => SEGREDO, timeoutMs: 50, log: () => {},
      fetch: ((_u: any, init: any) => new Promise((_ok, falha) => init.signal.addEventListener("abort", () => falha(Object.assign(new Error("abortado"), { name: "AbortError" }))))) as any,
    });
    const inicio = Date.now();
    assert.equal(await lenta(CONEXAO_VETOR, "parear"), false);
    assert.ok(Date.now() - inicio < 1000);

    let chamou = false;
    const semUrl = criarCampainha({ url: () => "", segredo: () => SEGREDO, fetch: (async () => { chamou = true; }) as any });
    assert.equal(await semUrl(CONEXAO_VETOR, "fila"), false);
    const semSegredo = criarCampainha({ url: () => "https://gw.exemplo.com.br", segredo: () => undefined, fetch: (async () => { chamou = true; }) as any });
    assert.equal(await semSegredo(CONEXAO_VETOR, "fila"), false);
    assert.equal(chamou, false);
  });

  test("fuso, mídia e montagem do arquivo", () => {
    assert.equal(inicioDoDia("2026-10-05", "America/Cuiaba").toISOString(), "2026-10-05T04:00:00.000Z");
    assert.equal(inicioDoDia("2026-10-05", "America/Sao_Paulo").toISOString(), "2026-10-05T03:00:00.000Z");
    assert.equal(formatarQuando("2026-10-06T02:30:00Z", "America/Cuiaba"), "05/10 22:30");
    assert.equal(descreverMensagem({ tipo: "audio", corpo: null, midia: { duracaoSeg: 42, ptt: true } }), "[áudio 0:42]");
    assert.equal(descreverMensagem({ tipo: "imagem", corpo: "legenda", midia: null }), "[imagem: legenda]");
    assert.equal(descreverMensagem({ tipo: "documento", corpo: null, midia: { nomeArquivo: "proposta.pdf" } }), "[documento proposta.pdf]");
    assert.equal(descreverMensagem({ tipo: "outro", corpo: null, midia: { visualizacaoUnica: true } }), "[visualização única, conteúdo não veio]");
    assert.equal(descreverMensagem({ tipo: "texto", corpo: null, midia: null }, true), "[texto não registrado]");

    const txt = montarArquivo({
      dados: {
        conversas: [
          { id: "c1", tipo: "individual", telefone: null, lid: "103843987759126@lid", nome: null, privacidade: "normal" },
          { id: "c2", tipo: "grupo", grupo_nome: "Turma 3", privacidade: "normal" },
        ],
        mensagens: [
          { conversa_id: "c1", momento: "2026-10-05T15:00:00Z", direcao: "entrada", autor: "cliente", tipo: "texto", corpo: "oi", editada_em: "x" },
          { conversa_id: "c2", momento: "2026-10-05T16:00:00Z", direcao: "entrada", autor: "cliente", tipo: "texto", corpo: "bom dia", participante_telefone: "556577776666" },
          { conversa_id: "c2", momento: "2026-10-05T16:01:00Z", direcao: "saida", autor: "bot", tipo: "texto", corpo: "x", apagada_em: "y" },
        ],
        cortado: true,
      },
      fuso: "America/Cuiaba",
      agora: new Date("2026-10-06T12:00:00Z"),
      periodo: "Dia: 05/10/2026",
    });
    assert.ok(txt.includes("Telefone: ainda não revelado pelo WhatsApp (contato só pelo LID 103843987759126@lid)"));
    assert.ok(txt.includes("05/10 11:00 Cliente: oi (editada)"));
    assert.ok(txt.includes("Grupo: Turma 3"));
    assert.ok(txt.includes("05/10 12:00 +55 65 7777-6666: bom dia"));
    assert.ok(txt.includes("05/10 12:01 Robô: x (apagada para todos)"));
    assert.ok(txt.includes("ATENÇÃO: arquivo cortado"));
  });
});

describe("achados da revisão da Fase 1 (servidor)", () => {
  const post = (token: string, caminho: string, corpo: unknown) => http("POST", caminho, { token, corpo: JSON.stringify(corpo) });

  test("assinatura do gateway repetida é recusada; outra requisição passa", async () => {
    const original = falso.rpcs.bot_gateway_assinatura_nova;
    // a janela de validade usa o relógio do teste (2026-10-03); aqui o banco guarda por 10 min de verdade
    falso.rpcs.bot_gateway_assinatura_nova = async ({ _assinatura }: any) => {
      const { rows: [r] } = await pg.query(`SELECT public.bot_gateway_assinatura_nova($1, now() + interval '10 minutes') AS r`, [_assinatura]);
      return { data: r.r, error: null };
    };
    try {
      const ts = AGORA.getTime() + 1234;
      assert.equal((await gateway("GET", "/api/gateway/conexoes", undefined, { ts })).status, 200);
      assert.equal((await gateway("GET", "/api/gateway/conexoes", undefined, { ts })).status, 401, "a mesma requisição assinada não vale duas vezes");
      assert.equal((await gateway("GET", "/api/gateway/conexoes", undefined, { ts: ts + 1 })).status, 200);
    } finally {
      falso.rpcs.bot_gateway_assinatura_nova = original;
    }
  });

  test("lote do gateway tem tamanho fixo: a query não entra na assinatura, então não manda no limite", async () => {
    falso.chamadas.length = 0;
    await gateway("GET", "/api/gateway/fila?limite=1");
    const chamada = falso.chamadas.filter((x) => x.tipo === "rpc:bot_reservar_fila").pop()!;
    assert.equal(chamada.args._limite, 50);
  });

  test("gateway só lista conexão de empresa (escopo parceiro)", async () => {
    const coach = (await pg.query(
      `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo, bot_ativo) VALUES ('coach', $1, 'Do coach', 'gateway', true) RETURNING id`,
      [A.profileId])).rows[0].id;
    await espelhar("bot_conexoes");
    const lista = await gateway("GET", "/api/gateway/conexoes", undefined, { ts: AGORA.getTime() + 2000 });
    assert.ok(!lista.json.conexoes.some((c: any) => c.id === coach));
    assert.ok(lista.json.conexoes.some((c: any) => c.id === CONEXAO_VETOR));
  });

  test("conector antigo do PC (evento sem chatJid) é gravado como offline e não aciona o robô", async () => {
    motorChamadas.length = 0;
    await pg.query(`UPDATE public.bot_conexoes SET bot_ativo = true WHERE id = $1`, [pcA]);
    try {
      const antigo = { tipo: "mensagem", telefone: "556577778888", nome: "Maria", corpo: "oi", tipoMidia: "texto", waId: "OLD1", em: new Date().toISOString() };
      const r = await pc("POST", "/api/bot/eventos", antigo);
      assert.deepEqual(r.json, { ok: true, processados: 1, erros: [] });
      const { rows: [m] } = await pg.query(
        `SELECT m.origem_evento, m.corpo, c.telefone, c.estado FROM public.bot_mensagens m JOIN public.bot_conversas c ON c.id = m.conversa_id WHERE m.wa_id = 'OLD1'`);
      assert.deepEqual(m, { origem_evento: "offline", corpo: "oi", telefone: "556577778888", estado: "humano" });
      assert.deepEqual(motorChamadas, []);
    } finally {
      await pg.query(`UPDATE public.bot_conexoes SET bot_ativo = false WHERE id = $1`, [pcA]);
    }
  });

  test("pareamento por código: '+' do número estrangeiro chega inteiro; sem '+' segue a regra do Brasil", async () => {
    const parear = (telefone: string) => post("tok-a", `/api/conexoes/${CONEXAO_VETOR}/parear`, { metodo: "codigo", telefone });
    assert.equal((await parear("+1 415 555 1234")).status, 200);
    assert.equal(falso.tabela("bot_conexoes").find((c) => c.id === CONEXAO_VETOR)!.pareamento.telefone, "14155551234");
    assert.equal((await parear("+352 621 123 456")).status, 200);
    assert.equal(falso.tabela("bot_conexoes").find((c) => c.id === CONEXAO_VETOR)!.pareamento.telefone, "352621123456");
    assert.equal((await parear("+1234567")).status, 400, "menos de 8 dígitos");
    assert.equal((await parear("(65) 98888-7777")).status, 200);
    assert.equal(falso.tabela("bot_conexoes").find((c) => c.id === CONEXAO_VETOR)!.pareamento.telefone, "5565988887777");
  });

  test("cota por empresa, conexão do PC e arquivar liberando a cota", async () => {
    const E = await criarUsuario(pg, { email: "cota@x.com", empresa: "Cota" });
    falso.tokens.set("tok-cota", { id: E.uid, email: "cota@x.com" });
    await espelhar("profiles", "partners", "partner_members", "partner_acesso_config");
    const criar = (extra: Record<string, unknown> = {}) => post("tok-cota", "/api/conexoes", { partnerId: E.partnerId, nome: "Número", ...extra });

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await criar();
      assert.equal(r.status, 201, r.texto);
      ids.push(r.json.id);
    }
    const quarta = await criar();
    assert.deepEqual([quarta.status, quarta.json.erro], [409, "limite_de_conexoes_da_empresa"]);
    // a cota é da empresa: outra empresa continua criando
    assert.equal((await post("tok-b", "/api/conexoes", { partnerId: B.partnerId, nome: "Do B" })).status, 201);

    // conexão do computador tem cota própria e nasce no modo pc
    const doPc = await criar({ modo: "pc" });
    assert.equal(doPc.status, 201, doPc.texto);
    assert.equal(doPc.json.modo, "pc");
    assert.equal((await criar({ modo: "satélite" })).status, 400);

    // arquivar libera a cota e o gateway manda sair do aparelho
    const arquivar = await post("tok-cota", `/api/conexoes/${ids[0]}/arquivar`, {});
    assert.deepEqual([arquivar.status, arquivar.json], [200, { ok: true }]);
    assert.equal((await post("tok-b", `/api/conexoes/${ids[1]}/arquivar`, {})).status, 403);
    assert.equal((await criar()).status, 201);
    const lista = await gateway("GET", "/api/gateway/conexoes", undefined, { ts: AGORA.getTime() + 3000 });
    assert.deepEqual(lista.json.conexoes.find((c: any) => c.id === ids[0]), {
      id: ids[0], deveRodar: false, desconectar: true, pareamento: null, opcoes: { gruposPermitidos: [], historicoDias: 7, botAtivo: false },
    });
    const painel = await http("GET", `/api/conexoes?partnerId=${E.partnerId}`, { token: "tok-cota" });
    assert.ok(!painel.json.some((c: any) => c.id === ids[0]));
  });

  test("membro só do funil ('crm') não vê o WhatsApp; membro do 'robo' não baixa o arquivo completo", async () => {
    const soCrm = await criarUsuario(pg, { email: "socrm@x.com" });
    const soRobo = await criarUsuario(pg, { email: "sorobo@x.com" });
    await pg.query(`INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes) VALUES ($1, $2, 'membro', '{crm}'), ($1, $3, 'membro', '{robo}')`,
      [A.partnerId, soCrm.profileId, soRobo.profileId]);
    falso.tokens.set("tok-crm", { id: soCrm.uid, email: "socrm@x.com" });
    falso.tokens.set("tok-robo", { id: soRobo.uid, email: "sorobo@x.com" });
    await espelhar("profiles", "partner_members", "bot_conversas", "crm_quadros");
    const conversa = falso.tabela("bot_conversas").find((c) => c.conexao_id === CONEXAO_VETOR)!.id;
    const ler = (token: string, caminho: string) => http("GET", caminho, { token });

    // 'crm': funil sim, WhatsApp não
    const dados = await ler("tok-crm", `/api/data?partnerId=${A.partnerId}`);
    assert.equal(dados.status, 200);
    assert.deepEqual([dados.json.conexoes, dados.json.conversas, dados.json.campanhas, dados.json.fluxos], [[], [], [], []]);
    assert.ok(dados.json.quadros.length > 0);
    for (const [metodo, caminho] of [
      ["GET", `/api/conexoes?partnerId=${A.partnerId}`], ["GET", `/api/conexoes/${pcA}/credenciais`],
      ["GET", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-10-05`], ["GET", `/api/conversas/${conversa}/completa.txt`],
    ]) {
      assert.equal((await http(metodo, caminho, { token: "tok-crm" })).status, 403, caminho);
    }
    assert.equal((await post("tok-crm", `/api/conexoes/${CONEXAO_VETOR}/parear`, { metodo: "qr" })).status, 403);
    assert.equal((await post("tok-crm", `/api/conexoes/${CONEXAO_VETOR}/desconectar`, {})).status, 403);
    assert.equal((await http("PATCH", `/api/conversas/${conversa}`, { token: "tok-crm", corpo: JSON.stringify({ privacidade: "ignorar" }) })).status, 403);
    assert.equal((await post("tok-crm", "/api/bot/disparos/enviar-direta", { conexaoId: CONEXAO_VETOR, telefone: "5565900001111", texto: "oi" })).status, 403);

    // 'robo': opera o WhatsApp, mas o arquivo com telefone e conversa exata é do dono
    assert.equal((await ler("tok-robo", `/api/conexoes?partnerId=${A.partnerId}`)).status, 200);
    assert.equal((await ler("tok-robo", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-10-05`)).status, 403);
    assert.equal((await ler("tok-robo", `/api/conversas/${conversa}/completa.txt`)).status, 403);
    assert.equal((await ler("tok-a", `/api/conversas/${conversa}/completa.txt`)).status, 200);
  });

  test("enviar pelo CRM tira o robô da conversa enquanto a resposta espera na fila", async () => {
    const linha = falso.tabela("bot_conexoes").find((c) => c.id === pcA)!;
    linha.bot_ativo = true;
    const conversa = falso.inserir("bot_conversas", { conexao_id: pcA, telefone: "5565933334444", jid: null, estado: "bot" });
    try {
      const r = await post("tok-a", "/api/bot/disparos/enviar-direta", { conexaoId: pcA, telefone: "5565933334444", texto: "Já te respondo!" });
      assert.equal(r.status, 200, r.texto);
      assert.equal(conversa.estado, "humano");
    } finally {
      linha.bot_ativo = false;
    }
  });

  test("o arquivo completo (com telefone) não tem rota para a IA: o módulo de upload/GitHub saiu", async () => {
    const r = await post("tok-a", "/api/retroalimentacao/executar", { partnerId: A.partnerId, modo: "upload", conteudoTxt: "05/10 22:30 João: oi" });
    assert.equal(r.status, 404);
  });

  test("dia completo usa o fuso da empresa: sem Cuiabá, o recorte muda", async () => {
    await pg.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Sao_Paulo' WHERE partner_id = $1`, [A.partnerId]);
    await espelhar("partner_acesso_config");
    try {
      falso.chamadas.length = 0;
      const r = await http("GET", `/api/conversas/dia-completo.txt?partnerId=${A.partnerId}&dia=2026-10-05`, { token: "tok-a" });
      assert.equal(r.status, 200);
      assert.ok(r.texto.split("\n").includes("Dia: 05/10/2026 (horário de America/Sao_Paulo)"));
      const chamada = falso.chamadas.filter((x) => x.tipo === "rpc:bot_arquivo_completo").pop()!;
      assert.deepEqual([chamada.args._de, chamada.args._ate], ["2026-10-05T03:00:00.000Z", "2026-10-06T03:00:00.000Z"]);
    } finally {
      await pg.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Cuiaba' WHERE partner_id = $1`, [A.partnerId]);
      await espelhar("partner_acesso_config");
    }
  });
});
