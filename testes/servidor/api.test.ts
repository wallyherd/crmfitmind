// Servidor de verdade (porta 0) com o Supabase falso: autenticação, acesso por empresa e o que nunca pode vazar.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../../server/app.ts";
import { SupabaseFalso } from "./supabase-falso.ts";

const AGORA = new Date("2026-10-07T12:00:00Z");
const ID_QUALQUER = "00000000-0000-4000-8000-000000000000";

function montarCenario() {
  const db = new SupabaseFalso();
  const pa = db.inserir("partners", { fantasy_name: "Empresa A" });
  const pb = db.inserir("partners", { fantasy_name: "Empresa B" });

  const perfil = (token: string, dados: Record<string, any>) => {
    const userId = crypto.randomUUID();
    db.tokens.set(token, { id: userId, email: dados.email });
    db.usuariosAuth.push({ id: userId, email: dados.email, password: "", user_metadata: {} });
    return db.inserir("profiles", { user_id: userId, name: dados.email, phone: null, role: "user", status: "ativo", expira_em: null, partner_id: null, ...dados });
  };
  const admin = perfil("tok-admin", { email: "admin@teste.com", role: "admin" });
  const a = perfil("tok-a", { email: "a@teste.com", partner_id: pa.id });
  const b = perfil("tok-b", { email: "b@teste.com", partner_id: pb.id });
  const vencido = perfil("tok-vencido", { email: "vencido@teste.com", expira_em: "2026-01-01T00:00:00Z" });
  const suspenso = perfil("tok-suspenso", { email: "suspenso@teste.com", status: "suspenso" });
  perfil("tok-admin-vencido", { email: "admin2@teste.com", role: "admin", expira_em: "2026-01-01T00:00:00Z" });
  db.tokens.set("tok-sem-perfil", { id: crypto.randomUUID(), email: "fantasma@teste.com" });

  db.inserir("partner_members", { partner_id: pa.id, profile_id: a.id, papel: "owner", permissoes: ["robo", "crm"] });
  db.inserir("partner_members", { partner_id: pb.id, profile_id: b.id, papel: "owner", permissoes: ["robo", "crm"] });
  for (const p of [vencido, suspenso]) db.inserir("partner_members", { partner_id: pa.id, profile_id: p.id, papel: "membro", permissoes: ["robo", "crm"] });

  const ca = db.inserir("bot_conexoes", { escopo: "parceiro", owner_id: pa.id, nome: "Número A", status: "conectado", webhook_segredo: "segredo-da-conexao-a", arquivado_em: null, modo: "pc", bot_ativo: true });
  const cb = db.inserir("bot_conexoes", { escopo: "parceiro", owner_id: pb.id, nome: "Número B", status: "conectado", webhook_segredo: "segredo-da-conexao-b", arquivado_em: null });
  const qa = db.inserir("crm_quadros", { escopo: "parceiro", owner_id: pa.id, nome: "Funil A", arquivado_em: null });
  const qb = db.inserir("crm_quadros", { escopo: "parceiro", owner_id: pb.id, nome: "Funil B", arquivado_em: null });
  db.inserir("crm_colunas", { quadro_id: qa.id, nome: "Novo", posicao: 1000 });
  db.inserir("crm_colunas", { quadro_id: qb.id, nome: "Novo", posicao: 1000 });
  db.inserir("crm_cartoes", { quadro_id: qa.id, titulo: "Lead A", arquivado_em: null, posicao: 1000 });
  const cartaoB = db.inserir("crm_cartoes", { quadro_id: qb.id, titulo: "Lead B", arquivado_em: null, posicao: 1000 });
  const conversaA = db.inserir("bot_conversas", { conexao_id: ca.id, telefone: "5565900000001", jid: "5565900000001@s.whatsapp.net", updated_at: AGORA.toISOString() });
  const conversaB = db.inserir("bot_conversas", { conexao_id: cb.id, telefone: "5565900000002", jid: null, updated_at: AGORA.toISOString() });
  const pendenteA = db.inserir("bot_mensagens", { conversa_id: conversaA.id, direcao: "saida", status: "pendente", corpo: "olá", tipo: "texto", agendado_para: null, entregue_em: null });
  const pendenteB = db.inserir("bot_mensagens", { conversa_id: conversaB.id, direcao: "saida", status: "pendente", corpo: "oi", tipo: "texto", agendado_para: null, entregue_em: null });
  db.inserir("ia_retroalimentacao_config", { partner_id: pa.id, motor: "manual" });
  db.inserir("ia_relatorios_diarios", { partner_id: pa.id, data_referencia: "2026-10-06" });
  db.inserir("ia_relatorios_diarios", { partner_id: pb.id, data_referencia: "2026-10-06" });
  db.rpcs.bot_registrar_no_cartao = () => ({ data: null, error: null });
  db.rpcs.bot_contar_envio = () => ({ data: null, error: null });
  // A fila de verdade (reserva atômica, tentativas) é testada no PGlite (testes/banco/04-fase1);
  // aqui basta o efeito que a rota precisa: reservada não volta, confirmar só na própria conexão.
  const conversaDe = (m: any) => db.tabela("bot_conversas").find((c) => c.id === m.conversa_id);
  db.rpcs.bot_reservar_fila = ({ _conexao_id, _limite }: any) => {
    const lista = db.tabela("bot_mensagens")
      .filter((m) => m.direcao === "saida" && m.status === "pendente" && !m.reservada_ate && conversaDe(m)?.conexao_id === _conexao_id)
      .slice(0, _limite);
    for (const m of lista) m.reservada_ate = "reservada";
    return { data: lista.map((m) => ({ id: m.id, conexao_id: _conexao_id, para: conversaDe(m).jid ?? conversaDe(m).telefone, corpo: m.corpo, tipo: m.tipo })), error: null };
  };
  db.rpcs.bot_confirmar_envio = ({ _id, _status, _wa_id, _conexao_id }: any) => {
    const m = db.tabela("bot_mensagens").find((x) => x.id === _id && conversaDe(x)?.conexao_id === _conexao_id);
    if (!m) return { data: "nao_encontrada", error: null };
    Object.assign(m, { status: _status, ...(_wa_id ? { wa_id: _wa_id } : {}) });
    return { data: "ok", error: null };
  };

  return { db, pa, pb, admin, a, b, ca, cb, qa, qb, cartaoB, conversaA, pendenteA, pendenteB };
}

type Cenario = ReturnType<typeof montarCenario>;
let servidor: Server;
let base = "";
let c: Cenario;
let app: ReturnType<typeof criarApp>;

async function pedir(metodo: string, caminho: string, opcoes: { token?: string; corpo?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opcoes.headers || {}) };
  if (opcoes.token) headers.authorization = `Bearer ${opcoes.token}`;
  if (opcoes.corpo !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(base + caminho, { method: metodo, headers, body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined });
  const texto = await r.text();
  let json: any = null;
  try { json = JSON.parse(texto); } catch { /* corpo vazio */ }
  return { status: r.status, json, texto, headers: r.headers };
}

before(async () => {
  c = montarCenario();
  app = criarApp({ supabase: c.db as any, agora: () => AGORA, origens: ["https://app.teste"] });
  servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => servidor.close(() => ok())));

// Todas as rotas protegidas. Rota nova sem estar aqui derruba o teste "nenhuma rota fica de fora".
const PROTEGIDAS: [string, string][] = [
  ["GET", "/api/me"],
  ["GET", "/api/data"],
  ["GET", "/api/conexoes/:id/credenciais"],
  ["GET", "/api/conexoes"],
  ["POST", "/api/conexoes"],
  ["POST", "/api/conexoes/:id/parear"],
  ["POST", "/api/conexoes/:id/desconectar"],
  ["POST", "/api/conexoes/:id/arquivar"],
  ["PATCH", "/api/conexoes/:id/opcoes"],
  ["PATCH", "/api/conversas/:id"],
  ["GET", "/api/conversas/dia-completo.txt"],
  ["GET", "/api/conversas/:id/completa.txt"],
  ["GET", "/api/mensagens/:id/arquivo"],
  ["POST", "/api/bot/disparos/enviar-direta"],
  ["GET", "/api/mentor/painel"],
  ["GET", "/api/mentor/empresas/:partnerId/relatorio"],
  ["GET", "/api/empresa/privacidade"],
  ["PUT", "/api/empresa/privacidade"],
  ["GET", "/api/admin/usuarios"],
  ["POST", "/api/admin/usuarios"],
  ["PUT", "/api/admin/usuarios/:id"],
  ["POST", "/api/admin/usuarios/:id/renovar"],
  ["POST", "/api/admin/usuarios/:id/alterar-senha"],
  ["POST", "/api/admin/usuarios/:id/status"],
  ["DELETE", "/api/admin/usuarios/:id"],
  ["POST", "/api/setup/empresa"],
  // Fases 2 e 3
  ["GET", "/api/relatorios/dia"],
  ["GET", "/api/pendencias"],
  ["GET", "/api/vendas"],
  ["POST", "/api/vendas"],
  ["POST", "/api/vendas/:id/decidir"],
  ["GET", "/api/produtos"],
  ["POST", "/api/produtos"],
  ["PATCH", "/api/produtos/:id"],
  ["DELETE", "/api/produtos/:id"],
  ["GET", "/api/rastreamento"],
  ["POST", "/api/rastreamento"],
  ["PATCH", "/api/rastreamento/:id"],
  ["DELETE", "/api/rastreamento/:id"],
  ["GET", "/api/metas"],
  ["PUT", "/api/metas"],
  ["GET", "/api/ia/config"],
  ["PUT", "/api/ia/config"],
  ["PATCH", "/api/contatos/:id"],
  ["DELETE", "/api/contatos/:id"],
  ["POST", "/api/ia/sugestoes/:id"],
  ["GET", "/api/ia/lotes"],
  ["GET", "/api/ia/lotes/:id/arquivo"],
  ["POST", "/api/ia/lotes/gerar"],
  ["POST", "/api/ia/lotes/:id/analisar-agora"],
  ["POST", "/api/ia/resultado"],
  ["GET", "/api/ia/pendentes"],
  ["POST", "/api/ia/lotes/:id/reservar"],
  ["POST", "/api/ia/lotes/:id/falha"],
  ["GET", "/api/admin/ia/tokens"],
  ["POST", "/api/admin/ia/tokens"],
  ["DELETE", "/api/admin/ia/tokens/:id"],
];
const SO_ADMIN = PROTEGIDAS.filter(([, p]) => p.startsWith("/api/admin/") || p === "/api/setup/empresa");
// Autenticação própria (conector no PC ou gateway com HMAC) ou pública.
const ABERTAS: [string, string][] = [
  ["GET", "/api/health"],
  ["POST", "/api/bot/eventos"],
  ["GET", "/api/bot/fila"],
  ["POST", "/api/bot/confirmar"],
  ["GET", "/api/bot/atualizacao"],
  ["GET", "/api/gateway/conexoes"],
  ["GET", "/api/gateway/fila"],
  ["POST", "/api/gateway/midia"],
  // Segredo próprio (CRON_SECRET): testes/servidor/fase23.test.ts
  ["POST", "/api/cron/exportar"],
  ["POST", "/api/cron/ia-enviar"],
  ["POST", "/api/cron/ia-coletar"],
  ["POST", "/api/cron/manutencao"],
  ["POST", "/api/cron/ler-comprovantes"],
];
// Respondem 404 de propósito (app.all registra todos os métodos).
const REMOVIDAS = ["/api/config", "/api/auth/login"];
const comId = (p: string) => p.replace(":id", ID_QUALQUER);

describe("autenticação", () => {
  test("nenhuma rota registrada fica de fora da lista testada", () => {
    const registradas: string[] = [];
    for (const camada of (app as any)._router.stack) {
      if (!camada.route || [].concat(camada.route.path).some((p: string) => REMOVIDAS.includes(p))) continue;
      for (const metodo of Object.keys(camada.route.methods)) {
        registradas.push(`${metodo.toUpperCase()} ${camada.route.path}`);
      }
    }
    const conhecidas = new Set([...PROTEGIDAS, ...ABERTAS].map(([m, p]) => `${m} ${p}`));
    const faltando = registradas.filter((r) => !conhecidas.has(r));
    assert.deepEqual(faltando, [], "rota nova: inclua em PROTEGIDAS (e teste o acesso) ou em ABERTAS");
  });

  for (const [metodo, caminho] of PROTEGIDAS) {
    test(`${metodo} ${caminho} sem token -> 401`, async () => {
      const r = await pedir(metodo, comId(caminho), { corpo: metodo === "GET" ? undefined : {} });
      assert.equal(r.status, 401);
      assert.equal(r.json?.erro, "nao_autenticado");
    });
    test(`${metodo} ${caminho} com token inválido -> 401`, async () => {
      const r = await pedir(metodo, comId(caminho), { token: "token-falso", corpo: metodo === "GET" ? undefined : {} });
      assert.equal(r.status, 401);
    });
  }

  test("token da rotina de IA (crmia_) não abre rota de usuário, só segue para /api/ia/*", async () => {
    assert.equal((await pedir("GET", "/api/data", { token: "crmia_qualquer" })).status, 401);
    assert.equal((await pedir("GET", "/api/admin/usuarios", { token: "crmia_qualquer" })).status, 401);
    // passa o middleware; a rota /api/ia/* ainda não existe
    assert.equal((await pedir("GET", "/api/ia/lote", { token: "crmia_qualquer" })).status, 404);
  });

  test("health responde sem token", async () => {
    const r = await pedir("GET", "/api/health");
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "ok");
  });

  test("rotas removidas (/api/config, /api/auth/login) -> 404, com ou sem token", async () => {
    for (const [m, p] of [["GET", "/api/config"], ["POST", "/api/config"], ["POST", "/api/auth/login"]]) {
      assert.equal((await pedir(m, p, { corpo: m === "POST" ? {} : undefined })).status, 404, `${m} ${p}`);
      assert.equal((await pedir(m, p, { token: "tok-admin", corpo: m === "POST" ? {} : undefined })).status, 404, `${m} ${p} logado`);
    }
  });

  test("conta vencida -> 403 acesso_expirado; suspensa -> 403 conta_inativa; admin não vence", async () => {
    const vencido = await pedir("GET", "/api/me", { token: "tok-vencido" });
    assert.deepEqual([vencido.status, vencido.json.erro], [403, "acesso_expirado"]);
    const suspenso = await pedir("GET", "/api/me", { token: "tok-suspenso" });
    assert.deepEqual([suspenso.status, suspenso.json.erro], [403, "conta_inativa"]);
    assert.equal((await pedir("GET", "/api/me", { token: "tok-admin-vencido" })).status, 200);
    assert.equal((await pedir("GET", "/api/me", { token: "tok-sem-perfil" })).status, 403);
  });

  test("CORS só para APP_ORIGIN", async () => {
    const ok = await pedir("GET", "/api/health", { headers: { origin: "https://app.teste" } });
    assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.teste");
    const estranho = await pedir("GET", "/api/health", { headers: { origin: "https://site-malicioso.com" } });
    assert.equal(estranho.headers.get("access-control-allow-origin"), null);
  });
});

describe("acesso por empresa", () => {
  test("GET /api/me devolve o perfil e só as empresas do usuário", async () => {
    const r = await pedir("GET", "/api/me", { token: "tok-a" });
    assert.equal(r.status, 200);
    assert.equal(r.json.isAdmin, false);
    assert.deepEqual(r.json.partners, [{ id: c.pa.id, nome: "Empresa A" }]);
    assert.deepEqual(Object.keys(r.json.profile).sort(), ["email", "expira_em", "id", "name", "phone", "role", "status"]);
    const adm = await pedir("GET", "/api/me", { token: "tok-admin" });
    assert.equal(adm.json.isAdmin, true);
    assert.equal(adm.json.partners.length, 2);
    // A chave de privacidade e o botão de apagar dados (LGPD) são do dono de verdade: o admin não é dono de nenhuma empresa (achado 6).
    assert.deepEqual(r.json.donoDe, [c.pa.id]);
    assert.deepEqual(adm.json.donoDe, []);
  });

  test("usuário de A pedindo a empresa B -> 403 em todas as rotas com partnerId", async () => {
    const pedidos: [string, string, unknown?][] = [
      ["GET", `/api/data?partnerId=${c.pb.id}`],
      ["GET", `/api/relatorios/dia?partnerId=${c.pb.id}&dia=2026-10-06`],
      ["GET", `/api/pendencias?partnerId=${c.pb.id}`],
      ["GET", `/api/vendas?partnerId=${c.pb.id}`],
      ["POST", "/api/vendas", { partnerId: c.pb.id, valor: 100, forma: "pix" }],
      ["GET", `/api/produtos?partnerId=${c.pb.id}`],
      ["POST", "/api/produtos", { partnerId: c.pb.id, nome: "X" }],
      ["GET", `/api/rastreamento?partnerId=${c.pb.id}`],
      ["POST", "/api/rastreamento", { partner_id: c.pb.id, nome_campanha: "xx", mensagem_inicial: "oi tudo", modo: "contem" }],
      ["GET", `/api/metas?partnerId=${c.pb.id}`],
      ["PUT", `/api/metas?partnerId=${c.pb.id}`, { metas: [] }],
      ["GET", `/api/ia/config?partnerId=${c.pb.id}`],
      ["PUT", `/api/ia/config?partnerId=${c.pb.id}`, { consentir: true }],
      ["GET", `/api/ia/lotes?partnerId=${c.pb.id}&dia=2026-10-06`],
      ["POST", "/api/ia/resultado", { partner_id: c.pb.id }],
    ];
    for (const [m, p, corpo] of pedidos) {
      const r = await pedir(m, p, { token: "tok-a", corpo });
      assert.equal(r.status, 403, `${m} ${p} ${JSON.stringify(corpo ?? "")}`);
      assert.equal(r.json.erro, "sem_acesso");
    }
  });

  test("quadro ou cartão de outra empresa não serve de atalho", async () => {
    assert.equal((await pedir("GET", `/api/data?partnerId=${c.pa.id}&quadroId=${c.qb.id}`, { token: "tok-a" })).status, 403);
    const envio = await pedir("POST", "/api/bot/disparos/enviar-direta", {
      token: "tok-a",
      corpo: { conexaoId: c.ca.id, telefone: "5565988887777", texto: "oi", cartaoId: c.cartaoB.id },
    });
    assert.equal(envio.status, 403);
  });

  test("enviar-direta exige conexão de uma empresa do usuário", async () => {
    const antes = c.db.tabela("bot_mensagens").length;
    const alheia = await pedir("POST", "/api/bot/disparos/enviar-direta", {
      token: "tok-a",
      corpo: { conexaoId: c.cb.id, telefone: "5565988887777", texto: "spam" },
    });
    assert.equal(alheia.status, 403);
    assert.equal(c.db.tabela("bot_mensagens").length, antes, "nada entra na fila de B");

    const propria = await pedir("POST", "/api/bot/disparos/enviar-direta", {
      token: "tok-a",
      corpo: { conexaoId: c.ca.id, telefone: "(65) 98888-7777", texto: "olá" },
    });
    assert.equal(propria.status, 200);
    const msg = c.db.tabela("bot_mensagens").find((m) => m.id === propria.json.mensagemId);
    assert.equal(msg?.enviada_por, c.a.id);
    assert.equal(msg?.status, "pendente");
  });

  test("credenciais do conector: dono recebe, os outros não", async () => {
    const dono = await pedir("GET", `/api/conexoes/${c.ca.id}/credenciais`, { token: "tok-a" });
    assert.deepEqual(dono.json, { conexaoId: c.ca.id, segredo: "segredo-da-conexao-a" });
    assert.equal((await pedir("GET", `/api/conexoes/${c.cb.id}/credenciais`, { token: "tok-a" })).status, 403);
    // O admin não é da empresa B e B não liberou o conteúdo: a credencial do conector é conteúdo.
    const admin = await pedir("GET", `/api/conexoes/${c.cb.id}/credenciais`, { token: "tok-admin" });
    assert.deepEqual([admin.status, admin.json?.erro], [403, "sem_permissao_conteudo"]);
  });

  test("/api/data só traz a empresa pedida e nunca o webhook_segredo", async () => {
    const r = await pedir("GET", "/api/data", { token: "tok-a" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.partners.map((p: any) => p.id), [c.pa.id]);
    assert.deepEqual(r.json.conexoes.map((x: any) => x.id), [c.ca.id]);
    assert.ok(r.json.conexoes.every((x: any) => x.owner_id === c.pa.id));
    assert.ok(!r.texto.includes("webhook_segredo") && !r.texto.includes("segredo-da-conexao"), "segredo vazou no /api/data");

    const adm = await pedir("GET", `/api/data?partnerId=${c.pb.id}`, { token: "tok-admin" });
    assert.equal(adm.status, 200);
    assert.equal(adm.json.partners.length, 2);
    assert.ok(!adm.texto.includes("segredo-da-conexao"), "segredo vazou para o admin");
  });
});

describe("módulo antigo de IA (Gemini/GitHub)", () => {
  test("as rotas /api/retroalimentacao/* saíram: 404 mesmo logado", async () => {
    for (const [m, p] of [["GET", "/api/retroalimentacao/config"], ["POST", "/api/retroalimentacao/config"], ["GET", "/api/retroalimentacao/relatorios"], ["POST", "/api/retroalimentacao/executar"]]) {
      assert.equal((await pedir(m, `${p}?partnerId=${c.pa.id}`, { token: "tok-a", corpo: m === "POST" ? {} : undefined })).status, 404, `${m} ${p}`);
    }
  });
});

describe("admin de usuários", () => {
  test("quem não é admin recebe 403 em toda rota de admin e nada é criado", async () => {
    for (const [metodo, caminho] of SO_ADMIN) {
      const r = await pedir(metodo, comId(caminho), { token: "tok-a", corpo: metodo === "GET" ? undefined : { name: "x", email: "x@x.com", password: "12345678", nome: "x" } });
      assert.equal(r.status, 403, `${metodo} ${caminho}`);
    }
    assert.equal(c.db.chamadas.filter((x) => x.tipo === "auth.createUser").length, 0);
  });

  test("POST /api/admin/usuarios cria no Auth e completa o profile do gatilho, sem senha", async () => {
    const vazia = c.db.inserir("partners", { fantasy_name: "Empresa sem dono 1" });
    const r = await pedir("POST", "/api/admin/usuarios", {
      token: "tok-admin",
      corpo: { name: "Mentorado", email: "Mentorado@Teste.com", phone: "(65) 99999-0000", password: "senha-forte-1", role: "user", partnerId: vazia.id, duracaoDias: 30 },
    });
    assert.equal(r.status, 200, r.texto);
    const criado = c.db.usuariosAuth.find((u) => u.email === "mentorado@teste.com")!;
    assert.ok(criado, "usuário criado no Auth");
    const perfis = c.db.tabela("profiles").filter((p) => p.user_id === criado.id);
    assert.equal(perfis.length, 1, "um profile só: o do gatilho, atualizado");
    const p = perfis[0];
    assert.equal(p.status, "ativo");
    assert.equal(p.phone, "65999990000");
    assert.equal(p.partner_id, vazia.id);
    assert.equal(new Date(p.expira_em).getTime(), AGORA.getTime() + 30 * 86_400_000);
    assert.ok(!Object.keys(p).some((k) => /senha|password/i.test(k)), "profile não guarda senha");
    assert.ok(!JSON.stringify(r.json).includes("senha-forte-1"));
    // Empresa sem dono: o primeiro usuário ligado a ela vira o dono (achado 1)
    assert.ok(c.db.tabela("partner_members").some((m) => m.partner_id === vazia.id && m.profile_id === p.id && m.papel === "owner"));
  });

  test("aceita `dias` e `partner_id` (formato antigo da tela)", async () => {
    const r = await pedir("POST", "/api/admin/usuarios", {
      token: "tok-admin",
      corpo: { name: "Outro", email: "outro@teste.com", password: "senha-forte-2", partner_id: c.db.inserir("partners", { fantasy_name: "Empresa sem dono 2" }).id, dias: 7 },
    });
    assert.equal(r.status, 200, r.texto);
    assert.equal(new Date(r.json.usuario.expira_em).getTime(), AGORA.getTime() + 7 * 86_400_000);
    assert.ok(r.json.usuario.partner_id);
  });

  test("achado 4: empresa que já tem dono só recebe usuário do admin depois do opt-in; admin nunca vira membro", async () => {
    const antes = c.db.chamadas.filter((x) => x.tipo === "auth.createUser").length;
    const sem = await pedir("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "Espiao", email: "espiao@teste.com", password: "senha-forte-9", partnerId: c.pa.id } });
    assert.equal(sem.status, 403);
    assert.equal(sem.json.erro, "dono_precisa_liberar");
    assert.equal(c.db.chamadas.filter((x) => x.tipo === "auth.createUser").length, antes, "nem criou o usuário no Auth");

    const proprio = await pedir("PUT", `/api/admin/usuarios/${c.admin.id}`, { token: "tok-admin", corpo: { partnerId: c.pa.id } });
    assert.equal(proprio.status, 400);
    assert.equal(proprio.json.erro, "admin_nao_entra_em_empresa");
    assert.ok(!c.db.tabela("partner_members").some((m) => m.profile_id === c.admin.id));

    const admin2 = await pedir("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "Outro Admin", email: "adm3@teste.com", password: "senha-forte-8", role: "admin", partnerId: c.pa.id } });
    assert.equal(admin2.status, 400);

    // um usuário comum ligado pelo PUT também depende do opt-in
    const membro = await pedir("PUT", `/api/admin/usuarios/${c.b.id}`, { token: "tok-admin", corpo: { partnerId: c.pa.id } });
    assert.equal(membro.status, 403);

    // com o opt-in do dono, o admin já veria tudo: ligar um membro não abre nada novo
    c.db.inserir("partner_acesso_config", { partner_id: c.pa.id, mentor_pode_ver_conversas: true });
    const com = await pedir("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "Ajudante", email: "ajudante@teste.com", password: "senha-forte-7", partnerId: c.pa.id } });
    assert.equal(com.status, 200, com.texto);
    assert.ok(c.db.tabela("partner_members").some((m) => m.partner_id === c.pa.id && m.profile_id === com.json.usuario.id && m.papel === "membro"));
    c.db.tabelas.partner_acesso_config = c.db.tabela("partner_acesso_config").filter((x) => x.partner_id !== c.pa.id);
  });

  test("achado 1: o admin não é dono da empresa que cria", async () => {
    const aDono = await pedir("POST", "/api/setup/empresa", { token: "tok-admin", corpo: { nome: "Empresa do admin", userId: c.admin.user_id } });
    assert.equal(aDono.status, 400);
    assert.equal(aDono.json.erro, "dono_nao_pode_ser_admin");
    assert.ok(!c.db.tabela("partner_members").some((m) => m.profile_id === c.admin.id && m.papel === "owner"));
  });

  test("e-mail repetido -> 409; senha curta -> 400", async () => {
    const repetido = await pedir("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "X", email: "outro@teste.com", password: "senha-forte-3" } });
    assert.equal(repetido.status, 409);
    const curta = await pedir("POST", "/api/admin/usuarios", { token: "tok-admin", corpo: { name: "X", email: "curta@teste.com", password: "123" } });
    assert.equal(curta.status, 400);
  });

  test("renovar aceita `dias` e `duracaoDias`; null deixa sem vencimento", async () => {
    const r1 = await pedir("POST", `/api/admin/usuarios/${c.b.id}/renovar`, { token: "tok-admin", corpo: { dias: 10 } });
    assert.equal(new Date(r1.json.usuario.expira_em).getTime(), AGORA.getTime() + 10 * 86_400_000);
    const r2 = await pedir("POST", `/api/admin/usuarios/${c.b.id}/renovar`, { token: "tok-admin", corpo: { duracaoDias: 90 } });
    assert.equal(new Date(r2.json.usuario.expira_em).getTime(), AGORA.getTime() + 90 * 86_400_000);
    const r3 = await pedir("POST", `/api/admin/usuarios/${c.b.id}/renovar`, { token: "tok-admin", corpo: { dias: null } });
    assert.equal(r3.json.usuario.expira_em, null);
  });

  test("alterar senha vai só para o Auth", async () => {
    const livre = c.db.inserir("profiles", { user_id: crypto.randomUUID(), name: "Livre", email: "livre@teste.com", phone: null, role: "user", status: "ativo", expira_em: null, partner_id: null });
    c.db.usuariosAuth.push({ id: livre.user_id, email: "livre@teste.com", password: "", user_metadata: {} });
    const r = await pedir("POST", `/api/admin/usuarios/${livre.id}/alterar-senha`, { token: "tok-admin", corpo: { novaSenha: "outra-senha-boa" } });
    assert.equal(r.status, 200);
    const perfil = c.db.tabela("profiles").find((p) => p.id === livre.id)!;
    assert.ok(!Object.keys(perfil).some((k) => /senha|password/i.test(k)));
    assert.ok(c.db.chamadas.some((x) => x.tipo === "auth.updateUserById" && x.args.id === perfil.user_id));
  });

  test("achado 4: sem o opt-in, o admin não define a senha de quem é de uma empresa (entrar como a pessoa)", async () => {
    const r = await pedir("POST", `/api/admin/usuarios/${c.b.id}/alterar-senha`, { token: "tok-admin", corpo: { novaSenha: "outra-senha-boa" } });
    assert.equal(r.status, 403);
    assert.equal(r.json.erro, "senha_so_pelo_proprio_usuario");
    const perfilB = c.db.tabela("profiles").find((p) => p.id === c.b.id)!;
    assert.ok(!c.db.chamadas.some((x) => x.tipo === "auth.updateUserById" && x.args.id === perfilB.user_id), "a senha não foi mexida");
  });

  test("admin não tira o próprio acesso", async () => {
    assert.equal((await pedir("POST", `/api/admin/usuarios/${c.admin.id}/status`, { token: "tok-admin", corpo: { status: "suspenso" } })).status, 400);
    assert.equal((await pedir("DELETE", `/api/admin/usuarios/${c.admin.id}`, { token: "tok-admin" })).status, 400);
  });
});

describe("conector modo PC", () => {
  const h = (id: string, segredo: string) => ({ "x-bot-conexao": id, "x-bot-segredo": segredo });

  test("rotas do conector e do gateway sem credencial -> 401", async () => {
    // /api/gateway/midia recebe o arquivo cru (não JSON): o 401 dela está em comprovantes.test.ts.
    for (const [m, p] of ABERTAS.filter(([, x]) => x !== "/api/health" && x !== "/api/gateway/midia")) {
      const r = await pedir(m, p, { corpo: m === "POST" ? { eventos: [] } : undefined });
      assert.equal(r.status, 401, `${m} ${p}`);
    }
  });

  test("fila exige o segredo da própria conexão", async () => {
    assert.equal((await pedir("GET", "/api/bot/fila")).status, 401);
    assert.equal((await pedir("GET", "/api/bot/fila", { headers: h(c.ca.id, "segredo-da-conexao-b") })).status, 401);
    assert.equal((await pedir("GET", "/api/bot/fila", { token: "tok-a" })).status, 401, "sessão de usuário não serve de credencial do conector");
  });

  test("fila entrega a mensagem uma vez (reserva) e confirmar fecha só a da própria conexão", async () => {
    const r1 = await pedir("GET", "/api/bot/fila", { headers: h(c.ca.id, "segredo-da-conexao-a") });
    assert.equal(r1.status, 200);
    const ids = r1.json.mensagens.map((m: any) => m.id);
    assert.ok(ids.includes(c.pendenteA.id) && !ids.includes(c.pendenteB.id), "só a fila da própria conexão");
    const conversasA = new Set(c.db.tabela("bot_conversas").filter((x) => x.conexao_id === c.ca.id).map((x) => x.id));
    assert.ok(c.db.tabela("bot_mensagens").filter((m) => ids.includes(m.id)).every((m) => conversasA.has(m.conversa_id)));
    assert.deepEqual(r1.json.mensagens.find((m: any) => m.id === c.pendenteA.id),
      { id: c.pendenteA.id, conexaoId: c.ca.id, para: "5565900000001@s.whatsapp.net", corpo: "olá", tipo: "texto", telefone: "5565900000001" });
    // (telefone: o conector antigo do PC lê msg.telefone)
    const r2 = await pedir("GET", "/api/bot/fila", { headers: h(c.ca.id, "segredo-da-conexao-a") });
    assert.deepEqual(r2.json.mensagens, [], "reservada não volta no poll seguinte");

    const alheia = await pedir("POST", "/api/bot/confirmar", { headers: h(c.ca.id, "segredo-da-conexao-a"), corpo: { id: c.pendenteB.id, status: "enviada" } });
    assert.equal(alheia.status, 404);
    assert.equal(c.pendenteB.status, "pendente");

    const ok = await pedir("POST", "/api/bot/confirmar", { headers: h(c.ca.id, "segredo-da-conexao-a"), corpo: { id: c.pendenteA.id, status: "enviada", waId: "ABC123" } });
    assert.equal(ok.status, 200);
    assert.equal(c.pendenteA.status, "enviada");
    assert.equal(c.pendenteA.wa_id, "ABC123");
    assert.deepEqual(c.db.chamadas.filter((x) => x.tipo === "rpc:bot_confirmar_envio").pop()?.args,
      { _id: c.pendenteA.id, _status: "enviada", _wa_id: "ABC123", _erro: null, _conexao_id: c.ca.id });
  });
});
