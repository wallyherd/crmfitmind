// gateway.mjs — o processo do VPS: mantém uma sessão do WhatsApp por mentorado.
//
//   node gateway.mjs
//
// Variáveis (LEIA-ME.md):
//   CRM_BASE          endereço do CRM (https://...). Fixo: não muda pela rede.
//   GATEWAY_SECRET    segredo compartilhado com o CRM (>= 32 caracteres) para as assinaturas HMAC
//   GATEWAY_PORTA     porta do POST /acordar (padrão 8080)
//   GATEWAY_HOST      onde escutar (padrão 127.0.0.1; no Docker, 0.0.0.0 atrás do Caddy)
//   DADOS_DIR         pasta das sessões (padrão ./dados)
//   SESSAO_MEMORIA_MB heap de cada sessão (padrão 512, por causa do 1º histórico)
//
// O que ele faz:
//   - a cada 60 s (e a cada campainha) lê GET /api/gateway/conexoes e sobe/derruba sessões,
//     religando uma a uma com 5 a 15 s entre elas;
//   - a cada 30 s (e a cada campainha "fila") lê a fila agregada e entrega a cada sessão;
//   - escuta só POST /acordar, com HMAC conferido. Todo o resto é 404.
// Não existe auto-atualização: atualizar o gateway é publicar uma imagem nova.

import { fork } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarTransporteGateway, criarServidorAcordar } from './nuvem.mjs';
import { Supervisor } from './supervisor.mjs';
import { VERSAO } from './sessao.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const log = (texto, tipo = 'info') => console.log(`${new Date().toISOString()} [gateway] ${tipo === 'info' ? '' : `${tipo}: `}${texto}`);

function falhar(texto) {
  console.error(`gateway: ${texto}`);
  process.exit(1);
}

const CRM_BASE = process.env.CRM_BASE;
const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
const PORTA = Number(process.env.GATEWAY_PORTA || 8080);
const HOST = process.env.GATEWAY_HOST || '127.0.0.1';
const DADOS = process.env.DADOS_DIR || join(AQUI, 'dados');
const MEMORIA_MB = Math.max(128, Number(process.env.SESSAO_MEMORIA_MB || 512));

if (!CRM_BASE) falhar('defina CRM_BASE (ex.: https://crm-fitmind-whatsapp.vercel.app)');
if (!GATEWAY_SECRET || GATEWAY_SECRET.length < 32) falhar('defina GATEWAY_SECRET com pelo menos 32 caracteres (openssl rand -hex 32)');

let transporte;
try {
  transporte = criarTransporteGateway({ base: CRM_BASE, segredo: GATEWAY_SECRET });
} catch (e) {
  falhar(e.message);
}

const supervisor = new Supervisor({
  transporte,
  dados: DADOS,
  log,
  fork: (conexaoId) => fork(join(AQUI, 'filho.mjs'), [conexaoId], {
    execArgv: [`--max-old-space-size=${MEMORIA_MB}`],
    env: { ...process.env, DADOS_DIR: DADOS },
    stdio: 'inherit',
  }),
});

const servidor = criarServidorAcordar({
  segredo: GATEWAY_SECRET,
  log,
  aoAcordar: ({ conexaoId, motivo }) => {
    log(`campainha: ${motivo}${conexaoId ? ` (${conexaoId.slice(0, 8)})` : ''}`);
    return supervisor.aoAcordar({ conexaoId, motivo });
  },
});
servidor.headersTimeout = 10_000;
servidor.requestTimeout = 10_000;
servidor.on('error', (e) => falhar(`não consegui escutar em ${HOST}:${PORTA}: ${e.message}`));
servidor.listen(PORTA, HOST, () => log(`versão ${VERSAO}; campainha em http://${HOST}:${PORTA}/acordar; CRM ${new URL(CRM_BASE).origin}`));

let encerrando = false;
async function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  log(`${sinal}: parando as sessões`);
  servidor.close();
  await supervisor.encerrar();
  process.exit(0);
}
process.on('SIGTERM', () => void encerrar('SIGTERM'));
process.on('SIGINT', () => void encerrar('SIGINT'));
process.on('unhandledRejection', (e) => log(`promessa sem tratamento: ${e?.message || e}`, 'aviso'));

await supervisor.iniciar();
setInterval(() => {
  const rodando = [...supervisor.sessoes.values()].filter((s) => s.filho);
  const conectadas = rodando.filter((s) => s.conexao === 'conectado').length;
  log(`${rodando.length} sessão(ões) rodando, ${conectadas} conectada(s)`);
}, 10 * 60_000).unref();
