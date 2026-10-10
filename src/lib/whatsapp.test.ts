// Roda com: node --test src/lib/whatsapp.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  descreverMensagem,
  diaAnterior,
  estaPareando,
  formatarCodigoPareamento,
  formatarMomento,
  formatarTelefone,
  linkWhatsApp,
  listaDeConexoes,
  mensagemErroDownload,
  nomeDoArquivo,
  normalizarOpcoes,
  ontem,
  ordenarMensagens,
  privacidadeDaConversa,
  resumoAnuncio,
  roboLigado,
  rotuloAutor,
  telefoneDaConversa,
  pareamentoAndando,
  telefoneParaEnvio,
  telefoneParaPareamento,
  temAnuncio,
  tituloDaConversa,
  vistoHa,
} from "./whatsapp.ts";
import type { ConexaoPainel, Conversa, Mensagem } from "../types/index.ts";

const conversa = (extra: Partial<Conversa> = {}): Conversa => ({
  id: "c1",
  conexao_id: "x1",
  telefone: "5565999990000",
  nome: null,
  fluxo_id: null,
  passo_atual_id: null,
  estado: "bot",
  cartao_id: null,
  ultima_mensagem_em: null,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
  jid: "5565999990000@s.whatsapp.net",
  ...extra,
});

const mensagem = (extra: Partial<Mensagem> = {}): Mensagem => ({
  id: "m1",
  conversa_id: "c1",
  direcao: "entrada",
  tipo: "texto",
  corpo: "oi",
  status: "recebida",
  created_at: "2026-10-01T10:00:00Z",
  ...extra,
});

test("telefone: +55 com DDD, wa.me só com dígitos", () => {
  assert.equal(formatarTelefone("5565999990000"), "+55 65 99999-0000");
  assert.equal(formatarTelefone("556533334444"), "+55 65 3333-4444");
  assert.equal(formatarTelefone("14155550123"), "+14155550123");
  assert.equal(formatarTelefone(null), "");
  assert.equal(linkWhatsApp("+55 (65) 99999-0000"), "https://wa.me/5565999990000");
  assert.equal(linkWhatsApp(""), null);
});

test("conversa: telefone some em grupo e em contato só por LID; título cai para o número", () => {
  assert.equal(telefoneDaConversa(conversa()), "5565999990000");
  assert.equal(telefoneDaConversa(conversa({ telefone: null, telefone_confirmado: false, jid: "1038@lid" })), null);
  assert.equal(telefoneDaConversa(conversa({ tipo: "grupo", telefone: null, jid: "1203@g.us" })), null);
  // Linha anterior à 002, sem a coluna: o telefone gravado vale.
  assert.equal(telefoneDaConversa(conversa({ telefone_confirmado: undefined })), "5565999990000");

  assert.equal(tituloDaConversa(conversa({ nome: "João" })), "João");
  assert.equal(tituloDaConversa(conversa()), "+55 65 99999-0000");
  assert.equal(tituloDaConversa(conversa({ telefone: null, telefone_confirmado: false })), "Contato sem número");
  assert.equal(tituloDaConversa(conversa({ tipo: "grupo", grupo_nome: "Turma 3" })), "Turma 3");
});

test("mídia vira texto: [áudio 0:42], [imagem: legenda]", () => {
  assert.equal(descreverMensagem(mensagem({ tipo: "audio", corpo: null, midia: { duracaoSeg: 42, ptt: true } })), "[áudio 0:42]");
  assert.equal(descreverMensagem(mensagem({ tipo: "imagem", corpo: "cardápio" })), "[imagem: cardápio]");
  assert.equal(descreverMensagem(mensagem({ tipo: "video", corpo: null, midia: { duracaoSeg: 3725 } })), "[vídeo 1:02:05]");
  assert.equal(
    descreverMensagem(mensagem({ tipo: "documento", corpo: "segue", midia: { nomeArquivo: "plano.pdf" } })),
    "[documento plano.pdf: segue]"
  );
  assert.equal(descreverMensagem(mensagem({ tipo: "outro", corpo: null, midia: { visualizacaoUnica: true } })), "[visualização única]");
  assert.equal(descreverMensagem(mensagem({ tipo: "texto", corpo: null })), "[texto não registrado]");
  assert.equal(descreverMensagem(mensagem({ tipo: "reacao", corpo: "👍" })), "[reação: 👍]");
});

test("autor: Você / Robô / CRM / Cliente / participante, e linhas sem a coluna autor", () => {
  assert.equal(rotuloAutor(mensagem({ direcao: "saida", autor: "humano", status: "enviada" }), false), "Você");
  assert.equal(rotuloAutor(mensagem({ direcao: "saida", autor: "bot", status: "enviada" }), false), "Robô");
  assert.equal(rotuloAutor(mensagem({ direcao: "saida", autor: "crm", status: "enviada" }), false), "CRM");
  assert.equal(rotuloAutor(mensagem({ autor: "cliente" }), false), "Cliente");
  assert.equal(rotuloAutor(mensagem({ participante_nome: "Ana" }), true), "Ana");
  assert.equal(rotuloAutor(mensagem({ participante_telefone: "5565988887777" }), true), "+55 65 98888-7777");
  // Antes da 002: deduz como a migração.
  assert.equal(rotuloAutor(mensagem({ direcao: "saida", enviada_por: "p1", status: "enviada" }), false), "CRM");
  assert.equal(rotuloAutor(mensagem({ direcao: "saida", disparo_id: "d1", status: "enviada" }), false), "Campanha");
  assert.equal(rotuloAutor(mensagem({ direcao: "saida", status: "enviada" }), false), "Robô");
});

test("ordem pela hora do WhatsApp, não pela hora em que o CRM gravou", () => {
  const historico = mensagem({ id: "h", wa_em: "2026-09-30T09:00:00Z", created_at: "2026-10-01T12:00:00Z" });
  const nova = mensagem({ id: "n", created_at: "2026-10-01T11:00:00Z" });
  assert.deepEqual(ordenarMensagens([nova, historico]).map((m) => m.id), ["h", "n"]);
});

test("datas: hora no fuso pedido, ontem e virada de mês", () => {
  const agora = new Date("2026-10-08T15:00:00Z");
  assert.equal(formatarMomento("2026-10-08T13:05:00Z", agora, "America/Cuiaba"), "09:05");
  assert.equal(formatarMomento("2026-10-03T13:05:00Z", agora, "America/Cuiaba"), "03/10 09:05");
  assert.equal(formatarMomento("2025-12-31T23:59:00Z", agora, "America/Cuiaba"), "31/12/2025 19:59");
  assert.equal(formatarMomento(null, agora), "");
  assert.equal(ontem(new Date("2026-10-08T02:00:00Z"), "America/Cuiaba"), "2026-10-06");
  assert.equal(diaAnterior("2026-03-01"), "2026-02-28");
  assert.equal(diaAnterior("2026-01-01"), "2025-12-31");
});

test("visto há X min", () => {
  const agora = new Date("2026-10-08T15:00:00Z");
  assert.equal(vistoHa(null, agora), "nunca visto");
  assert.equal(vistoHa("2026-10-08T14:59:40Z", agora), "visto agora");
  assert.equal(vistoHa("2026-10-08T14:48:00Z", agora), "visto há 12 min");
  assert.equal(vistoHa("2026-10-08T12:00:00Z", agora), "visto há 3 h");
  assert.equal(vistoHa("2026-10-06T12:00:00Z", agora), "visto há 2 dias");
});

test("opções: padrão histórico 7, grupos nenhum, robô desligado; corta fora de 0..30", () => {
  assert.deepEqual(normalizarOpcoes(null), { gruposPermitidos: [], historicoDias: 7, botAtivo: false });
  assert.deepEqual(normalizarOpcoes({ historicoDias: 90, botAtivo: "true", gruposPermitidos: ["a@g.us", "5565@s.whatsapp.net", 3] }), {
    gruposPermitidos: ["a@g.us"],
    historicoDias: 30,
    botAtivo: false,
  });
  assert.equal(normalizarOpcoes({ historicoDias: -2 }).historicoDias, 0);
  assert.equal(normalizarOpcoes({ historicoDias: 0, botAtivo: true }).historicoDias, 0);
  assert.equal(normalizarOpcoes({ botAtivo: true }).botAtivo, true);
});

test("lista de conexões aceita array ou {conexoes} e preenche o que falta", () => {
  const bruto = [{ id: "a", status: "aguardando_qr", modo: "gateway", pareamento: { estado: "aguardando_qr", qr: "2@x" } }, { nome: "sem id" }];
  for (const resposta of [bruto, { conexoes: bruto }]) {
    const lista = listaDeConexoes(resposta);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].nome, "WhatsApp");
    assert.equal(lista[0].pareamento?.qr, "2@x");
    assert.deepEqual(lista[0].grupos_disponiveis, []);
  }
  assert.equal(listaDeConexoes({ conexoes: [{ id: "b", status: "inventado" }] })[0].status, "desconectado");
  assert.deepEqual(listaDeConexoes(null), []);
});

test("pareando: aguardando, pedido recente; não quando conectou, expirou ou ficou velho", () => {
  const agora = new Date("2026-10-08T15:00:00Z");
  const base: ConexaoPainel = listaDeConexoes([{ id: "a" }])[0];
  const com = (extra: Partial<ConexaoPainel>) => ({ ...base, ...extra });
  assert.equal(estaPareando(com({ status: "aguardando_codigo" }), agora), true);
  assert.equal(estaPareando(com({ status: "conectado", pareamento: { estado: "solicitado" } }), agora), false);
  assert.equal(
    estaPareando(com({ pareamento: { estado: "solicitado", atualizadoEm: "2026-10-08T14:59:00Z" } }), agora),
    true
  );
  assert.equal(
    estaPareando(com({ pareamento: { estado: "solicitado", atualizadoEm: "2026-10-08T14:40:00Z" } }), agora),
    false
  );
  assert.equal(
    estaPareando(
      com({ status: "aguardando_qr", pareamento: { estado: "aguardando_qr", atualizadoEm: "2026-10-08T14:30:00Z" } }),
      agora
    ),
    false
  );
  assert.equal(
    estaPareando(com({ status_detalhe: "pareamento_expirou", pareamento: { estado: "solicitado" } }), agora),
    false
  );
  assert.equal(estaPareando(com({ pareamento: { estado: "expirado" } }), agora), false);
  assert.equal(estaPareando(base, agora), false);
});

test("código e telefone do pareamento", () => {
  assert.equal(formatarCodigoPareamento("abcd1234"), "ABCD-1234");
  assert.equal(formatarCodigoPareamento("ABCD-1234"), "ABCD-1234");
  assert.equal(telefoneParaPareamento("(65) 99999-0000"), "5565999990000");
  assert.equal(telefoneParaPareamento("+55 65 99999-0000"), "5565999990000");
  assert.equal(telefoneParaPareamento("+1 415 555 0123"), "14155550123");
  assert.equal(telefoneParaPareamento("9999"), null);
});

test("telefone enviado ao servidor: o '+' do número estrangeiro não se perde", () => {
  assert.equal(telefoneParaEnvio("+1 415 555 1234"), "+14155551234");
  assert.equal(telefoneParaEnvio("+352 621 123 456"), "+352621123456");
  assert.equal(telefoneParaEnvio("(65) 99999-0000"), "5565999990000");
  assert.equal(telefoneParaEnvio("+123"), null);
});

test("pareamento 'solicitado' ainda não é pareamento andando; QR ou código gerado é", () => {
  const base: any = { status: "desconectado", pareamento: { estado: "solicitado", qr: null, codigo: null, atualizadoEm: null } };
  assert.equal(pareamentoAndando(base), false);
  assert.equal(pareamentoAndando({ ...base, status: "aguardando_qr" }), true);
  assert.equal(pareamentoAndando({ ...base, pareamento: { ...base.pareamento, codigo: "ABCD1234" } }), true);
});

test("robô ligado: coluna, opções ou desconhecido", () => {
  assert.equal(roboLigado({ bot_ativo: true, opcoes: null }), true);
  assert.equal(roboLigado({ bot_ativo: undefined, opcoes: { botAtivo: false } }), false);
  assert.equal(roboLigado({ bot_ativo: undefined, opcoes: undefined }), null);
  assert.equal(roboLigado(null), null);
});

test("anúncio: selo só com algum dado; resumo com título e URL", () => {
  assert.equal(temAnuncio(null), false);
  assert.equal(temAnuncio({ titulo: "" }), false);
  assert.equal(temAnuncio({ ctwaClid: "Afc" }), true);
  assert.equal(
    resumoAnuncio({ titulo: "Plano trimestral", sourceUrl: "https://fb.me/x", entryPointConversionApp: "instagram" }),
    "Plano trimestral — https://fb.me/x — via instagram"
  );
  assert.equal(resumoAnuncio({ ctwaClid: "Afc" }), "Veio de um anúncio");
});

test("privacidade: coluna nova ou a antiga 'ignorar'", () => {
  assert.equal(privacidadeDaConversa({ privacidade: "so_metadados" }), "so_metadados");
  assert.equal(privacidadeDaConversa({ privacidade: undefined, ignorar: true }), "ignorar");
  assert.equal(privacidadeDaConversa({}), "normal");
});

test("download: nome do Content-Disposition e mensagens de erro", () => {
  assert.equal(
    nomeDoArquivo(`attachment; filename="x.txt"; filename*=UTF-8''conversas%20completas%202026-10-07.txt`, "p.txt"),
    "conversas completas 2026-10-07.txt"
  );
  assert.equal(nomeDoArquivo(`attachment; filename="dia-2026-10-07.txt"`, "p.txt"), "dia-2026-10-07.txt");
  assert.equal(nomeDoArquivo(`attachment; filename="../../etc/passwd"`, "p.txt"), ".._.._etc_passwd");
  assert.equal(nomeDoArquivo(null, "p.txt"), "p.txt");
  assert.equal(mensagemErroDownload(403, "sem_acesso"), "Você não tem acesso a esta empresa.");
  assert.equal(mensagemErroDownload(404), "Nada encontrado para baixar.");
  assert.equal(mensagemErroDownload(500), "Não foi possível baixar (erro 500).");
});
