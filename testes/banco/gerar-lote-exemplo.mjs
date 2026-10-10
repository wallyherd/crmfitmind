// Gera testes/banco/fixtures/lote-exemplo.txt a partir do SQL da 003 (o
// cenário de cenario-fase23.mjs), para as instruções e exemplos da IA.
// Uso: cd testes && node banco/gerar-lote-exemplo.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bancoFase23, montarCenario, montarLote } from './cenario-fase23.mjs';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const db = await bancoFase23();
const c = await montarCenario(db);
const r = await montarLote(db, c.p);
mkdirSync(path.join(aqui, 'fixtures'), { recursive: true });
writeFileSync(path.join(aqui, 'fixtures', 'lote-exemplo.txt'), r.partes[0].texto);
console.log(`lote-exemplo.txt: ${r.partes[0].texto.split('\n').length} linhas, dia ${r.dia}`);
