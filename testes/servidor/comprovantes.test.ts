// Tarefa Q1: comprovantes no servidor. POST /api/gateway/midia (HMAC sobre o arquivo cru), GET /api/mensagens/:id/arquivo
// (link assinado de 60 s, só com a guarda de conteúdo), a venda a confirmar com o botão "Ver comprovante",
// a manutenção dos 90 dias e a LGPD. Banco de verdade (PGlite) com as migrações 001–006.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash, createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { criarApp } from "../../server/app.ts";
import { SupabasePglite } from "./supabase-pglite.ts";
import { montarCenario, conversa, msg, local, q, um } from "../banco/cenario-fase23.mjs";
import { criarUsuario, novoBanco, FASE6 } from "../banco/pg.mjs";

const SEGREDO = "exemplo-de-segredo-so-para-teste-0123456789";
const SEGREDO_CRON = "segredo-do-cron-so-para-teste-0123456789";
const TS = Date.now();
const SEM_CONTEUDO = "sem_permissao_conteudo";

// Bytes com o começo certo de cada formato (a rota confere os primeiros bytes).
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("comprovante pix R$ 497,00")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png")]);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");

const sha256hex = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const assinar = (ts: number, metodo: string, caminho: string, corpo: Buffer | string = "", segredo = SEGREDO) =>
  createHmac("sha256", segredo).update(`${ts}.${metodo}.${caminho}.${sha256hex(corpo)}`).digest("hex");

let pg: any, falso: SupabasePglite, servidor: Server, base = "";
let a: any, B: any, admin: any;
let contadorTs = 0;
let seq = 0;

const P = () => a.p as string;
const conexaoId = () => a.emp.conexaoId as string;

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

type Midia = {
  corpo?: Buffer; mimetype?: string; waId: string; chatJid?: string; conexao?: string;
  ts?: number; assinatura?: string; segredo?: string; assinarCorpo?: Buffer; semAssinatura?: boolean;
};
// Upload como o gateway faz: corpo cru, Content-Type = mimetype, cabeçalhos com conexão, waId e chatJid.
async function enviarMidia(o: Midia) {
  const corpo = o.corpo ?? JPEG;
  const ts = o.ts ?? TS + ++contadorTs;
  const headers: Record<string, string> = {
    "content-type": o.mimetype ?? "image/jpeg",
    "x-conexao-id": o.conexao ?? conexaoId(),
    "x-wa-id": o.waId,
    "x-chat-jid": o.chatJid ?? "5565999990002@s.whatsapp.net",
  };
  if (!o.semAssinatura) {
    headers["x-gateway-ts"] = String(ts);
    headers["x-gateway-assinatura"] = o.assinatura ?? assinar(ts, "POST", "/api/gateway/midia", o.assinarCorpo ?? corpo, o.segredo);
  }
  const r = await fetch(`${base}/api/gateway/midia`, { method: "POST", headers, body: new Uint8Array(corpo) });
  const t = await r.text();
  let json: any = null;
  try { json = JSON.parse(t); } catch { /* texto */ }
  return { status: r.status, json };
}

// Mensagem de imagem do cliente, pronta para receber o arquivo.
async function mensagemDoCliente(conv: { id: string }, tipo = "imagem") {
  const waId = `WA-Q1-${++seq}`;
  const id = await msg(pg, conv.id, "cliente", local("15:00"), null, { tipo });
  await pg.query(`UPDATE public.bot_mensagens SET wa_id = $2 WHERE id = $1`, [id, waId]);
  return { id: id as string, waId };
}
const linhaDa = (id: string) => um(pg, `SELECT arquivo_path, arquivo_em FROM public.bot_mensagens WHERE id = $1`, [id]);
const guardado = (caminho: string) => falso.binarios.get(`comprovantes/${caminho}`);
const fila = async () => (await q(pg, `SELECT caminho FROM public.comprovantes_apagar ORDER BY caminho`)).map((l: any) => l.caminho);

before(async () => {
  pg = await novoBanco({ extras: FASE6 });
  a = await montarCenario(pg);
  B = await criarUsuario(pg, { email: "b@x.com", empresa: "Studio B" });
  admin = await criarUsuario(pg, { email: "admin@x.com", admin: true });
  falso = new SupabasePglite(pg);
  falso.tokens.set("tok-a", { id: a.emp.uid, email: "ana@mentoria.test" });
  falso.tokens.set("tok-b", { id: B.uid, email: "b@x.com" });
  falso.tokens.set("tok-admin", { id: admin.uid, email: "admin@x.com" });
  const app = criarApp({
    supabase: falso as any, origens: ["https://app.teste"], segredoGateway: SEGREDO, segredoCron: SEGREDO_CRON,
    agora: () => new Date(TS + 30_000),
  });
  servidor = app.listen(0, "127.0.0.1");
  await once(servidor, "listening");
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => servidor.close(() => ok())));

describe("POST /api/gateway/midia: autenticação (HMAC sobre o arquivo cru)", () => {
  test("sem assinatura, com assinatura errada, de outro corpo, de outro segredo ou vencida: 401, e nada é guardado", async () => {
    const m = await mensagemDoCliente(a.bruno);
    const tentativas: Midia[] = [
      { semAssinatura: true },
      { assinatura: "0".repeat(64) },
      { assinarCorpo: Buffer.concat([JPEG, Buffer.from("x")]) },
      { segredo: "outro-segredo-que-nao-e-o-do-gateway-000000" },
      { ts: TS - 10 * 60_000 },
    ];
    for (const t of tentativas) {
      const r = await enviarMidia({ waId: m.waId, ...t });
      assert.equal(r.status, 401, JSON.stringify(Object.keys(t)));
      assert.equal(r.json.erro, "credencial_invalida");
    }
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
    assert.equal(falso.binarios.size, 0);
  });

  test("a mesma requisição assinada não vale duas vezes", async () => {
    const m = await mensagemDoCliente(a.bruno);
    const ts = TS + 5000;
    const assinatura = assinar(ts, "POST", "/api/gateway/midia", JPEG);
    const primeira = await enviarMidia({ waId: m.waId, ts, assinatura });
    assert.equal(primeira.status, 200);
    const repetida = await enviarMidia({ waId: m.waId, ts, assinatura });
    assert.equal(repetida.status, 401);
  });

  test("o modo PC (x-bot-conexao + x-bot-segredo) também sobe, mas conexão do gateway não entra por ele", async () => {
    const pc = await um(pg, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo, webhook_segredo) VALUES ('parceiro', $1, 'PC', 'pc', 'segredo-do-pc-123') RETURNING id`, [P()]);
    const conv = await um(pg, `INSERT INTO public.bot_conversas (conexao_id, telefone, jid, nome, tipo, estado) VALUES ($1, '5565911110000', '5565911110000@s.whatsapp.net', 'Cliente PC', 'individual', 'humano') RETURNING id`, [pc.id]);
    const m = await mensagemDoCliente(conv);
    const pedir = (segredo: string) => fetch(`${base}/api/gateway/midia`, {
      method: "POST",
      headers: { "content-type": "image/png", "x-bot-conexao": pc.id, "x-bot-segredo": segredo, "x-wa-id": m.waId, "x-chat-jid": "5565911110000@s.whatsapp.net" },
      body: new Uint8Array(PNG),
    });
    assert.equal((await pedir("errado")).status, 401);
    assert.equal((await pedir("segredo-do-pc-123")).status, 200);
    assert.equal((await linhaDa(m.id)).arquivo_path, `${P()}/${conv.id}/${m.id}.png`);
  });
});

describe("POST /api/gateway/midia: o que é guardado", () => {
  test("imagem do cliente: vai para {empresa}/{conversa}/{id da mensagem}.jpg no bucket com o tipo certo, e a mensagem aponta para ela", async () => {
    const m = await mensagemDoCliente(a.bruno);
    const r = await enviarMidia({ waId: m.waId });
    assert.deepEqual([r.status, r.json], [200, { ok: true }]);
    const caminho = `${P()}/${a.bruno.id}/${m.id}.jpg`;
    const arq = guardado(caminho);
    assert.ok(arq, "o arquivo foi para o Storage");
    assert.deepEqual(arq!.corpo, JPEG);
    assert.equal(arq!.contentType, "image/jpeg");
    const linha = await linhaDa(m.id);
    assert.equal(linha.arquivo_path, caminho);
    assert.ok(linha.arquivo_em);
  });

  test("PDF (documento) e PNG; entrega repetida devolve ja:true e não duplica", async () => {
    const doc = await mensagemDoCliente(a.bruno, "documento");
    assert.equal((await enviarMidia({ waId: doc.waId, corpo: PDF, mimetype: "application/pdf" })).status, 200);
    assert.ok(guardado(`${P()}/${a.bruno.id}/${doc.id}.pdf`));
    const repetida = await enviarMidia({ waId: doc.waId, corpo: PDF, mimetype: "application/pdf" });
    assert.deepEqual([repetida.status, repetida.json], [200, { ok: true, ja: true }]);
    const png = await mensagemDoCliente(a.bruno);
    assert.equal((await enviarMidia({ waId: png.waId, corpo: PNG, mimetype: "image/png" })).status, 200);
  });

  test("mimetype com parâmetro (image/jpeg; x=y) vale; o tipo vem do cabeçalho e os bytes têm que conferir", async () => {
    const m = await mensagemDoCliente(a.bruno);
    assert.equal((await enviarMidia({ waId: m.waId, mimetype: "image/png", corpo: JPEG })).status, 415);
    assert.equal((await enviarMidia({ waId: m.waId, mimetype: "image/jpeg", corpo: Buffer.from("<html><script>alert(1)</script>") })).json.erro, "conteudo_nao_confere");
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
    assert.equal((await enviarMidia({ waId: m.waId, mimetype: "image/jpeg; charset=binary" })).status, 200);
  });

  test("mimetype fora da lista (áudio, vídeo, SVG, HTML, zip): 415", async () => {
    const m = await mensagemDoCliente(a.bruno);
    for (const mimetype of ["audio/ogg", "video/mp4", "image/svg+xml", "text/html", "application/zip", "image/gif"]) {
      const r = await enviarMidia({ waId: m.waId, mimetype });
      assert.equal(r.status, 415, mimetype);
    }
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
  });

  test("limite de 4 MB: 4 MB cheios passam, um byte a mais é 413", async () => {
    const m = await mensagemDoCliente(a.bruno);
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024 + 1 - 3)]);
    const r = await enviarMidia({ waId: m.waId, corpo: grande });
    assert.equal(r.status, 413);
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
    const cheio = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4 * 1024 * 1024 - 3)]);
    assert.equal((await enviarMidia({ waId: m.waId, corpo: cheio })).status, 200);
  });

  test("corpo vazio e cabeçalhos faltando: 400", async () => {
    const m = await mensagemDoCliente(a.bruno);
    assert.equal((await enviarMidia({ waId: m.waId, corpo: Buffer.alloc(0) })).status, 400);
    assert.equal((await enviarMidia({ waId: "" })).status, 400);
    assert.equal((await enviarMidia({ waId: m.waId, conexao: "nao-e-uuid" })).status, 400);
  });
});

describe("POST /api/gateway/midia: o servidor não confia no gateway", () => {
  test("grupo (pelo jid ou pela conversa), mensagem do próprio mentorado, texto: 422 e nada guardado", async () => {
    const m = await mensagemDoCliente(a.bruno);
    const g = await enviarMidia({ waId: m.waId, chatJid: "120363000000000001@g.us" });
    assert.deepEqual([g.status, g.json.erro], [422, "grupo"]);

    const doGrupo = await mensagemDoCliente(a.grupo);
    const g2 = await enviarMidia({ waId: doGrupo.waId, chatJid: "5565999990002@s.whatsapp.net" });
    assert.deepEqual([g2.status, g2.json.erro], [422, "grupo"]);

    const saida = await msg(pg, a.bruno.id, "humano", local("15:05"), null, { tipo: "imagem" });
    await pg.query(`UPDATE public.bot_mensagens SET wa_id = 'WA-Q1-SAIDA' WHERE id = $1`, [saida]);
    const s = await enviarMidia({ waId: "WA-Q1-SAIDA" });
    assert.deepEqual([s.status, s.json.erro], [422, "de_mim"]);

    const texto = await mensagemDoCliente(a.bruno, "texto");
    const t = await enviarMidia({ waId: texto.waId });
    assert.deepEqual([t.status, t.json.erro], [422, "tipo"]);

    assert.equal(falso.binarios.size === 0 || [...falso.binarios.keys()].every((k) => !k.includes("WA-Q1-SAIDA")), true);
    for (const id of [saida]) assert.equal((await linhaDa(id)).arquivo_path, null);
  });

  test("conversa com privacidade diferente de normal: o servidor recusa, mesmo que o gateway não saiba", async () => {
    const c = await conversa(pg, a.emp, "5565988880001", "Cliente Reservado");
    const m = await mensagemDoCliente(c);
    for (const p of ["so_metadados", "ignorar"]) {
      await pg.query(`UPDATE public.bot_conversas SET privacidade = $2 WHERE id = $1`, [c.id, p]);
      const r = await enviarMidia({ waId: m.waId, chatJid: "5565988880001@s.whatsapp.net" });
      assert.deepEqual([r.status, r.json.erro], [422, "privacidade"], p);
    }
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
    assert.equal([...falso.binarios.keys()].some((k) => k.includes(c.id)), false, "nenhum arquivo dessa conversa no Storage");
  });

  test("mensagem que o servidor ainda não conhece: 404 (o gateway tenta de novo); conexão desconhecida: 404", async () => {
    const r = await enviarMidia({ waId: "WA-QUE-NAO-CHEGOU" });
    assert.deepEqual([r.status, r.json.erro], [404, "mensagem_desconhecida"]);
    const sem = await enviarMidia({ waId: "x", conexao: "00000000-0000-4000-8000-000000000000" });
    assert.equal(sem.status, 404);
  });

  test("mensagem de outra empresa não aceita arquivo da conexão errada", async () => {
    const m = await mensagemDoCliente(a.bruno);
    const outraConexao = await um(pg, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('parceiro', $1, 'B', 'gateway') RETURNING id`, [B.partnerId]);
    const r = await enviarMidia({ waId: m.waId, conexao: outraConexao.id });
    assert.deepEqual([r.status, r.json.erro], [404, "mensagem_desconhecida"]);
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
  });

  test("falha do Storage: 500 (o gateway tenta de novo) e o caminho não é gravado", async () => {
    const m = await mensagemDoCliente(a.bruno);
    falso.falhaUpload = true;
    try {
      const r = await enviarMidia({ waId: m.waId });
      assert.equal(r.status, 500);
    } finally {
      falso.falhaUpload = false;
    }
    assert.equal((await linhaDa(m.id)).arquivo_path, null);
    assert.equal((await enviarMidia({ waId: m.waId })).status, 200);
  });
});

describe("GET /api/mensagens/:id/arquivo", () => {
  let comArquivo: string, semArquivo: string, caminho: string;
  before(async () => {
    const m = await mensagemDoCliente(a.ana);
    assert.equal((await enviarMidia({ waId: m.waId, chatJid: "5565999990001@s.whatsapp.net" })).status, 200);
    comArquivo = m.id;
    caminho = `${P()}/${a.ana.id}/${m.id}.jpg`;
    semArquivo = (await mensagemDoCliente(a.ana)).id;
  });
  const ver = (id: string, token?: string) => http("GET", `/api/mensagens/${id}/arquivo`, { token });

  test("o dono recebe um link assinado de 60 segundos e o tipo", async () => {
    falso.linksAssinados.length = 0;
    const r = await ver(comArquivo, "tok-a");
    assert.equal(r.status, 200);
    assert.match(r.json.url, /^https:\/\/storage\.falso\/comprovantes\//);
    assert.equal(r.json.tipo, "imagem");
    assert.deepEqual(falso.linksAssinados, [{ bucket: "comprovantes", caminho, segundos: 60 }]);
    const exp = Date.parse(r.json.expira_em) - (TS + 30_000);
    assert.equal(exp, 60_000);
    assert.deepEqual(Object.keys(r.json).sort(), ["expira_em", "tipo", "url"], "não devolve o caminho nem dados da conversa");
  });

  test("PDF vem com tipo pdf", async () => {
    const doc = await mensagemDoCliente(a.ana, "documento");
    await enviarMidia({ waId: doc.waId, corpo: PDF, mimetype: "application/pdf", chatJid: "5565999990001@s.whatsapp.net" });
    assert.equal((await ver(doc.id, "tok-a")).json.tipo, "pdf");
  });

  test("sem login 401; outra empresa 403 sem_acesso; mensagem sem arquivo 404; id ruim 400; id desconhecido 404", async () => {
    assert.equal((await ver(comArquivo)).status, 401);
    const outra = await ver(comArquivo, "tok-b");
    assert.deepEqual([outra.status, outra.json.erro], [403, "sem_acesso"]);
    const sem = await ver(semArquivo, "tok-a");
    assert.deepEqual([sem.status, sem.json.erro], [404, "sem_arquivo"]);
    assert.equal((await ver("nao-e-uuid", "tok-a")).status, 400);
    assert.equal((await ver("00000000-0000-4000-8000-000000000000", "tok-a")).status, 404);
  });

  test("admin sem o opt-in do dono: 403 sem_permissao_conteudo; com o opt-in passa; desligou, volta a barrar na hora", async () => {
    const sem = await ver(comArquivo, "tok-admin");
    assert.deepEqual([sem.status, sem.json.erro], [403, SEM_CONTEUDO]);
    assert.equal((await ver(semArquivo, "tok-admin")).json.erro, SEM_CONTEUDO, "a guarda vem antes de dizer se há arquivo");

    const liga = await http("PUT", "/api/empresa/privacidade", { token: "tok-a", corpo: { partnerId: P(), mentorPodeVerConversas: true } });
    assert.equal(liga.status, 200);
    const com = await ver(comArquivo, "tok-admin");
    assert.equal(com.status, 200);
    assert.ok(com.json.url);

    await http("PUT", "/api/empresa/privacidade", { token: "tok-a", corpo: { partnerId: P(), mentorPodeVerConversas: false } });
    assert.equal((await ver(comArquivo, "tok-admin")).json.erro, SEM_CONTEUDO);
  });

  test("Storage fora do ar: 502; conversa que virou privada: 404 sem_arquivo", async () => {
    falso.falhaAssinar = true;
    try {
      assert.equal((await ver(comArquivo, "tok-a")).status, 502);
    } finally {
      falso.falhaAssinar = false;
    }
    const c = await conversa(pg, a.emp, "5565988880002", "Cliente que Pediu Sigilo");
    const m = await mensagemDoCliente(c);
    await enviarMidia({ waId: m.waId, chatJid: "5565988880002@s.whatsapp.net" });
    assert.equal((await ver(m.id, "tok-a")).status, 200);
    const priv = await http("PATCH", `/api/conversas/${c.id}`, { token: "tok-a", corpo: { privacidade: "so_metadados" } });
    assert.equal(priv.status, 200);
    assert.deepEqual([(await ver(m.id, "tok-a")).status, (await ver(m.id, "tok-a")).json.erro], [404, "sem_arquivo"]);
    assert.ok((await fila()).some((c2: string) => c2.includes(`/${c.id}/`)), "o arquivo foi para a fila de apagar");
  });
});

describe("venda a confirmar com comprovante", () => {
  test("a lista de vendas aponta a mensagem com arquivo só nas a confirmar; a prova com arquivo ganha do mais recente", async () => {
    const c = await conversa(pg, a.emp, "5565977771111", "Cliente do Pix");
    const velha = await mensagemDoCliente(c);
    const prova = await mensagemDoCliente(c);
    const nova = await mensagemDoCliente(c);
    for (const m of [velha, prova, nova]) {
      assert.equal((await enviarMidia({ waId: m.waId, chatJid: "5565977771111@s.whatsapp.net" })).status, 200);
    }
    await pg.query(`UPDATE public.bot_mensagens SET arquivo_em = now() - interval '2 days' WHERE id = $1`, [velha.id]);
    const ct = await um(pg, `SELECT contato_id FROM public.bot_conversas WHERE id = $1`, [c.id]);
    const venda = await um(pg, `INSERT INTO public.vendas (partner_id, contato_id, conversa_id, dia, valor, forma, status, fonte, evidencia_mensagem_id)
                                VALUES ($1, $2, $3, (now())::date, 497, 'pix', 'pendente_confirmacao', 'ia', $4) RETURNING id`, [P(), ct.contato_id, c.id, prova.id]);
    const semProva = await um(pg, `INSERT INTO public.vendas (partner_id, contato_id, conversa_id, dia, valor, forma, status, fonte)
                                   VALUES ($1, $2, $3, (now())::date, 100, 'pix', 'pendente_confirmacao', 'ia') RETURNING id`, [P(), ct.contato_id, c.id]);
    const confirmada = await um(pg, `INSERT INTO public.vendas (partner_id, contato_id, conversa_id, dia, valor, forma, status, fonte)
                                     VALUES ($1, $2, $3, (now())::date, 50, 'pix', 'confirmada', 'manual') RETURNING id`, [P(), ct.contato_id, c.id]);
    const outroContato = await um(pg, `INSERT INTO public.vendas (partner_id, dia, valor, forma, status, fonte)
                                       VALUES ($1, (now())::date, 70, 'pix', 'pendente_confirmacao', 'ia') RETURNING id`, [P()]);

    const r = await http("GET", `/api/vendas?partnerId=${P()}&de=2020-01-01&ate=2099-01-01`, { token: "tok-a" });
    assert.equal(r.status, 200);
    const porId = new Map<string, any>(r.json.vendas.map((v: any) => [v.id, v]));
    assert.equal(porId.get(venda.id).comprovante_mensagem_id, prova.id, "a prova com arquivo");
    assert.equal(porId.get(semProva.id).comprovante_mensagem_id, nova.id, "sem prova, o arquivo mais novo da conversa");
    assert.equal(porId.get(confirmada.id).comprovante_mensagem_id, null, "venda já decidida não precisa do botão");
    assert.equal(porId.get(outroContato.id).comprovante_mensagem_id, null, "venda sem conversa");
    // comprovante nunca confirma venda sozinho: continua a confirmar
    assert.equal(porId.get(venda.id).status, "pendente_confirmacao");
    assert.deepEqual((await um(pg, `SELECT status FROM public.vendas WHERE id = $1`, [venda.id])).status, "pendente_confirmacao");
  });

  test("o upload de um comprovante nunca muda o status de nenhuma venda", async () => {
    const antes = await q(pg, `SELECT id, status, valor FROM public.vendas ORDER BY id`);
    const m = await mensagemDoCliente(a.bruno);
    await enviarMidia({ waId: m.waId });
    assert.deepEqual(await q(pg, `SELECT id, status, valor FROM public.vendas ORDER BY id`), antes);
  });
});

describe("90 dias e LGPD", () => {
  const manutencao = () => http("POST", "/api/cron/manutencao", { token: SEGREDO_CRON, corpo: {} });

  test("a manutenção apaga do Storage o comprovante com mais de 90 dias, limpa a coluna e esvazia a fila", async () => {
    const velho = await mensagemDoCliente(a.carla);
    const novo = await mensagemDoCliente(a.carla);
    for (const m of [velho, novo]) assert.equal((await enviarMidia({ waId: m.waId, chatJid: "5565999990003@s.whatsapp.net" })).status, 200);
    await pg.query(`UPDATE public.bot_mensagens SET arquivo_em = now() - interval '91 days' WHERE id = $1`, [velho.id]);
    const caminhoVelho = `${P()}/${a.carla.id}/${velho.id}.jpg`;
    const caminhoNovo = `${P()}/${a.carla.id}/${novo.id}.jpg`;
    assert.ok(guardado(caminhoVelho));

    const r = await manutencao();
    assert.equal(r.status, 200);
    assert.ok(r.json.comprovantes_apagados >= 1);
    assert.equal(guardado(caminhoVelho), undefined, "saiu do Storage");
    assert.ok(guardado(caminhoNovo), "o novo fica");
    assert.equal((await linhaDa(velho.id)).arquivo_path, null);
    assert.equal((await linhaDa(novo.id)).arquivo_path, caminhoNovo);
    assert.deepEqual((await fila()).filter((c: string) => c === caminhoVelho), []);
  });

  test("Storage fora do ar na manutenção: o caminho continua na fila e a próxima rodada apaga", async () => {
    const m = await mensagemDoCliente(a.carla);
    await enviarMidia({ waId: m.waId, chatJid: "5565999990003@s.whatsapp.net" });
    const caminho = `${P()}/${a.carla.id}/${m.id}.jpg`;
    await pg.query(`UPDATE public.bot_mensagens SET arquivo_em = now() - interval '100 days' WHERE id = $1`, [m.id]);

    falso.falhaRemove = true;
    try {
      assert.equal((await manutencao()).status, 200);
    } finally {
      falso.falhaRemove = false;
    }
    assert.ok(guardado(caminho), "ainda no Storage");
    assert.ok((await fila()).includes(caminho), "mas não esquecido");
    assert.equal((await linhaDa(m.id)).arquivo_path, null);

    assert.equal((await manutencao()).status, 200);
    assert.equal(guardado(caminho), undefined);
    assert.ok(!(await fila()).includes(caminho));
  });

  test("a manutenção continua exigindo o segredo do cron", async () => {
    assert.equal((await http("POST", "/api/cron/manutencao", { corpo: {} })).status, 401);
    assert.equal((await http("POST", "/api/cron/manutencao", { token: "tok-a", corpo: {} })).status, 401);
  });

  test("apagar a pessoa (LGPD) tira os comprovantes dela do Storage; os dos outros ficam", async () => {
    const dela = await conversa(pg, a.emp, "5565966661111", "Pessoa da LGPD");
    const outra = await conversa(pg, a.emp, "5565966662222", "Outra Pessoa");
    const m1 = await mensagemDoCliente(dela);
    const m2 = await mensagemDoCliente(dela, "documento");
    const m3 = await mensagemDoCliente(outra);
    assert.equal((await enviarMidia({ waId: m1.waId, chatJid: "5565966661111@s.whatsapp.net" })).status, 200);
    assert.equal((await enviarMidia({ waId: m2.waId, corpo: PDF, mimetype: "application/pdf", chatJid: "5565966661111@s.whatsapp.net" })).status, 200);
    assert.equal((await enviarMidia({ waId: m3.waId, chatJid: "5565966662222@s.whatsapp.net" })).status, 200);
    const c1 = `${P()}/${dela.id}/${m1.id}.jpg`, c2 = `${P()}/${dela.id}/${m2.id}.pdf`, c3 = `${P()}/${outra.id}/${m3.id}.jpg`;

    const r = await http("DELETE", `/api/contatos/${dela.contatoId}`, { token: "tok-a" });
    assert.equal(r.status, 200);
    assert.equal(r.json.apagado, true);
    assert.equal(r.json.comprovantes_com_falha, undefined);
    assert.equal(guardado(c1), undefined);
    assert.equal(guardado(c2), undefined);
    assert.ok(guardado(c3), "o comprovante de outra pessoa não é tocado");
    const f = await fila();
    assert.ok(!f.includes(c1) && !f.includes(c2));
  });

  test("LGPD com o Storage fora do ar: a pessoa some do banco e o arquivo fica na fila para a manutenção", async () => {
    const c = await conversa(pg, a.emp, "5565966663333", "Pessoa com Falha");
    const m = await mensagemDoCliente(c);
    await enviarMidia({ waId: m.waId, chatJid: "5565966663333@s.whatsapp.net" });
    const caminho = `${P()}/${c.id}/${m.id}.jpg`;
    falso.falhaRemove = true;
    let r;
    try {
      r = await http("DELETE", `/api/contatos/${c.contatoId}`, { token: "tok-a" });
    } finally {
      falso.falhaRemove = false;
    }
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.comprovantes_com_falha, [caminho]);
    assert.ok((await fila()).includes(caminho));
    assert.equal((await manutencao()).status, 200);
    assert.equal(guardado(caminho), undefined);
    assert.ok(!(await fila()).includes(caminho));
  });
});
