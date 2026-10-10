// Gera server/ia/contrato-gerado.ts (schema e instruções como constantes, para a Vercel não ler arquivo em
// runtime) e mantém a cópia da rotina em ia/rotina/contrato/. Rodar: npm run gerar:contrato
// O teste testes/servidor/contrato.test.ts refaz esta conta e falha se algum arquivo gerado divergir.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const lerLf = (rel) => readFileSync(join(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const md5 = (t) => createHash("md5").update(t).digest("hex");

export const ARQUIVOS = {
  schema: "ia/contrato/schema.json",
  instrucoes: "ia/contrato/instrucoes-analista.md",
};
export const COPIAS_ROTINA = ["ia/rotina/contrato/schema.json", "ia/rotina/contrato/instrucoes-analista.md"];
export const SAIDA = "server/ia/contrato-gerado.ts";

export function gerarConteudo() {
  const schema = lerLf(ARQUIVOS.schema);
  const instrucoes = lerLf(ARQUIVOS.instrucoes);
  const objeto = JSON.stringify(JSON.parse(schema), null, 2);
  return [
    "// GERADO por ia/contrato/gerar.mjs a partir de ia/contrato/. Não edite: rode `npm run gerar:contrato`.",
    `// md5 schema.json: ${md5(schema)}`,
    `// md5 instrucoes-analista.md: ${md5(instrucoes)}`,
    "",
    `export const SCHEMA_CONTRATO: Record<string, any> = ${objeto};`,
    "",
    `export const INSTRUCOES_ANALISTA: string = ${JSON.stringify(instrucoes)};`,
    "",
  ].join("\n");
}

export function copiasEsperadas() {
  return [
    [COPIAS_ROTINA[0], lerLf(ARQUIVOS.schema)],
    [COPIAS_ROTINA[1], lerLf(ARQUIVOS.instrucoes)],
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(raiz, SAIDA), gerarConteudo());
  for (const [rel, conteudo] of copiasEsperadas()) writeFileSync(join(raiz, rel), conteudo);
  console.log(`gerado ${SAIDA} e ${COPIAS_ROTINA.length} cópias em ia/rotina/contrato/`);
}
