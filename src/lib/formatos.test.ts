// Roda com: node --test src/lib/formatos.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  brl,
  dataBr,
  duracaoMin,
  extrairJson,
  haQuantoTempo,
  intervaloDoFiltro,
  lerValor,
  linkWhatsApp,
  metaBatida,
  numeroWhatsApp,
  ontemIso,
  paresOrdenados,
  prazoDaAcao,
  progressoMeta,
  somarDias,
  telefoneLegivel,
  hojeNoFuso,
} from "./formatos.ts";
import { rotulo, RISCOS } from "./rotulos.ts";

const agora = new Date(2026, 9, 7, 9, 30); // 07/10/2026, hora local

test("ontem e somarDias atravessam mês e ano sem erro de fuso", () => {
  assert.equal(ontemIso(agora), "2026-10-06");
  assert.equal(ontemIso(new Date(2026, 0, 1, 0, 5)), "2025-12-31");
  assert.equal(somarDias("2026-03-01", -1), "2026-02-28");
});

test("filtros da aba Vendas: hoje, 7 dias (com hoje) e mês corrente", () => {
  assert.deepEqual(intervaloDoFiltro("hoje", agora), { de: "2026-10-07", ate: "2026-10-07" });
  assert.deepEqual(intervaloDoFiltro("7d", agora), { de: "2026-10-01", ate: "2026-10-07" });
  assert.deepEqual(intervaloDoFiltro("mes", agora), { de: "2026-10-01", ate: "2026-10-07" });
});

test("link do WhatsApp: põe 55 quando falta, codifica o texto e recusa número curto", () => {
  assert.equal(numeroWhatsApp("(65) 99999-0002"), "5565999990002");
  assert.equal(numeroWhatsApp("5565999990002"), "5565999990002");
  assert.equal(numeroWhatsApp("1234"), null);
  assert.equal(numeroWhatsApp(null), null);
  assert.equal(
    linkWhatsApp("5565999990002", "Oi Ana, tudo bem? R$ 497 & PIX"),
    "https://wa.me/5565999990002?text=Oi%20Ana%2C%20tudo%20bem%3F%20R%24%20497%20%26%20PIX",
  );
  assert.equal(linkWhatsApp("5565999990002", "  "), "https://wa.me/5565999990002");
  assert.equal(linkWhatsApp(null, "oi"), null);
});

test("telefone legível tira o 55 e põe máscara", () => {
  assert.equal(telefoneLegivel("5565999990002"), "(65) 99999-0002");
  assert.equal(telefoneLegivel("6533221100"), "(65) 3322-1100");
  assert.equal(telefoneLegivel("abc"), "abc");
});

test("valor digitado em reais", () => {
  assert.equal(lerValor("R$ 1.234,50"), 1234.5);
  assert.equal(lerValor("497"), 497);
  assert.equal(lerValor("97.5"), 97.5);
  assert.equal(lerValor("1.500"), 1500);
  assert.equal(lerValor("-3"), null);
  assert.equal(lerValor("abc"), null);
  assert.equal(lerValor(""), null);
});

test("JSON colado do Claude: com bloco de código, com texto em volta, ou nada", () => {
  const json = '{"versao_contrato":"1","contatos":[]}';
  assert.equal(extrairJson("```json\n" + json + "\n```"), json);
  assert.equal(extrairJson("Aqui está:\n" + json + "\nPronto."), json);
  assert.equal(extrairJson("sem json nenhum"), null);
});

test("tempos e prazos em português", () => {
  assert.equal(duracaoMin(4), "4 min");
  assert.equal(duracaoMin(99), "1h 39min");
  assert.equal(duracaoMin(120), "2h");
  assert.equal(duracaoMin(null), "—");
  assert.equal(haQuantoTempo(0.4), "há 24 min");
  assert.equal(haQuantoTempo(5.2), "há 5 h");
  assert.equal(haQuantoTempo(72), "há 3 dias");
  // relatório de ontem (06/10), hoje é 07/10
  assert.equal(prazoDaAcao("2026-10-06", 0, agora), "hoje");
  assert.equal(prazoDaAcao("2026-10-06", 1, agora), "amanhã");
  assert.equal(prazoDaAcao("2026-10-06", 5, agora), "até 12/10");
  assert.equal(prazoDaAcao("2026-10-01", 1, agora), "venceu em 03/10");
  assert.equal(prazoDaAcao("2026-10-06", null, agora), "");
  assert.equal(dataBr("2026-10-05"), "05/10/2026");
  assert.equal(dataBr(new Date(2026, 9, 5, 23, 50).toISOString()), "05/10/2026"); // hora local, não UTC
  assert.equal(dataBr(null), "—");
});

test("dinheiro em reais", () => {
  assert.equal(brl(497).replace(/\s/g, " "), "R$ 497,00");
  assert.equal(brl(null), "—");
});

test("metas: tempo de resposta é teto, as outras são piso", () => {
  assert.equal(metaBatida("vendas_qtd", 4, 4), true);
  assert.equal(metaBatida("vendas_qtd", 4, 3), false);
  assert.equal(metaBatida("tempo_resposta_min", 10, 8), true);
  assert.equal(metaBatida("tempo_resposta_min", 10, 25), false);
  assert.equal(metaBatida("followups", 5, null), false);
  assert.equal(progressoMeta("vendas_qtd", 4, 2), 50);
  assert.equal(progressoMeta("vendas_qtd", 4, 9), 100);
  assert.equal(progressoMeta("tempo_resposta_min", 10, 20), 50);
});

test("totais por forma/origem aceitam número ou {valor} e vêm do maior para o menor", () => {
  assert.deepEqual(paresOrdenados({ pix: 100, cartao: { valor: 300 }, boleto: 0 }), [
    ["cartao", 300],
    ["pix", 100],
  ]);
  assert.deepEqual(paresOrdenados(null), []);
});

test("rótulo conhecido e desconhecido", () => {
  assert.equal(rotulo(RISCOS, "esperando_voce"), "Esperando você");
  assert.equal(rotulo(RISCOS, "algo_novo"), "Algo novo");
  assert.equal(rotulo(RISCOS, null), "—");
});

test("hojeNoFuso: à 0h30 de São Paulo ainda é ontem em Cuiabá (achado 12)", () => {
  const agora = new Date("2026-10-08T03:30:00Z"); // 00:30 em São Paulo, 23:30 em Cuiabá (UTC-4)
  assert.equal(hojeNoFuso("America/Cuiaba", agora), "2026-10-07");
  assert.equal(hojeNoFuso("America/Sao_Paulo", agora), "2026-10-08");
});
