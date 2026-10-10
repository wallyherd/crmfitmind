// N5: visão do mentor no servidor, sobre um PGlite com as migrações 001–006 reais. O admin que não é da
// empresa só toca em conteúdo (conversas, contatos, vendas, lotes, análises) com o opt-in do dono; o dono
// liga e desliga, e desligar vale na hora. As rotas do painel não precisam do opt-in e não vazam conteúdo.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../../server/app.ts";
import { SupabasePglite } from "./supabase-pglite.ts";
import { montarCenario, montarLote, empresa, DIA, q, um } from "../banco/cenario-fase23.mjs";
import { criarUsuario, novoBanco, FASE6 } from "../banco/pg.mjs";

const SEM_CONTEUDO = "sem_permissao_conteudo";
const ID_QUALQUER = "00000000-0000-4000-8000-000000000000";
const EXEMPLO = JSON.parse(readFileSync(new URL("../../ia/rotina/exemplos/analise-exemplo.json", import.meta.url), "utf8"));

let pg: any, servidor: Server, base = "";
let ana: any, B: any, adminProprio: any, admin: any, membro: any;
let loteId = "", vendaId = "", contatoId = "", conversaId = "", sugestaoId = "", mensagemId = "";

async function http(metodo: string, caminho: string, op: { token?: string; corpo?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (op.token) headers.authorization = `Bearer ${op.token}`;
  if (op.corpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + caminho, { method: metodo, headers, body: op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined });
  const t = await r.text();
  let json: any = null;
  try { json = JSON.parse(t); } catch { /* texto puro */ }
  return { status: r.status, json, texto: t };
}

const P = () => ana.p as string;
const liberar = (valor: boolean, token = "tok-a") => http("PUT", "/api/empresa/privacidade", { token, corpo: { partnerId: P(), mentorPodeVerConversas: valor } });

// Cada rota de conteúdo que o admin (sem ser da empresa) pode tentar. O corpo é válido: a guarda tem que
// barrar antes de qualquer outra coisa, e com o opt-in a rota segue o caminho normal (qualquer coisa menos 403 de conteúdo).
function rotasDeConteudo(): [string, string, string, unknown?][] {
  const analise = structuredClone(EXEMPLO);
  Object.assign(analise, { lote_id: loteId, partner_id: P(), dia: DIA });
  analise.engine = { tipo: "manual", modelo: null };
  return [
    ["relatório do dia", "GET", `/api/relatorios/dia?partnerId=${P()}&dia=${DIA}`],
    ["pendências", "GET", `/api/pendencias?partnerId=${P()}`],
    ["vendas (lista)", "GET", `/api/vendas?partnerId=${P()}`],
    ["vendas (lançar)", "POST", "/api/vendas", { partnerId: P(), valor: 100, forma: "pix" }],
    ["vendas (decidir)", "POST", `/api/vendas/${vendaId}/decidir`, { acao: "rejeitar" }],
    ["lotes (lista)", "GET", `/api/ia/lotes?partnerId=${P()}&dia=${DIA}`],
    ["lotes (arquivo)", "GET", `/api/ia/lotes/${loteId}/arquivo`],
    ["lotes (gerar o de hoje)", "POST", "/api/ia/lotes/gerar", { partnerId: P() }],
    ["lotes (analisar agora)", "POST", `/api/ia/lotes/${loteId}/analisar-agora`, {}],
    ["resultado manual da IA", "POST", "/api/ia/resultado", analise],
    ["sugestões", "POST", `/api/ia/sugestoes/${sugestaoId}`, { acao: "descartou" }],
    ["contato (corrigir)", "PATCH", `/api/contatos/${contatoId}`, { categoria: "lead" }],
    ["conversa (estado)", "PATCH", `/api/conversas/${conversaId}`, { estado: "encerrada" }],
    ["comprovante (link do arquivo)", "GET", `/api/mensagens/${mensagemId}/arquivo`],
    ["conversa (.txt completo)", "GET", `/api/conversas/${conversaId}/completa.txt`],
    ["dia (.txt completo)", "GET", `/api/conversas/dia-completo.txt?partnerId=${P()}&dia=${DIA}`],
    ["enviar mensagem", "POST", "/api/bot/disparos/enviar-direta", { conexaoId: ana.emp.conexaoId, telefone: "5565988880000", texto: "oi" }],
    ["credenciais do conector", "GET", `/api/conexoes/${ana.emp.conexaoId}/credenciais`],
    ["parear", "POST", `/api/conexoes/${ana.emp.conexaoId}/parear`, { metodo: "qr" }],
    ["motor rotina_dono", "PUT", "/api/ia/config", { partnerId: P(), motor: "rotina_dono" }],
    // O apagar da LGPD é a última: se passar, o contato some.
    ["apagar contato (LGPD)", "DELETE", `/api/contatos/${contatoId}`],
  ];
}

before(async () => {
  pg = await novoBanco({ extras: FASE6 });
  ana = await montarCenario(pg);
  B = await criarUsuario(pg, { email: "b@x.com", empresa: "Studio B" });
  admin = await criarUsuario(pg, { email: "admin@x.com", admin: true });
  adminProprio = await criarUsuario(pg, { email: "admin-dono@x.com", admin: true, empresa: "Empresa do Erick" });
  membro = await criarUsuario(pg, { email: "membro@x.com" });
  await pg.query(`INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes) VALUES ($1, $2, 'membro', ARRAY['robo','crm'])`, [P(), membro.profileId]);
  await pg.query(`UPDATE public.partner_acesso_config SET timezone = 'America/Cuiaba' WHERE partner_id = $1`, [B.partnerId]);

  const coluna = await um(pg, `SELECT id FROM public.crm_colunas WHERE quadro_id = $1 ORDER BY posicao LIMIT 1`, [ana.emp.quadroId]);
  await pg.query(`INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo, contato_telefone) VALUES ($1, $2, 'Lead', '5565999990001')`, [ana.emp.quadroId, coluna.id]);
  const lote = await montarLote(pg, P());
  loteId = lote.partes[0].lote_id;
  vendaId = (await um(pg, `SELECT id FROM public.vendas WHERE partner_id = $1 LIMIT 1`, [P()])).id;
  contatoId = ana.ana.contatoId;
  conversaId = ana.ana.id;
  mensagemId = ana.m.bruno3;
  const analise = await um(pg, `INSERT INTO public.ia_analises (lote_id, partner_id, dia, engine_tipo, idem_chave, payload, principal)
                                VALUES ($1, $2, $3, 'manual', 'k-mentor-teste', '{}', 'usuario:teste') RETURNING id`, [loteId, P(), DIA]);
  sugestaoId = (await um(pg, `INSERT INTO public.ia_sugestoes (partner_id, contato_id, analise_id, tipo, conteudo)
                              VALUES ($1, $2, $3, 'mensagem', 'Oi Ana') RETURNING id`, [P(), contatoId, analise.id])).id;

  const falso = new SupabasePglite(pg);
  falso.tokens.set("tok-a", { id: ana.emp.uid, email: "ana@mentoria.test" });
  falso.tokens.set("tok-b", { id: B.uid, email: "b@x.com" });
  falso.tokens.set("tok-admin", { id: admin.uid, email: "admin@x.com" });
  falso.tokens.set("tok-admin-dono", { id: adminProprio.uid, email: "admin-dono@x.com" });
  falso.tokens.set("tok-membro", { id: membro.uid, email: "membro@x.com" });
  const app = criarApp({ supabase: falso as any, origens: ["https://app.teste"], agora: () => new Date(`${DIA}T15:00:00Z`) });
  servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => servidor.close(() => ok())));

describe("admin sem o opt-in do dono", () => {
  test("a empresa nasce sem liberação", async () => {
    const r = await http("GET", `/api/empresa/privacidade?partnerId=${P()}`, { token: "tok-a" });
    assert.deepEqual(r.json, { mentorPodeVerConversas: false, mentorPodeVerConversasEm: null });
  });

  test("cada rota de conteúdo responde 403 sem_permissao_conteudo", async () => {
    const rotas = rotasDeConteudo();
    assert.ok(rotas.length >= 18);
    for (const [nome, metodo, caminho, corpo] of rotas) {
      const r = await http(metodo, caminho, { token: "tok-admin", corpo });
      assert.deepEqual([nome, r.status, r.json?.erro], [nome, 403, SEM_CONTEUDO]);
    }
    // nada foi apagado, mudado nem enviado pelo caminho
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.contatos WHERE id = $1`, [contatoId])).n, 1);
    assert.equal((await um(pg, `SELECT estado FROM public.bot_conversas WHERE id = $1`, [conversaId])).estado, "humano");
    assert.equal((await um(pg, `SELECT status FROM public.vendas WHERE id = $1`, [vendaId])).status, "confirmada");
  });

  test("/api/data traz a estrutura, sem cartões, conversas nem QR de pareamento", async () => {
    await pg.query(`UPDATE public.bot_conexoes SET pareamento = '{"estado":"aguardando_qr","qr":"QR-SECRETO"}' WHERE id = $1`, [ana.emp.conexaoId]);
    const r = await http("GET", `/api/data?partnerId=${P()}`, { token: "tok-admin" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.conteudoLiberado, { conversas: false, cartoes: false });
    assert.deepEqual([r.json.conversas, r.json.cartoes], [[], []]);
    assert.ok(r.json.conexoes.length >= 1 && r.json.quadros.length >= 1);
    assert.ok(!r.texto.includes("QR-SECRETO"));
    // o dono continua vendo tudo
    const dono = await http("GET", `/api/data?partnerId=${P()}`, { token: "tok-a" });
    assert.deepEqual(dono.json.conteudoLiberado, { conversas: true, cartoes: true });
    assert.ok(dono.json.conversas.length >= 1 && dono.json.cartoes.length >= 1);
    assert.ok(dono.texto.includes("QR-SECRETO"));
  });

  test("a lista de conexões mostra o estado, mas não o pareamento", async () => {
    const r = await http("GET", `/api/conexoes?partnerId=${P()}`, { token: "tok-admin" });
    assert.equal(r.status, 200);
    assert.ok(r.json.length >= 1 && r.json.every((c: any) => c.pareamento === null));
    assert.ok(!r.texto.includes("QR-SECRETO"));
    // achado 10: o que a conexão captura (grupos, histórico, robô) é decisão do dono; o admin sem opt-in não mexe
    const opcoes = await http("PATCH", `/api/conexoes/${ana.emp.conexaoId}/opcoes`, { token: "tok-admin", corpo: { historicoDias: 30, botAtivo: true } });
    assert.deepEqual([opcoes.status, opcoes.json.erro], [403, SEM_CONTEUDO]);
    assert.ok(!opcoes.texto.includes("QR-SECRETO"));
    assert.notEqual((await um(pg, `SELECT opcoes->'historicoDias' AS h FROM public.bot_conexoes WHERE id = $1`, [ana.emp.conexaoId])).h, 30);
    await pg.query(`UPDATE public.bot_conexoes SET pareamento = NULL WHERE id = $1`, [ana.emp.conexaoId]);
  });

  test("a rotina do dono não entrega lote do mentorado sem a liberação, mesmo com token e consentimento", async () => {
    await pg.query(`UPDATE public.ia_retroalimentacao_config SET motor = 'rotina_dono', consentimento_ia_em = now() WHERE partner_id = $1`, [P()]);
    const token = (await http("POST", "/api/admin/ia/tokens", { token: "tok-admin", corpo: { nome: "Rotina", partnerIds: [P()] } })).json.token;
    const pendentes = () => http("GET", "/api/ia/pendentes?limite=5", { token });
    assert.deepEqual((await pendentes()).json.lotes, []);
    await liberar(true);
    assert.ok((await pendentes()).json.lotes.length >= 1);
    await liberar(false);
    assert.deepEqual((await pendentes()).json.lotes, [], "desligar a liberação para a rotina na hora");
    await pg.query(`UPDATE public.ia_retroalimentacao_config SET motor = 'manual', consentimento_ia_em = NULL WHERE partner_id = $1`, [P()]);
  });
});

describe("privacidade do mentorado", () => {
  test("só o dono muda: admin, membro, outra empresa e entrada inválida são barrados", async () => {
    const corpo = { partnerId: P(), mentorPodeVerConversas: true };
    assert.equal((await http("PUT", "/api/empresa/privacidade", { token: "tok-admin", corpo })).status, 403);
    assert.equal((await http("PUT", "/api/empresa/privacidade", { token: "tok-admin", corpo })).json.erro, "so_o_dono");
    assert.equal((await http("PUT", "/api/empresa/privacidade", { token: "tok-membro", corpo })).json?.erro, "so_o_dono");
    const outra = await http("PUT", "/api/empresa/privacidade", { token: "tok-b", corpo });
    assert.deepEqual([outra.status, outra.json.erro], [403, "sem_acesso"]);
    assert.equal((await http("PUT", "/api/empresa/privacidade", { token: "tok-a", corpo: { partnerId: P(), mentorPodeVerConversas: "sim" } })).status, 400);
    assert.equal((await http("PUT", "/api/empresa/privacidade", { token: "tok-admin", corpo: { partnerId: "x", mentorPodeVerConversas: true } })).status, 400);
    assert.equal((await um(pg, `SELECT mentor_pode_ver_conversas AS v FROM public.partner_acesso_config WHERE partner_id = $1`, [P()])).v, false);
  });

  test("o admin não é dono nem das empresas que cria para si: o painel do dono dele é o dele", async () => {
    // admin-dono é dono da própria empresa: pode mudar a dele, nunca a de outro
    const propria = await http("PUT", "/api/empresa/privacidade", { token: "tok-admin-dono", corpo: { partnerId: adminProprio.partnerId, mentorPodeVerConversas: true } });
    assert.equal(propria.status, 200);
    const alheia = await http("PUT", "/api/empresa/privacidade", { token: "tok-admin-dono", corpo: { partnerId: P(), mentorPodeVerConversas: true } });
    assert.deepEqual([alheia.status, alheia.json.erro], [403, "so_o_dono"]);
  });

  test("o dono liga, o estado volta com a data, e a leitura é de quem é da empresa", async () => {
    const ligou = await liberar(true);
    assert.equal(ligou.status, 200);
    assert.equal(ligou.json.mentorPodeVerConversas, true);
    assert.ok(ligou.json.mentorPodeVerConversasEm);
    for (const token of ["tok-a", "tok-membro", "tok-admin"]) {
      assert.equal((await http("GET", `/api/empresa/privacidade?partnerId=${P()}`, { token })).json.mentorPodeVerConversas, true, token);
    }
    assert.equal((await http("GET", `/api/empresa/privacidade?partnerId=${P()}`, { token: "tok-b" })).status, 403);
  });
});

describe("admin com o opt-in do dono", () => {
  test("as rotas de conteúdo deixam de barrar por falta de liberação", async () => {
    assert.equal((await liberar(true)).status, 200);
    // o apagar da LGPD tem o próprio teste, no fim: aqui ele tiraria o contato dos testes seguintes
    const rotas = rotasDeConteudo().filter(([nome]) => !nome.startsWith("apagar contato"));
    for (const [nome, metodo, caminho, corpo] of rotas) {
      const r = await http(metodo, caminho, { token: "tok-admin", corpo });
      assert.notEqual(r.json?.erro, SEM_CONTEUDO, `${nome}: ${r.status} ${r.texto.slice(0, 120)}`);
      assert.notEqual(r.status, 401, nome);
    }
  });

  test("leituras de verdade: relatório, pendências, vendas, lote, /api/data e .txt", async () => {
    await liberar(true);
    const ler = (caminho: string) => http("GET", caminho, { token: "tok-admin" });
    assert.equal((await ler(`/api/relatorios/dia?partnerId=${P()}&dia=${DIA}`)).status, 200);
    assert.equal((await ler(`/api/pendencias?partnerId=${P()}`)).status, 200);
    assert.equal((await ler(`/api/vendas?partnerId=${P()}`)).status, 200);
    assert.ok((await ler(`/api/ia/lotes?partnerId=${P()}&dia=${DIA}`)).json.length >= 1);
    const dados = await ler(`/api/data?partnerId=${P()}`);
    assert.deepEqual(dados.json.conteudoLiberado, { conversas: true, cartoes: true });
    assert.ok(dados.json.conversas.length >= 1 && dados.json.cartoes.length >= 1);
    assert.equal((await ler(`/api/conversas/dia-completo.txt?partnerId=${P()}&dia=${DIA}`)).status, 200);
    assert.equal((await ler(`/api/conversas/${conversaId}/completa.txt`)).status, 200);
  });

  test("desligar vale na hora, na mesma rota", async () => {
    await liberar(true);
    assert.equal((await http("GET", `/api/vendas?partnerId=${P()}`, { token: "tok-admin" })).status, 200);
    assert.equal((await liberar(false)).json.mentorPodeVerConversas, false);
    const r = await http("GET", `/api/vendas?partnerId=${P()}`, { token: "tok-admin" });
    assert.deepEqual([r.status, r.json.erro], [403, SEM_CONTEUDO]);
  });

  test("o liberado é por empresa: a de B continua fechada", async () => {
    await liberar(true);
    const r = await http("GET", `/api/vendas?partnerId=${B.partnerId}`, { token: "tok-admin" });
    assert.deepEqual([r.status, r.json.erro], [403, SEM_CONTEUDO]);
    await liberar(false);
  });
});

describe("quem é da empresa não depende do opt-in", () => {
  test("dono, membro e admin dono da própria empresa leem o conteúdo com a liberação desligada", async () => {
    await liberar(false);
    for (const token of ["tok-a", "tok-membro"]) {
      assert.equal((await http("GET", `/api/vendas?partnerId=${P()}`, { token })).status, 200, token);
      assert.equal((await http("GET", `/api/relatorios/dia?partnerId=${P()}&dia=${DIA}`, { token })).status, 200, token);
    }
    assert.equal((await http("GET", `/api/vendas?partnerId=${adminProprio.partnerId}`, { token: "tok-admin-dono" })).status, 200);
  });

  test("o mentorado de outra empresa continua com 403 sem_acesso", async () => {
    const r = await http("GET", `/api/vendas?partnerId=${P()}`, { token: "tok-b" });
    assert.deepEqual([r.status, r.json.erro], [403, "sem_acesso"]);
  });
});

describe("rotas do mentor", () => {
  test("só o admin entra", async () => {
    for (const caminho of ["/api/mentor/painel", `/api/mentor/empresas/${P()}/relatorio?dia=${DIA}`]) {
      assert.equal((await http("GET", caminho, { token: "tok-a" })).status, 403, caminho);
      assert.equal((await http("GET", caminho, { token: "tok-membro" })).status, 403, caminho);
      assert.equal((await http("GET", caminho)).status, 401, caminho);
    }
  });

  test("painel: uma linha por empresa ativa, igual ao crm_metricas_dia, sem conteúdo, e funciona sem o opt-in", async () => {
    await liberar(false);
    const r = await http("GET", `/api/mentor/painel?dia=${DIA}`, { token: "tok-admin" });
    assert.equal(r.status, 200);
    assert.equal(r.json.dia, DIA);
    const empresas = r.json.empresas as any[];
    const ativas = await q(pg, `SELECT id FROM public.partners WHERE status = 'ativo'`);
    assert.deepEqual(empresas.map((e) => e.partner_id).sort(), ativas.map((a: any) => a.id).sort());
    const minha = empresas.find((e) => e.partner_id === P());
    assert.equal(minha.opt_in, false);
    const metricas = (await um(pg, `SELECT public.crm_metricas_dia($1, $2::date) AS m`, [P(), DIA])).m;
    assert.equal(minha.numeros.novas, metricas.novas);
    assert.equal(minha.numeros.esperando_voce, metricas.esperando_voce);
    for (const proibido of ["5565999990", "Ana Paula", "Bruno", "Mentoria Start", "pix@mentoriaana"]) assert.ok(!r.texto.includes(proibido), proibido);
    // sem dia: hoje no fuso de cada empresa
    assert.equal((await http("GET", "/api/mentor/painel", { token: "tok-admin" })).status, 200);
    assert.equal((await http("GET", "/api/mentor/painel?dia=2026-13-45", { token: "tok-admin" })).status, 400);
  });

  test("painel mostra o opt-in de cada empresa", async () => {
    await liberar(true);
    const linhas = (await http("GET", `/api/mentor/painel?dia=${DIA}`, { token: "tok-admin" })).json.empresas as any[];
    assert.equal(linhas.find((e) => e.partner_id === P()).opt_in, true);
    assert.equal(linhas.find((e) => e.partner_id === B.partnerId).opt_in, false);
    await liberar(false);
  });

  test("relatório da empresa: só números sem opt-in; resumo e contatos só com ele", async () => {
    await pg.query(`INSERT INTO public.ia_relatorios_diarios (partner_id, data_referencia, resumo, analise_id, leads_analisados)
                    VALUES ($1, $2::date, '"Dia movimentado"'::jsonb, (SELECT id FROM public.ia_analises WHERE idem_chave = 'k-mentor-teste'), $3::jsonb)
                    ON CONFLICT (partner_id, data_referencia) DO UPDATE SET resumo = EXCLUDED.resumo, analise_id = EXCLUDED.analise_id, leads_analisados = EXCLUDED.leads_analisados`,
      [P(), DIA, JSON.stringify([{ contato_id: contatoId, categoria: "lead_quente", resumo: "quer fechar" }])]);
    await liberar(false);
    const fechado = await http("GET", `/api/mentor/empresas/${P()}/relatorio?dia=${DIA}`, { token: "tok-admin" });
    assert.equal(fechado.status, 200);
    assert.equal(fechado.json.opt_in, false);
    assert.equal(fechado.json.empresa.id, P());
    assert.ok(fechado.json.metricas);
    // achado 5: o resumo cita nomes e o que cada pessoa fez: sem opt-in o mentor só sabe que a análise existe
    assert.deepEqual(fechado.json.analise, { resumo: null, texto_oculto: true, contatos: [] });
    assert.ok(!fechado.texto.includes("Dia movimentado"));
    assert.ok(!fechado.texto.includes("5565999990") && !fechado.texto.includes("Ana Paula"));

    await liberar(true);
    const aberto = await http("GET", `/api/mentor/empresas/${P()}/relatorio?dia=${DIA}`, { token: "tok-admin" });
    assert.equal(aberto.json.opt_in, true);
    assert.equal(aberto.json.analise.resumo, "Dia movimentado");
    assert.equal(aberto.json.analise.contatos.length, 1);
    assert.ok(aberto.json.analise.contatos[0].telefone);
    await liberar(false);
  });

  test("relatório: empresa inexistente 404, id ruim 400, dia ruim 400, sem dia usa hoje", async () => {
    assert.equal((await http("GET", `/api/mentor/empresas/${ID_QUALQUER}/relatorio?dia=${DIA}`, { token: "tok-admin" })).status, 404);
    assert.equal((await http("GET", `/api/mentor/empresas/nao-e-uuid/relatorio?dia=${DIA}`, { token: "tok-admin" })).status, 400);
    assert.equal((await http("GET", `/api/mentor/empresas/${P()}/relatorio?dia=ontem`, { token: "tok-admin" })).status, 400);
    const hoje = await http("GET", `/api/mentor/empresas/${P()}/relatorio`, { token: "tok-admin" });
    assert.equal(hoje.status, 200);
    assert.equal(hoje.json.dia, DIA);
  });
});

describe("a guarda é uma só", () => {
  test("nenhuma rota de conteúdo volta a usar o atalho do admin (podeNaEmpresa) para decidir sozinha", () => {
    const fonte = (arq: string) => readFileSync(new URL(`../../server/${arq}`, import.meta.url), "utf8");
    // Rotas que servem conteúdo: o único uso de podeNaEmpresa tem que vir junto de podeVerConteudo/exigirConteudo.
    for (const arq of ["rotas/relatorios.ts", "rotas/disparos.ts", "rotas/conversas.ts", "rotas/mentor.ts"]) {
      assert.ok(!/podeNaEmpresa\(/.test(fonte(arq)), `${arq} usa podeNaEmpresa`);
    }
    for (const arq of ["rotas/ia.ts", "rotas/comercial.ts", "rotas/dados.ts"]) {
      const f = fonte(arq);
      const usos = f.match(/podeNaEmpresa\(/g)?.length ?? 0;
      const guardas = f.match(/podeVerConteudo\(/g)?.length ?? 0;
      assert.ok(guardas >= 1 && guardas >= usos - 1, `${arq}: ${usos} podeNaEmpresa para ${guardas} podeVerConteudo`);
    }
  });
});

describe("LGPD pelo mentor", () => {
  test("achado 7: só o dono apaga a pessoa; o admin não apaga nem com o opt-in", async () => {
    await liberar(false);
    const sem = await http("DELETE", `/api/contatos/${contatoId}`, { token: "tok-admin" });
    assert.deepEqual([sem.status, sem.json.erro], [403, SEM_CONTEUDO]);
    await liberar(true);
    const admin = await http("DELETE", `/api/contatos/${contatoId}`, { token: "tok-admin" });
    assert.deepEqual([admin.status, admin.json.erro], [403, "so_o_dono"]);
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.contatos WHERE id = $1`, [contatoId])).n, 1);
    const membroApaga = await http("DELETE", `/api/contatos/${contatoId}`, { token: "tok-membro" });
    assert.deepEqual([membroApaga.status, membroApaga.json.erro], [403, "so_o_dono"]);
    const com = await http("DELETE", `/api/contatos/${contatoId}`, { token: "tok-a" });
    assert.equal(com.status, 200, com.texto);
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.contatos WHERE id = $1`, [contatoId])).n, 0);
  });
});
