// O crash da Vercel: com "type":"module", import relativo sem .js dá ERR_MODULE_NOT_FOUND
// e a função inteira cai (até /api/health). Aqui compila server/ + api/ como a Vercel
// roda e importa o api/index.js gerado com o Node puro, sem tsx.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('api/index.js compilado carrega no Node (ESM) e responde', { timeout: 180_000 }, () => {
  // Dentro de testes/: o node_modules da raiz e o "type":"module" valem para a saída.
  const saida = mkdtempSync(path.join(raiz, 'testes', '.esm-'));
  try {
    const tsc = spawnSync(process.execPath, [
      path.join(raiz, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p', path.join(raiz, 'tsconfig.servidor.json'), '--outDir', saida,
    ], { encoding: 'utf8' });
    assert.equal(tsc.status, 0, `tsc falhou:\n${tsc.stdout}${tsc.stderr}`);
    const entrada = path.join(saida, 'api', 'index.js');
    assert.ok(existsSync(entrada), 'api/index.js não foi gerado');

    const roteiro = `
      const { default: app } = await import(${JSON.stringify(pathToFileURL(entrada).href)});
      if (typeof app !== 'function') throw new Error('export default não é o app express');
      const srv = app.listen(0, '127.0.0.1');
      await new Promise((ok) => srv.once('listening', ok));
      const base = 'http://127.0.0.1:' + srv.address().port;
      const saude = await fetch(base + '/api/health');
      const dados = await fetch(base + '/api/data');
      srv.close();
      console.log(JSON.stringify({ saude: saude.status, dados: dados.status }));
    `;
    const node = spawnSync(process.execPath, ['--input-type=module', '-e', roteiro], {
      encoding: 'utf8',
      env: { ...process.env, SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_ROLE_KEY: 'x', VERCEL: '1' },
    });
    assert.doesNotMatch(node.stderr, /ERR_MODULE_NOT_FOUND|ERR_UNSUPPORTED_DIR_IMPORT/);
    assert.equal(node.status, 0, node.stderr);
    assert.deepEqual(JSON.parse(node.stdout.trim().split('\n').pop()), { saude: 200, dados: 401 });
  } finally {
    rmSync(saida, { recursive: true, force: true });
  }
});
