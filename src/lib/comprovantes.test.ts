// Roda com: node --test src/lib/comprovantes.test.ts  (Node >= 23.6 executa TypeScript direto)
import { test } from "node:test";
import assert from "node:assert/strict";
import { rotuloDoArquivo, tipoDoArquivo } from "./comprovantes-rotulos.ts";

test("o tipo sai da extensão do caminho guardado", () => {
  assert.equal(tipoDoArquivo("emp/conv/3EB0ABC.pdf"), "pdf");
  assert.equal(tipoDoArquivo("emp/conv/3EB0ABC.PDF"), "pdf");
  for (const ext of ["jpg", "png", "webp"]) assert.equal(tipoDoArquivo(`emp/conv/3EB0ABC.${ext}`), "imagem");
  assert.equal(tipoDoArquivo(null), null);
  assert.equal(tipoDoArquivo(undefined), null);
  assert.equal(tipoDoArquivo(""), null);
});

test("o rótulo do botão", () => {
  assert.equal(rotuloDoArquivo("pdf"), "Ver PDF");
  assert.equal(rotuloDoArquivo("imagem"), "Ver imagem");
  assert.equal(rotuloDoArquivo(null), "Ver imagem");
});
