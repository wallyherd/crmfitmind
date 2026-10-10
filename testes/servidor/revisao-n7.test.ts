// Tarefa N8: regressão dos achados da revisão N7 (especificacoes/n-achados-revisao.md), sobre um PGlite com as
// migrações 001–005 reais e o servidor de verdade. Cada teste leva o nome do achado.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../../server/app.ts";
import { SupabasePglite } from "./supabase-pglite.ts";
import { montarCenario, montarLote, DIA, q, um } from "../banco/cenario-fase23.mjs";
import { criarUsuario, novoBanco, FASE6 } from "../banco/pg.mjs";

const SEM_CONTEUDO = "sem_permissao_conteudo";
const SEGREDO_CRON = "segredo-do-cron-de-teste";
const EXEMPLO = JSON.parse(readFileSync(new URL("../../ia/rotina/exemplos/analise-exemplo.json", import.meta.url), "utf8"));

let pg: any, falso: SupabasePglite, servidor: Server, base = "";
let ana: any, admin: any, loteId = "", contatoId = "";

async function http(metodo: string, caminho: string, op: { token?: string; corpo?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(op.headers ?? {}) };
  if (op.token) headers.authorization = `Bearer ${op.token}`;
  if (op.corpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + caminho, { method: metodo, headers, body: op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined });
  const t = await r.text();
  let json: any = null;
  try { json = JSON.parse(t); } catch { /* texto puro */ }
  return { status: r.status, json, texto: t };
}

const P = () => ana.p as string;
const liberar = (valor: boolean) => http("PUT", "/api/empresa/privacidade", { token: "tok-a", corpo: { partnerId: P(), mentorPodeVerConversas: valor } });

before(async () => {
  pg = await novoBanco({ extras: FASE6 });
  ana = await montarCenario(pg);
  admin = await criarUsuario(pg, { email: "admin@x.com", admin: true });
  loteId = (await montarLote(pg, P())).partes[0].lote_id;
  contatoId = ana.ana.contatoId;

  falso = new SupabasePglite(pg);
  falso.tokens.set("tok-a", { id: ana.emp.uid, email: "ana@mentoria.test" });
  falso.tokens.set("tok-admin", { id: admin.uid, email: "admin@x.com" });
  const app = criarApp({ supabase: falso as any, origens: ["https://app.teste"], segredoCron: SEGREDO_CRON, agora: () => new Date(`${DIA}T15:00:00Z`) });
  servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => servidor.close(() => ok())));

describe("achados 1, 4 e 7: o fluxo real da tela (admin cria a empresa e depois o usuário)", () => {
  test("o mentorado vira dono, o admin fica sem o conteúdo e sem a chave", async () => {
    const criada = await http("POST", "/api/setup/empresa", { token: "tok-admin", corpo: { nome: "Studio Novo", cidade: "Cuiabá", estado: "MT" } });
    assert.equal(criada.status, 200, criada.texto);
    const partnerId = criada.json.data.partner_id as string;
    const donos = () => q(pg, `SELECT m.papel, pr.user_id, pr.id AS profile_id FROM public.partner_members m JOIN public.profiles pr ON pr.id = m.profile_id WHERE m.partner_id = $1`, [partnerId]);

    // o admin não é dono: só o marcador sem login
    let membros = await donos();
    assert.equal(membros.length, 1);
    assert.equal(membros[0].papel, "owner");
    assert.equal(membros[0].user_id, null);
    assert.ok(!membros.some((m: any) => m.profile_id === admin.profileId));

    // o primeiro usuário ligado à empresa vira o dono e o marcador sai
    const novo = await http("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "Mentorado Novo", email: "novo@x.com", password: "senha-forte-1", partnerId } });
    assert.equal(novo.status, 200, novo.texto);
    membros = await donos();
    assert.equal(membros.length, 1);
    assert.equal(membros[0].papel, "owner");
    assert.equal(membros[0].profile_id, novo.json.usuario.id);

    const eu = await http("GET", "/api/me", { token: "tok-novo@x.com" });
    assert.deepEqual(eu.json.donoDe, [partnerId]);
    assert.deepEqual((await http("GET", "/api/me", { token: "tok-admin" })).json.donoDe, [], "achado 6: o admin não é dono de empresa nenhuma");

    // sem opt-in o admin recebe 403 no conteúdo e não mexe na chave
    const rel = await http("GET", `/api/relatorios/dia?partnerId=${partnerId}&dia=${DIA}`, { token: "tok-admin" });
    assert.deepEqual([rel.status, rel.json.erro], [403, SEM_CONTEUDO]);
    const chave = await http("PUT", "/api/empresa/privacidade", { token: "tok-admin", corpo: { partnerId, mentorPodeVerConversas: true } });
    assert.deepEqual([chave.status, chave.json.erro], [403, "so_o_dono"]);
    assert.equal((await um(pg, `SELECT mentor_pode_ver_conversas AS v FROM public.partner_acesso_config WHERE partner_id = $1`, [partnerId])).v, false);

    // achado 7: o consentimento da IA e o motor que manda a conversa para fora também são do dono
    for (const corpo of [{ consentir: true }, { motor: "api_batch" }]) {
      const r = await http("PUT", "/api/ia/config", { token: "tok-admin", corpo: { partnerId, ...corpo } });
      assert.deepEqual([r.status, r.json.erro], [403, "so_o_dono"], JSON.stringify(corpo));
    }
    const consentimento = await http("PUT", "/api/ia/config", { token: "tok-novo@x.com", corpo: { partnerId, consentir: true } });
    assert.equal(consentimento.status, 200, consentimento.texto);

    // achado 4: usuário novo na empresa que já tem dono só com o opt-in
    const antes = falso.chamadasAuth.filter((c) => c.tipo === "createUser").length;
    const barrado = await http("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "Ajudante", email: "ajudante@x.com", password: "senha-forte-2", partnerId } });
    assert.deepEqual([barrado.status, barrado.json.erro], [403, "dono_precisa_liberar"]);
    assert.equal(falso.chamadasAuth.filter((c) => c.tipo === "createUser").length, antes);
    const proprio = await http("PUT", `/api/admin/usuarios/${admin.profileId}`, { token: "tok-admin", corpo: { partnerId } });
    assert.deepEqual([proprio.status, proprio.json.erro], [400, "admin_nao_entra_em_empresa"]);
    const senha = await http("POST", `/api/admin/usuarios/${novo.json.usuario.id}/alterar-senha`, { token: "tok-admin", corpo: { novaSenha: "senha-do-admin-1" } });
    assert.deepEqual([senha.status, senha.json.erro], [403, "senha_so_pelo_proprio_usuario"]);
    assert.ok(!falso.chamadasAuth.some((c) => c.tipo === "updateUserById"));

    // com o opt-in o admin já veria tudo: ligar o ajudante não abre nada novo, e ele entra como membro
    assert.equal((await http("PUT", "/api/empresa/privacidade", { token: "tok-novo@x.com", corpo: { partnerId, mentorPodeVerConversas: true } })).status, 200);
    const ajudante = await http("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "Ajudante", email: "ajudante@x.com", password: "senha-forte-2", partnerId } });
    assert.equal(ajudante.status, 200, ajudante.texto);
    assert.equal((await um(pg, `SELECT papel FROM public.partner_members WHERE partner_id = $1 AND profile_id = $2`, [partnerId, ajudante.json.usuario.id])).papel, "membro");
  });

  test("achado 1: o admin não pode ser o dono da empresa que cria", async () => {
    const r = await http("POST", "/api/setup/empresa", { token: "tok-admin", corpo: { nome: "Do admin", userId: admin.uid } });
    assert.deepEqual([r.status, r.json.erro], [400, "dono_nao_pode_ser_admin"]);
    assert.equal((await um(pg, `SELECT count(*)::int AS n FROM public.partners WHERE fantasy_name = 'Do admin'`)).n, 0);
  });
});

describe("achado 10: grupos e pareamento do mentorado", () => {
  test("sem o opt-in o admin não lê o nome dos grupos nem muda o que a conexão captura", async () => {
    await liberar(false);
    await pg.query(`UPDATE public.bot_conexoes SET grupos_disponiveis = '[{"jid":"1@g.us","nome":"Grupo Secreto da Ana"}]'::jsonb WHERE id = $1`, [ana.emp.conexaoId]);
    for (const caminho of [`/api/conexoes?partnerId=${P()}`, `/api/data?partnerId=${P()}`]) {
      const r = await http("GET", caminho, { token: "tok-admin" });
      assert.equal(r.status, 200, caminho);
      assert.ok(!r.texto.includes("Grupo Secreto"), caminho);
    }
    assert.ok((await http("GET", `/api/conexoes?partnerId=${P()}`, { token: "tok-a" })).texto.includes("Grupo Secreto da Ana"));
    const opcoes = await http("PATCH", `/api/conexoes/${ana.emp.conexaoId}/opcoes`, { token: "tok-admin", corpo: { gruposPermitidos: ["1@g.us"] } });
    assert.deepEqual([opcoes.status, opcoes.json.erro], [403, SEM_CONTEUDO]);
    const dono = await http("PATCH", `/api/conexoes/${ana.emp.conexaoId}/opcoes`, { token: "tok-a", corpo: { gruposPermitidos: ["1@g.us"] } });
    assert.equal(dono.status, 200, dono.texto);
  });
});

describe("achado 3: o token da rotina só vale na empresa que escolheu a rotina", () => {
  test("sem opt-in, motor e consentimento: 403 em resultado e falha, sem dizer nada do texto", async () => {
    await liberar(false);
    await pg.query(`UPDATE public.ia_retroalimentacao_config SET motor = 'manual', consentimento_ia_em = NULL WHERE partner_id = $1`, [P()]);
    const token = (await http("POST", "/api/admin/ia/tokens", { token: "tok-admin", corpo: { nome: "Sonda", partnerIds: [P()] } })).json.token as string;
    assert.ok(token);

    const analise = structuredClone(EXEMPLO);
    Object.assign(analise, { lote_id: loteId, partner_id: P(), dia: DIA });
    const sonda = await http("POST", "/api/ia/resultado", { token, corpo: analise });
    assert.deepEqual([sonda.status, sonda.json.erro], [403, "sem_acesso"]);
    assert.equal(sonda.json.detalhes, undefined, "nada sobre o texto das conversas");
    assert.equal((await q(pg, `SELECT 1 FROM public.ia_analises WHERE lote_id = $1 AND principal LIKE 'token:%'`, [loteId])).length, 0);

    const antes = (await um(pg, `SELECT tentativas FROM public.ia_lotes WHERE id = $1`, [loteId])).tentativas;
    const falha = await http("POST", `/api/ia/lotes/${loteId}/falha`, { token, headers: { "x-reserva-id": "11111111-1111-4111-8111-111111111111" }, corpo: { motivo: "x" } });
    assert.deepEqual([falha.status, falha.json.erro], [403, "sem_acesso"]);
    assert.equal((await um(pg, `SELECT tentativas FROM public.ia_lotes WHERE id = $1`, [loteId])).tentativas, antes);

    // com tudo ligado (rotina do dono, consentimento e liberação) o token volta a chegar na análise
    await pg.query(`UPDATE public.ia_retroalimentacao_config SET motor = 'rotina_dono', consentimento_ia_em = now() WHERE partner_id = $1`, [P()]);
    await liberar(true);
    const liberada = await http("POST", "/api/ia/resultado", { token, corpo: analise });
    assert.notEqual(liberada.status, 403, liberada.texto);
    await liberar(false);
    assert.equal((await http("POST", "/api/ia/resultado", { token, corpo: analise })).status, 403, "desligar a liberação vale na hora");
    await pg.query(`UPDATE public.ia_retroalimentacao_config SET motor = 'manual', consentimento_ia_em = NULL WHERE partner_id = $1`, [P()]);
  });
});

describe("achado 5: o resumo não sai pelo PostgREST nem pela rota do mentor", () => {
  test("o mentor sem opt-in não recebe o texto do resumo", async () => {
    await liberar(false);
    await pg.query(`INSERT INTO public.ia_relatorios_diarios (partner_id, data_referencia, resumo, resumo_executivo, analise_id)
                    VALUES ($1, $2::date, '"Fechou o pix do Bruno"'::jsonb, 'Responder Carla', (SELECT id FROM public.ia_analises WHERE lote_id = $3 LIMIT 1))
                    ON CONFLICT (partner_id, data_referencia) DO UPDATE SET resumo = EXCLUDED.resumo`, [P(), DIA, loteId]);
    const r = await http("GET", `/api/mentor/empresas/${P()}/relatorio?dia=${DIA}`, { token: "tok-admin" });
    assert.equal(r.status, 200);
    assert.ok(!r.texto.includes("Bruno") && !r.texto.includes("Carla"));
  });
});

describe("achado 8: a LGPD não deixa o .txt para trás quando o Storage falha", () => {
  test("o apagar devolve os caminhos, a pendência fica no banco e a manutenção termina o serviço", async () => {
    falso.arquivos.set(`conversas-ia/${(await um(pg, `SELECT arquivo_path FROM public.ia_lotes WHERE id = $1`, [loteId])).arquivo_path}`, "conversa da Ana");
    falso.falhaRemove = true;
    const r = await http("DELETE", `/api/contatos/${contatoId}`, { token: "tok-a" });
    assert.equal(r.status, 200, r.texto);
    assert.ok(r.json.arquivos_com_falha.length >= 1);
    const pendentes = await q(pg, `SELECT id FROM public.ia_lotes WHERE partner_id = $1 AND arquivo_apagar_pendente_em IS NOT NULL`, [P()]);
    assert.ok(pendentes.length >= 1, "o lote ficou marcado como pendente");
    assert.equal(falso.arquivos.size, 1, "o arquivo ainda está no Storage");

    // o lote não entrega mais o arquivo enquanto a limpeza não termina
    const arquivo = await http("GET", `/api/ia/lotes/${loteId}/arquivo`, { token: "tok-a" });
    assert.notEqual(arquivo.status, 200);

    falso.falhaRemove = false;
    const manutencao = await http("POST", "/api/cron/manutencao", { token: SEGREDO_CRON });
    assert.equal(manutencao.status, 200, manutencao.texto);
    assert.ok(manutencao.json.arquivos_apagados >= 1);
    assert.equal(falso.arquivos.size, 0, "o arquivo saiu do Storage");
    assert.equal((await q(pg, `SELECT id FROM public.ia_lotes WHERE partner_id = $1 AND arquivo_apagar_pendente_em IS NOT NULL`, [P()])).length, 0);
  });
});
