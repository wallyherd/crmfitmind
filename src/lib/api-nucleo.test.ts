// Roda com: node --test src/lib/api-nucleo.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { criarClienteApi, comQuery, ErroApi, MENSAGEM_SAIDA, type MotivoSaida } from "./api-nucleo.ts";

type Chamada = { url: string; headers: Headers; body: unknown };

function montar(resposta: () => Response, token: string | null = "tok-123") {
  const chamadas: Chamada[] = [];
  let saidas = 0;
  const motivos: MotivoSaida[] = [];
  const cliente = criarClienteApi({
    obterToken: async () => token,
    sair: async () => {
      saidas++;
    },
    fetch: async (url, init) => {
      chamadas.push({ url, headers: new Headers(init?.headers), body: init?.body });
      return resposta();
    },
  });
  cliente.aoPerderAcesso((m) => motivos.push(m));
  return { cliente, chamadas, motivos, saidas: () => saidas };
}

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

test("injeta o Bearer da sessão e o Content-Type de corpo JSON", async () => {
  const { cliente, chamadas } = montar(() => json(200, { ok: true }));
  await cliente.apiFetch("/api/data", { method: "POST", body: JSON.stringify({ a: 1 }) });
  assert.equal(chamadas[0].headers.get("Authorization"), "Bearer tok-123");
  assert.equal(chamadas[0].headers.get("Content-Type"), "application/json");
});

test("sem sessão não inventa Authorization", async () => {
  const { cliente, chamadas } = montar(() => json(200, {}), null);
  await cliente.apiFetch("/api/health");
  assert.equal(chamadas[0].headers.has("Authorization"), false);
});

test("401 sem token enviado não dispara aviso de sessão expirada", async () => {
  const { cliente, motivos, saidas } = montar(() => json(401, { erro: "sessao invalida" }), null);
  await cliente.apiFetch("/api/data");
  assert.equal(saidas(), 0);
  assert.deepEqual(motivos, []);
});

test("401 em chamadas paralelas encerra a sessão uma vez só", async () => {
  const { cliente, motivos, saidas } = montar(() => json(401, { erro: "sessao invalida" }));
  await Promise.all([cliente.apiFetch("/api/data"), cliente.apiFetch("/api/me"), cliente.apiFetch("/api/data")]);
  assert.equal(saidas(), 1);
  assert.deepEqual(motivos, ["sessao_expirada"]);
});

test("403 acesso_expirado derruba a sessão com a mensagem do mentor", async () => {
  const { cliente, motivos, saidas } = montar(() => json(403, { erro: "acesso_expirado" }));
  await assert.rejects(cliente.apiJson("/api/me"), { message: MENSAGEM_SAIDA.acesso_expirado });
  assert.equal(saidas(), 1);
  assert.deepEqual(motivos, ["acesso_expirado"]);
  assert.match(MENSAGEM_SAIDA.acesso_expirado, /fale com o mentor/);
});

test("403 conta_inativa também derruba a sessão", async () => {
  const { cliente, motivos } = montar(() => json(403, { erro: "conta_inativa" }));
  await cliente.apiFetch("/api/me");
  assert.deepEqual(motivos, ["conta_inativa"]);
});

test("403 sem_acesso não desloga, só vira erro legível", async () => {
  const { cliente, motivos, saidas } = montar(() => json(403, { erro: "sem_acesso" }));
  await assert.rejects(cliente.apiJson("/api/data?partnerId=x"), { message: "Você não tem acesso a esta empresa." });
  assert.equal(saidas(), 0);
  assert.deepEqual(motivos, []);
});

test("erro sem JSON (ex.: 500 em HTML) vira 'Erro 500'", async () => {
  const { cliente } = montar(() => new Response("<html>quebrou</html>", { status: 500 }));
  await assert.rejects(cliente.apiJson("/api/data"), { message: "Erro 500" });
});

test("comQuery ignora parâmetros vazios e codifica valores", () => {
  assert.equal(comQuery("/api/data", { partnerId: "a b", quadroId: undefined }), "/api/data?partnerId=a+b");
  assert.equal(comQuery("/api/data", { partnerId: null }), "/api/data");
});

test("422 do contrato vira ErroApi com status e a lista de detalhes", async () => {
  const { cliente, saidas } = montar(() =>
    json(422, { erro: "contrato_invalido", detalhes: ["contatos.0.resumo: texto longo demais"] }),
  );
  const erro = await cliente.apiJson("/api/ia/resultado", { method: "POST", body: "{}" }).catch((e) => e);
  assert.ok(erro instanceof ErroApi);
  assert.equal(erro.status, 422);
  assert.equal(erro.codigo, "contrato_invalido");
  assert.deepEqual(erro.detalhes, ["contatos.0.resumo: texto longo demais"]);
  assert.equal(saidas(), 0);
});
