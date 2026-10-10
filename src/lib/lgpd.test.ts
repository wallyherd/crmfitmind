// Roda com: node --test src/lib/lgpd.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { desfechoDaResposta, frasePronta, mensagemDeErroApagar, podeApagarDados } from "./lgpd.ts";

test("só a palavra APAGAR exata (com espaços nas pontas) libera", () => {
  assert.equal(frasePronta("APAGAR"), true);
  assert.equal(frasePronta("  APAGAR "), true);
  assert.equal(frasePronta("apagar"), false);
  assert.equal(frasePronta("APAGAR TUDO"), false);
  assert.equal(frasePronta(""), false);
});

test("botão só para o dono da empresa aberta e com contato conhecido", () => {
  assert.equal(podeApagarDados(["e1"], "e1", "c1"), true);
  assert.equal(podeApagarDados(["e1"], "e2", "c1"), false);
  assert.equal(podeApagarDados(["e1"], "e1", null), false);
  assert.equal(podeApagarDados(undefined, "e1", "c1"), false);
  assert.equal(podeApagarDados([], null, "c1"), false);
});

test("desfecho: sucesso, aviso de arquivos e pessoa que já não existia", () => {
  assert.equal(desfechoDaResposta({ ok: true, apagado: true }).tipo, "sucesso");
  const aviso = desfechoDaResposta({ ok: true, apagado: true, arquivos_com_falha: ["a.txt", "b.txt"] });
  assert.equal(aviso.tipo, "aviso");
  assert.match(aviso.mensagem, /2 arquivos/);
  assert.equal(desfechoDaResposta({ ok: true, apagado: true, arquivos_com_falha: ["a.txt"] }).mensagem.includes("1 arquivo "), true);
  assert.equal(desfechoDaResposta({ ok: true, apagado: false }).tipo, "info");
  assert.equal(desfechoDaResposta(null).tipo, "info");
});

test("erros: 403 so_o_dono, 404 e genérico", () => {
  assert.match(mensagemDeErroApagar({ status: 403, codigo: "so_o_dono" }), /dono da empresa/);
  assert.match(mensagemDeErroApagar({ status: 403, codigo: "sem_permissao_conteudo" }), /não liberou/);
  assert.match(mensagemDeErroApagar({ status: 404, codigo: "nao_encontrado" }), /não foi encontrada/);
  assert.equal(mensagemDeErroApagar({ status: 500, message: "Erro 500" }), "Erro 500");
  assert.match(mensagemDeErroApagar(null), /Tente de novo/);
});
