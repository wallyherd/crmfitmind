// filho.mjs — processo de UMA sessão no gateway. Quem cria é o supervisor (gateway.mjs).
//
// Recebe ordens por IPC: iniciar, opcoes, parear, enviar, parar, desconectar.
// Fala com o CRM direto (eventos e confirmações), assinando com o GATEWAY_SECRET.
// O código de saída diz ao supervisor por que parou (supervisor.mjs, SAIDA).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessao } from './sessao.mjs';
import { criarTransporteGateway } from './nuvem.mjs';
import { SAIDA, ID_VALIDO } from './supervisor.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const conexaoId = process.argv[2] || '';
if (!ID_VALIDO.test(conexaoId)) {
  console.error('filho.mjs: conexaoId inválido');
  process.exit(2);
}

const DADOS = process.env.DADOS_DIR || join(AQUI, 'dados');
const pasta = join(DADOS, 'sessoes', conexaoId);
const curto = conexaoId.slice(0, 8);
// Nunca registrar corpo de mensagem nem telefone de cliente: o log do VPS não é lugar disso.
const log = (texto, tipo = 'info') => console.log(`${new Date().toISOString()} [${curto}] ${tipo === 'info' ? '' : `${tipo}: `}${texto}`);

const transporte = criarTransporteGateway({ base: process.env.CRM_BASE, segredo: process.env.GATEWAY_SECRET });
let sessao = null;
let saindo = false;
let desconectando = false; // durante o desconectar, os 'fim' intermediários não encerram o processo
let parando = null;        // "desconectar" que chega no meio de um "parar" espera ele terminar

function criarSessao(opcoes) {
  if (sessao) return sessao;
  sessao = new Sessao(conexaoId, opcoes, transporte, { pasta, log });
  sessao.on('fim', ({ motivo }) => { if (!desconectando) void sair(SAIDA[motivo] ?? SAIDA.fatal); });
  sessao.on('aberta', () => process.send?.({ tipo: 'fila' }));
  sessao.on('estado', (e) => process.send?.({ tipo: 'estado', conexao: e.conexao }));
  return sessao;
}

async function sair(codigo) {
  if (saindo) return;
  saindo = true;
  try { await sessao?.descarregarAgora(); } catch { /* o que não subiu fica no disco */ }
  try { await sessao?.spool.gravado(); } catch { /* idem */ }
  process.exit(codigo);
}

process.on('message', async (m) => {
  try {
    switch (m?.tipo) {
      case 'iniciar':
        if (sessao) return;
        await criarSessao(m.opcoes).iniciar({ pareamento: m.pareamento || null });
        break;
      case 'opcoes':
        sessao?.atualizarOpcoes(m.opcoes);
        break;
      case 'parear':
        await sessao?.parear(m.pareamento);
        break;
      case 'enviar':
        if (sessao) await sessao.enfileirarEnvio(m.mensagens);
        else for (const msg of m.mensagens || []) await transporte.confirmar({ id: msg.id, status: 'erro', erro: 'sessao_parada' }).catch(() => {});
        break;
      case 'parar':
        if (desconectando) break;
        parando = parando || Promise.resolve(sessao?.parar()).catch((e) => log(`parar: ${e.message}`, 'erro'));
        await parando;
        if (!desconectando) await sair(SAIDA.parada);
        break;
      case 'desconectar':
        if (desconectando || saindo) break;
        desconectando = true;
        try {
          if (parando) await parando;
          await criarSessao(m.opcoes).desconectar();
        } finally {
          await sair(SAIDA.desconectada);
        }
        break;
      default:
        break;
    }
  } catch (e) {
    log(`comando "${m?.tipo}" falhou: ${e.message}`, 'erro');
    // Sem conseguir iniciar não adianta ficar vivo: sai como queda e o supervisor religa com espera.
    if (m?.tipo === 'iniciar') void sair(1);
  }
});

// O supervisor morreu: para direito em vez de ficar órfão.
process.on('disconnect', () => {
  void (async () => { try { await sessao?.parar('supervisor_saiu'); } finally { await sair(SAIDA.parada); } })();
});
for (const sinal of ['SIGTERM', 'SIGINT']) {
  process.on(sinal, () => {
    void (async () => { try { await sessao?.parar(); } finally { await sair(SAIDA.parada); } })();
  });
}
process.on('unhandledRejection', (e) => log(`promessa sem tratamento: ${e?.message || e}`, 'aviso'));
process.on('uncaughtException', (e) => {
  log(`exceção: ${e?.stack || e}`, 'erro');
  // Sai com código de queda: o supervisor religa com espera crescente.
  process.exit(1);
});
