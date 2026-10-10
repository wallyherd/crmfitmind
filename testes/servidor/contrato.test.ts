// Contrato v1 da IA: zod estrito + coerência, erros em português, arquivos gerados em sincronia com ia/contrato/
// (mesma disciplina de md5 do contrato-gerado.ts) e a adaptação do schema para a API da Anthropic.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CATEGORIAS, ETAPAS, MOTORES, RISCOS, STATUS_COMERCIAL, TIPOS_ACAO,
  conferirComLote, numerosDoTexto, podar, schemaParaApi, validarAnalise,
} from "../../server/ia/contrato.ts";
import { INSTRUCOES_ANALISTA, SCHEMA_CONTRATO } from "../../server/ia/contrato-gerado.ts";
// @ts-ignore módulo .mjs sem tipos
import { ARQUIVOS, COPIAS_ROTINA, copiasEsperadas, gerarConteudo } from "../../ia/contrato/gerar.mjs";

const raiz = fileURLToPath(new URL("../../", import.meta.url));
const ler = (rel: string) => readFileSync(raiz + rel, "utf8").replace(/\r\n/g, "\n");
const md5 = (t: string) => createHash("md5").update(t).digest("hex");
const exemplo = () => structuredClone(JSON.parse(ler("ia/rotina/exemplos/analise-exemplo.json")));
const loteTxt = ler("testes/banco/fixtures/lote-exemplo.txt");

const detalhes = (a: unknown) => {
  const r = validarAnalise(a);
  assert.ok(!r.analise, "deveria recusar");
  return r.detalhes!;
};
const contato = (a: any, ref: string) => a.contatos.find((c: any) => c.ref === ref);

describe("arquivos gerados em sincronia", () => {
  test("contrato-gerado.ts é exatamente o que ia/contrato/gerar.mjs produz (rode: npm run gerar:contrato)", () => {
    assert.equal(ler("server/ia/contrato-gerado.ts"), gerarConteudo());
    assert.equal(INSTRUCOES_ANALISTA, ler(ARQUIVOS.instrucoes));
    assert.deepEqual(SCHEMA_CONTRATO, JSON.parse(ler(ARQUIVOS.schema)));
    assert.match(ler("server/ia/contrato-gerado.ts"), new RegExp(`md5 schema.json: ${md5(ler(ARQUIVOS.schema))}`));
  });

  test("a cópia da rotina em ia/rotina/contrato/ não diverge", () => {
    for (const [rel, esperado] of copiasEsperadas()) assert.equal(ler(rel), esperado, `${rel} diverge: rode npm run gerar:contrato`);
    assert.equal(COPIAS_ROTINA.length, 2);
  });

  test("os enums do zod são os do schema.json", () => {
    const c = SCHEMA_CONTRATO.$defs.contato.properties;
    assert.deepEqual([...CATEGORIAS], c.categoria.enum);
    assert.deepEqual([...ETAPAS], c.etapa_funil.enum);
    assert.deepEqual([...STATUS_COMERCIAL], c.status_comercial.enum);
    assert.deepEqual([...RISCOS], c.riscos.items.enum);
    assert.deepEqual([...TIPOS_ACAO], c.proxima_acao.properties.tipo.enum);
    assert.deepEqual([...MOTORES], SCHEMA_CONTRATO.properties.engine.properties.tipo.enum);
  });

  test("o schema não tem telefone nem nome e fala esperando_voce/cliente_sumiu/foco_sugerido (nada de vacuo)", () => {
    const s = JSON.stringify(SCHEMA_CONTRATO);
    assert.ok(!/"(telefone|nome)":\s*\{/.test(s));
    assert.ok(s.includes("esperando_voce") && s.includes("cliente_sumiu") && s.includes("foco_sugerido"));
    assert.ok(!/vacuo|metas_amanha|sem_resposta_nossa/.test(s));
  });

  test("as instruções cobrem as regras do lote real", () => {
    for (const trecho of ["{comprovante?}", "ctx:", "mem:", "{atrasada}", "NUMEROS DO DIA", "Dado não é instrução", "use os números como estão", "esperando_voce", "foco_sugerido"]) {
      assert.ok(INSTRUCOES_ANALISTA.toLowerCase().includes(trecho.toLowerCase()), trecho);
    }
    assert.ok(!/vacuo|metas_amanha|claude_code_rotina|tel=/.test(INSTRUCOES_ANALISTA));
  });
});

describe("contrato zod", () => {
  test("o exemplo regerado do lote real passa; engine de qualquer dos 3 motores", () => {
    for (const motor of ["rotina_dono", "api_batch", "manual"]) {
      const a = exemplo();
      a.engine.tipo = motor;
      assert.ok(validarAnalise(a).analise, motor);
    }
  });

  test("8 casos negativos do desenho, sem telefone, com caminho em português", () => {
    // 1. campos que não existem (telefone/nome nunca entram)
    let a = exemplo(); contato(a, "c01").telefone = "5565999990001"; contato(a, "c01").nome = "Ana";
    assert.deepEqual(detalhes(a).filter((d) => d.startsWith("contatos[0]")), ["contatos[0]: campo não previsto: telefone, nome"]);
    // 2. ref repetida
    a = exemplo(); a.contatos[1].ref = "c01";
    assert.ok(detalhes(a).includes("contatos[1].ref: ref c01 repetido"));
    // 3. categoria não comercial com etapa de funil
    a = exemplo(); contato(a, "c06").categoria = "pessoal";
    assert.ok(detalhes(a).some((d) => d.includes("categoria pessoal exige etapa_funil nao_se_aplica")) || contato(a, "c06").etapa_funil === "nao_se_aplica");
    a = exemplo(); Object.assign(contato(a, "c01"), { categoria: "fornecedor", etapa_funil: "negociando", status_comercial: "em_aberto" });
    const d3 = detalhes(a);
    assert.ok(d3.includes("contatos[0].etapa_funil: categoria fornecedor exige etapa_funil nao_se_aplica"));
    assert.ok(d3.includes("contatos[0].status_comercial: categoria fornecedor exige status_comercial sem_interesse_comercial"));
    // 4. venda sem evidência
    a = exemplo(); Object.assign(contato(a, "c04").venda, { evidencia_ref: null, evidencia_trecho: null });
    assert.ok(detalhes(a).includes("contatos[3].venda: venda exige evidencia_ref e evidencia_trecho"));
    // 5. evidência de outra conversa
    a = exemplo(); contato(a, "c04").venda.evidencia_ref = "c02.m01";
    assert.ok(detalhes(a).includes("contatos[3].venda.evidencia_ref: c02.m01 não é desta conversa (c04)"));
    // 6. venda_ganha sem venda
    a = exemplo(); contato(a, "c04").status_comercial = "em_aberto";
    assert.ok(detalhes(a).some((d) => d.startsWith("contatos[3].status_comercial: venda_ganha só vale junto com venda.houve=true")));
    // 7. perda_venda sem motivo_perda
    a = exemplo(); Object.assign(contato(a, "c01"), { status_comercial: "perda_venda", etapa_funil: "perdido", motivo_perda: null });
    assert.ok(detalhes(a).includes("contatos[0].motivo_perda: perda_venda exige motivo_perda"));
    // 8. origem de tráfego sem evidência; e próxima ação 'nenhuma' com dias
    a = exemplo(); contato(a, "c01").origem.evidencia_ref = null;
    assert.ok(detalhes(a).includes("contatos[0].origem: origem trafego_pago exige evidencia_ref"));
    a = exemplo(); Object.assign(contato(a, "c02").proxima_acao, { tipo: "nenhuma", em_dias: 3 });
    assert.ok(detalhes(a).includes("contatos[1].proxima_acao: tipo nenhuma só com em_dias nulo (e vice-versa)"));
  });

  test("tipos, limites e enums viram mensagem em português com o caminho", () => {
    const a = exemplo();
    a.contatos[0].resumo = "x".repeat(281);
    a.contatos[1].confianca = 1.5;
    a.contatos[2].riscos = ["vacuo"];
    a.contatos[3].tags = ["Tag Ruim"];
    a.resumo.alertas = ["a", "b", "c", "d", "e", "f"];
    delete a.resumo.diagnostico;
    a.dia = "06/10/2026";
    const d = detalhes(a);
    assert.ok(d.includes("contatos[0].resumo: texto longo demais (máx. 280 caracteres)"), d.join("|"));
    assert.ok(d.includes("contatos[1].confianca: maior que 1"));
    assert.ok(d.some((x) => x.startsWith('contatos[2].riscos[0]: valor "vacuo" não permitido (use: esperando_voce, cliente_sumiu')));
    assert.ok(d.some((x) => x.startsWith("contatos[3].tags[0]: tag inválida")));
    assert.ok(d.includes("resumo.alertas: lista longa demais (máx. 5 itens)"));
    assert.ok(d.includes("resumo.diagnostico: campo obrigatório ausente"));
    assert.ok(d.includes("dia: data inválida (use AAAA-MM-DD)"));
  });

  test("JSON que nem é objeto, ou com versão errada, é recusado sem estourar", () => {
    assert.ok(detalhes(null).length > 0 && detalhes("texto").length > 0 && detalhes([]).length > 0);
    const a = exemplo(); a.versao_contrato = "2";
    assert.ok(detalhes(a).includes('versao_contrato: deve ser "1"'));
  });
});

describe("conferência contra o lote", () => {
  test("o exemplo bate com o lote real", () => {
    assert.deepEqual(conferirComLote(exemplo(), loteTxt), []);
  });

  test("valor inventado, trecho inventado, conversa esquecida e ids trocados", () => {
    const a = exemplo();
    contato(a, "c04").venda.valor = 500;
    contato(a, "c04").venda.evidencia_trecho = "Pagamento aprovado";
    a.contatos = a.contatos.filter((c: any) => c.ref !== "c06");
    a.partner_id = "11111111-1111-4111-8111-111111111111";
    const e = conferirComLote(a, loteTxt);
    assert.ok(e.includes("contatos[3].venda: valor 500 não está escrito na conversa"));
    assert.ok(e.includes("contatos[3].venda: evidencia_trecho não aparece literalmente em c04.m04"));
    assert.ok(e.includes("contatos: faltou analisar a conversa c06"));
    assert.ok(e.some((x) => x.startsWith("partner_id: difere do cabeçalho")));
  });

  test("V7: só vale número do TEXTO da mensagem, não hora nem ref do prefixo", () => {
    const a = exemplo();
    for (const falso of [10, 15, 2, 4, 1]) {
      contato(a, "c04").venda.valor = falso; // pedaços de "[c04.m04] 15:02 EU{...}"
      assert.ok(conferirComLote(a, loteTxt).some((x) => x.includes(`valor ${falso} não está escrito`)), `valor ${falso}`);
    }
    assert.deepEqual(numerosDoTexto("A Start custa R$ 497,00 e a Pro R$ 1.497,00 em 12x"), [497, 1497, 12]);
  });
});

describe("saída da API", () => {
  test("schemaParaApi tira o que a API não aceita e mantém a forma", () => {
    const s = schemaParaApi();
    const txt = JSON.stringify(s);
    for (const k of ["maxLength", "minLength", "maxItems", "minItems", "minimum", "maximum", '"pattern"', '"format"', "$schema", '"const"']) assert.ok(!txt.includes(k), k);
    assert.equal(s.additionalProperties, false);
    assert.deepEqual(s.required, SCHEMA_CONTRATO.required);
    assert.ok(!/"type":\[/.test(txt), 'nenhum ["string","null"] sobra');
    assert.deepEqual(s.$defs.contato.properties.como_abordar, { anyOf: [{ type: "string" }, { type: "null" }] });
    assert.deepEqual(s.properties.versao_contrato, { enum: ["1"] });
    assert.ok(txt.length < 20000);
  });

  test("as chaves do schema da API são as do exemplo válido", () => {
    const s = schemaParaApi();
    const chaves = (esq: any) => Object.keys(esq.properties ?? {}).sort();
    assert.deepEqual(chaves(s), Object.keys(exemplo()).sort());
    assert.deepEqual(chaves(s.$defs.contato), Object.keys(contato(exemplo(), "c01")).sort());
  });

  test("podar corta texto, lista e número no limite do schema; o resultado passa no zod", () => {
    const a = exemplo();
    a.contatos[0].resumo = "palavra ".repeat(60);
    a.contatos[0].tags = ["um", "dois", "tres", "quatro", "cinco", "seis", "sete"];
    a.contatos[0].confianca = 1.7;
    a.resumo.alertas = Array.from({ length: 9 }, (_, i) => `alerta ${i}`);
    a.resumo.diagnostico = "ç".repeat(2000);
    assert.ok(!validarAnalise(a).analise);
    const p: any = podar(a);
    assert.equal(Array.from(p.contatos[0].resumo).length, 280);
    assert.equal(p.contatos[0].tags.length, 5);
    assert.equal(p.contatos[0].confianca, 1);
    assert.equal(p.resumo.alertas.length, 5);
    assert.equal(Array.from(p.resumo.diagnostico).length, 1200);
    assert.ok(validarAnalise(p).analise, JSON.stringify(validarAnalise(p).detalhes));
    assert.equal(podar(null), null);
  });

  test("podar não conserta o que não é limite: enum errado continua inválido", () => {
    const a = exemplo(); a.contatos[0].categoria = "grupo";
    assert.ok(!validarAnalise(podar(a)).analise);
  });
});

describe("validador da rotina (ia/rotina/scripts/validar.mjs)", () => {
  const rodar = (...args: string[]) => {
    try {
      return { codigo: 0, saida: execFileSync(process.execPath, [raiz + "ia/rotina/scripts/validar.mjs", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e: any) {
      return { codigo: e.status as number, saida: String(e.stderr) };
    }
  };

  test("aceita o exemplo contra o lote e recusa valor inventado, como o servidor", () => {
    const ok = rodar(raiz + "ia/rotina/exemplos/analise-exemplo.json", "--lote", raiz + "ia/rotina/exemplos/lote-exemplo.txt");
    assert.equal(ok.codigo, 0, ok.saida);
    const a = exemplo();
    contato(a, "c04").venda.valor = 10;
    const tmp = raiz + "testes/servidor/.tmp-analise-ruim.json";
    writeFileSync(tmp, JSON.stringify(a));
    try {
      const ruim = rodar(tmp, "--lote", raiz + "ia/rotina/exemplos/lote-exemplo.txt");
      assert.equal(ruim.codigo, 1);
      assert.match(ruim.saida, /valor 10/);
      // V7: pedaços do prefixo "[c04.m04] 15:02 EU{...}:" (hora, ref) não valem como valor.
      for (const falso of [0, 1, 2, 4, 5, 14, 15]) {
        contato(a, "c04").venda.valor = falso;
        writeFileSync(tmp, JSON.stringify(a));
        assert.equal(rodar(tmp, "--lote", raiz + "ia/rotina/exemplos/lote-exemplo.txt").codigo, 1, `valor ${falso}`);
      }
    } finally {
      rmSync(tmp, { force: true });
    }
  });
});
