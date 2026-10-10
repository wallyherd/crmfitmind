// Tarefa N8: regressão dos achados da revisão N7 no banco (migração 005). Cada teste leva o nome do achado.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, FASE5, M004, M005, ler, comoUsuario, comoPapel, tentar, criarUsuario } from './pg.mjs';
import { montarCenario, montarLote, empresa, DIA, q, um } from './cenario-fase23.mjs';

const NEGADO = /permission denied/;

describe('005: achado 2 — o navegador não muda o dono de quadro, campanha e fluxo', () => {
  let db, a, admin, disparoId, fluxoId;
  before(async () => {
    db = await novoBanco({ extras: FASE5 });
    a = await montarCenario(db);
    admin = await criarUsuario(db, { email: 'mentor@mentoria.test', admin: true });
    const coluna = await um(db, `SELECT id FROM public.crm_colunas WHERE quadro_id = $1 ORDER BY posicao LIMIT 1`, [a.emp.quadroId]);
    await db.query(`INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo, contato_telefone) VALUES ($1, $2, 'Lead', '5565900000001')`, [a.emp.quadroId, coluna.id]);
    disparoId = (await um(db, `INSERT INTO public.bot_disparos (escopo, owner_id, nome, mensagem) VALUES ('parceiro', $1, 'Campanha', 'Oi') RETURNING id`, [a.p])).id;
    await db.query(`INSERT INTO public.bot_disparo_alvos (disparo_id, telefone, nome) VALUES ($1, '5565955556666', 'Cliente Alvo')`, [disparoId]);
    fluxoId = a.emp.fluxoId;
  });

  const cartoesDoAdmin = () => comoUsuario(db, admin.uid, async () =>
    (await db.query(`SELECT count(*)::int AS n FROM public.crm_cartoes WHERE quadro_id = $1`, [a.emp.quadroId])).rows[0].n);
  const alvosDoAdmin = () => comoUsuario(db, admin.uid, async () =>
    (await db.query(`SELECT count(*)::int AS n FROM public.bot_disparo_alvos WHERE disparo_id = $1`, [disparoId])).rows[0].n);

  test('o admin não move o quadro nem a campanha para o escopo dele, e continua sem ler cartão e alvo', async () => {
    assert.equal(await cartoesDoAdmin(), 0);
    assert.equal(await alvosDoAdmin(), 0);
    const tentativas = [
      [`UPDATE public.crm_quadros SET escopo = 'admin', owner_id = NULL WHERE id = $1`, a.emp.quadroId],
      [`UPDATE public.crm_quadros SET owner_id = $2 WHERE id = $1`, a.emp.quadroId, admin.profileId],
      [`UPDATE public.bot_disparos SET escopo = 'admin', owner_id = NULL WHERE id = $1`, disparoId],
      [`UPDATE public.bot_fluxos SET escopo = 'admin', owner_id = NULL WHERE id = $1`, fluxoId],
    ];
    for (const [sql, ...params] of tentativas) {
      const r = await comoUsuario(db, admin.uid, () => tentar(db, sql, params));
      assert.match(r.erro ?? '', /escopo e dono nao mudam/, sql);
    }
    assert.equal(await cartoesDoAdmin(), 0);
    assert.equal(await alvosDoAdmin(), 0);
    const quadro = await um(db, `SELECT escopo, owner_id FROM public.crm_quadros WHERE id = $1`, [a.emp.quadroId]);
    assert.deepEqual([quadro.escopo, quadro.owner_id], ['parceiro', a.p]);
  });

  test('a estrutura continua editável: o admin e o dono mudam nome e status, o servidor muda o dono', async () => {
    const admin1 = await comoUsuario(db, admin.uid, () => tentar(db, `UPDATE public.crm_quadros SET nome = 'Funil do mentor' WHERE id = $1`, [a.emp.quadroId]));
    assert.equal(admin1.erro, undefined);
    const dono = await comoUsuario(db, a.emp.uid, () => tentar(db, `UPDATE public.bot_disparos SET nome = 'Nova campanha' WHERE id = $1`, [disparoId]));
    assert.equal(dono.erro, undefined);
    // o servidor (service role) e as funções do banco não passam pelo gatilho
    const servidor = await comoPapel(db, 'service_role', null, () => tentar(db, `UPDATE public.crm_quadros SET owner_id = owner_id WHERE id = $1`, [a.emp.quadroId]));
    assert.equal(servidor.erro, undefined);
    const dono2 = await comoUsuario(db, a.emp.uid, () => tentar(db, `UPDATE public.crm_quadros SET owner_id = $2 WHERE id = $1`, [a.emp.quadroId, admin.profileId]));
    assert.match(dono2.erro ?? '', /escopo e dono nao mudam/, 'nem o dono muda o dono pelo navegador');
  });
});

describe('005: achados 3 e 5 — relatório diário sem texto nem ids de lote no navegador', () => {
  let db, a, admin;
  before(async () => {
    db = await novoBanco({ extras: FASE5 });
    a = await montarCenario(db);
    admin = await criarUsuario(db, { email: 'mentor@mentoria.test', admin: true });
    await db.query(`INSERT INTO public.ia_relatorios_diarios (partner_id, data_referencia, resumo, resumo_executivo, pontos_melhoria, leads_analisados, total_conversas)
                    VALUES ($1, $2::date, '"Fechou o pix do Bruno"'::jsonb, 'Responder Carla', 'Retomar a Ana', '[{"nome":"Ana"}]', 7)`, [a.p, DIA]);
  });

  test('nenhuma coluna de texto, lote ou análise é legível pelo navegador; os números continuam', async () => {
    for (const uid of [admin.uid, a.emp.uid]) {
      await comoUsuario(db, uid, async () => {
        for (const col of ['resumo', 'resumo_executivo', 'pontos_melhoria', 'leads_analisados', 'lote_id', 'analise_id']) {
          const r = await tentar(db, `SELECT ${col} FROM public.ia_relatorios_diarios WHERE partner_id = $1`, [a.p]);
          assert.match(r.erro ?? '', NEGADO, col);
        }
        const r = await tentar(db, `SELECT total_conversas, data_referencia FROM public.ia_relatorios_diarios WHERE partner_id = $1`, [a.p]);
        if (uid === admin.uid) assert.equal(r.linhas.length, 1, 'o admin vê a linha de números');
        else assert.equal(r.linhas[0].total_conversas, 7);
      });
    }
  });
});

describe('005: achados 8, 9 e 18 — LGPD completa', () => {
  let db, a, lote, ana, resultado, mensagemAna, mensagemTia;
  before(async () => {
    db = await novoBanco({ extras: FASE5 });
    a = await montarCenario(db);
    lote = (await montarLote(db, a.p)).partes[0];
    ana = a.ana;

    // a Ana escreveu num grupo (e a Tia Rosa também)
    mensagemAna = await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, autor, status, tipo, corpo, wa_em, participante_jid, participante_telefone, participante_nome)
      VALUES ($1, 'entrada', 'cliente', 'recebida', 'texto', 'A Ana opinou no grupo', now(), '5565999990001@s.whatsapp.net', '5565999990001', 'Ana Paula') RETURNING id`, [a.grupo.id]);
    mensagemTia = await um(db, `INSERT INTO public.bot_mensagens (conversa_id, direcao, autor, status, tipo, corpo, wa_em, participante_jid, participante_telefone, participante_nome)
      VALUES ($1, 'entrada', 'cliente', 'recebida', 'texto', 'Churrasco da tia', now(), '5565911112222@s.whatsapp.net', '5565911112222', 'Tia Rosa') RETURNING id`, [a.grupo.id]);
    // alvo de campanha com o telefone dela e de outra pessoa
    const disparo = await um(db, `INSERT INTO public.bot_disparos (escopo, owner_id, nome, mensagem) VALUES ('parceiro', $1, 'Campanha', 'Oi') RETURNING id`, [a.p]);
    await db.query(`INSERT INTO public.bot_disparo_alvos (disparo_id, telefone, nome) VALUES ($1, '5565999990001', 'Ana Paula'), ($1, '5565977776666', 'Outro')`, [disparo.id]);
    // conversa da Ana que nunca foi ligada ao contato
    await db.query(`INSERT INTO public.bot_conversas (conexao_id, telefone, jid, nome, tipo, estado) VALUES ($1, NULL, '88888@lid', 'Ana (lid)', 'individual', 'humano')`, [a.emp.conexaoId]);
    // os gatilhos ligariam a conversa a um contato novo; o estado que o apagar precisa tratar é o sem contato
    await db.exec(`ALTER TABLE public.bot_conversas DISABLE TRIGGER USER`);
    await db.query(`UPDATE public.bot_conversas SET lid = '5565999990001@s.whatsapp.net', contato_id = NULL WHERE jid = '88888@lid'`);
    await db.exec(`ALTER TABLE public.bot_conversas ENABLE TRIGGER USER`);
    assert.equal((await um(db, `SELECT contato_id FROM public.bot_conversas WHERE jid = '88888@lid'`)).contato_id, null);
    // o resumo do dia cita a Ana e o Bruno
    await db.query(`INSERT INTO public.ia_relatorios_diarios (partner_id, data_referencia, resumo, resumo_executivo, pontos_melhoria)
                    VALUES ($1, $2::date, '{"diagnostico":"Ana quer fechar e o Bruno pagou"}'::jsonb, 'Retomar a Ana amanhã', 'Falar com Ana')
                    ON CONFLICT (partner_id, data_referencia) DO UPDATE SET resumo = EXCLUDED.resumo, resumo_executivo = EXCLUDED.resumo_executivo, pontos_melhoria = EXCLUDED.pontos_melhoria`, [a.p, DIA]);
    resultado = (await um(db, `SELECT public.lgpd_apagar_contato($1) AS r`, [ana.contatoId])).r;
  });

  test('achado 9: alvos, mensagens de grupo, conversa sem contato e nome no resumo saem junto', async () => {
    assert.equal(resultado.apagado, true);
    assert.equal(resultado.alvos, 1);
    assert.ok(resultado.mensagens_de_grupo >= 1);
    // alvos
    assert.deepEqual((await q(db, `SELECT telefone FROM public.bot_disparo_alvos ORDER BY telefone`)).map((x) => x.telefone), ['5565977776666']);
    // grupo: a mensagem da Ana fica sem texto nem identificação; a da Tia Rosa e as outras ficam
    const dela = await um(db, `SELECT corpo, midia, participante_jid, participante_telefone, participante_nome FROM public.bot_mensagens WHERE id = $1`, [mensagemAna.id]);
    assert.deepEqual(Object.values(dela), [null, null, null, null, null]);
    assert.equal((await um(db, `SELECT corpo, participante_nome FROM public.bot_mensagens WHERE id = $1`, [mensagemTia.id])).participante_nome, 'Tia Rosa');
    // conversa que nunca foi ligada ao contato
    assert.equal((await q(db, `SELECT 1 FROM public.bot_conversas WHERE jid = '88888@lid'`)).length, 0);
    // resumo: a Ana vira marcador, o Bruno continua
    const rel = await um(db, `SELECT resumo::text AS r, resumo_executivo, pontos_melhoria FROM public.ia_relatorios_diarios WHERE partner_id = $1`, [a.p]);
    assert.ok(!/\bAna\b/.test(rel.r + rel.resumo_executivo + rel.pontos_melhoria), JSON.stringify(rel));
    assert.ok(rel.r.includes('[pessoa removida]') && rel.r.includes('Bruno'));
  });

  test('achado 18: o lote ainda não analisado expira e o dia é refeito sem a pessoa', async () => {
    assert.equal(resultado.lotes_refeitos, 1);
    assert.equal((await um(db, `SELECT status FROM public.ia_lotes WHERE id = $1`, [lote.lote_id])).status, 'expirado');
    const devidos = await q(db, `SELECT partner_id, dia::text FROM public.crm_lotes_devidos(50, '00:00')`);
    assert.ok(devidos.some((d) => d.partner_id === a.p && d.dia === DIA), 'o dia volta para a fila do ciclo seguinte');
    const novo = await montarLote(db, a.p);
    const refs = (await um(db, `SELECT refs FROM public.ia_lotes WHERE id = $1`, [novo.partes[0].lote_id])).refs;
    assert.ok(!Object.values(refs).some((r) => r.conversa_id === ana.id));
    assert.ok(Object.values(refs).some((r) => r.conversa_id === a.bruno.id), 'os outros contatos continuam no dia');
  });

  test('achado 8: o arquivo fica pendente até o servidor confirmar, e a retenção o devolve', async () => {
    assert.ok(resultado.arquivos.includes(lote.arquivo_path ?? (await um(db, `SELECT arquivo_path FROM public.ia_lotes WHERE id = $1`, [lote.lote_id])).arquivo_path));
    const l = await um(db, `SELECT arquivo_path, arquivo_apagado_em, arquivo_apagar_pendente_em FROM public.ia_lotes WHERE id = $1`, [lote.lote_id]);
    assert.ok(l.arquivo_apagado_em && l.arquivo_apagar_pendente_em);
    const r = (await um(db, `SELECT public.crm_retencao() AS r`)).r;
    assert.ok(r.arquivos.includes(l.arquivo_path), 'a manutenção tenta de novo');
    assert.equal((await um(db, `SELECT public.ia_marcar_arquivos_apagados($1) AS n`, [[l.arquivo_path]])).n, 1);
    assert.equal((await um(db, `SELECT arquivo_apagar_pendente_em FROM public.ia_lotes WHERE id = $1`, [lote.lote_id])).arquivo_apagar_pendente_em, null);
    assert.ok(!(await um(db, `SELECT public.crm_retencao() AS r`)).r.arquivos.includes(l.arquivo_path), 'depois de confirmado não volta');
  });
});

describe('005: achado 11 — alertas do painel sem ruído', () => {
  let db;
  const alertas = async (nome) => (await comoPapel(db, 'service_role', null, () => q(db, `SELECT alertas FROM public.mentor_painel() WHERE empresa = $1`, [nome])))[0].alertas;
  before(async () => {
    db = await novoBanco({ extras: FASE5 });
    // só conector do PC (desligado à noite é normal) e uma conexão gateway que nunca foi pareada
    const pc = await criarUsuario(db, { email: 'pc@x.com', empresa: 'So PC' });
    await db.query(`INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo, visto_em) VALUES ('parceiro', $1, 'PC', 'pc', now() - interval '3 hours')`, [pc.partnerId]);
    const novo = await criarUsuario(db, { email: 'novo@x.com', empresa: 'Nunca pareou' });
    await db.query(`INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('parceiro', $1, 'GW', 'gateway')`, [novo.partnerId]);
    await criarUsuario(db, { email: 'vazia@x.com', empresa: 'Sem conexao' });
    const caiu = await criarUsuario(db, { email: 'caiu@x.com', empresa: 'Gateway caiu' });
    await db.query(`INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo, numero, status, visto_em) VALUES ('parceiro', $1, 'GW', 'gateway', '5565900000000', 'conectado', now() - interval '3 hours')`, [caiu.partnerId]);
  });

  test('conector do PC, conexão nunca pareada e empresa sem conexão não acendem alerta; gateway pareado sem sinal, sim', async () => {
    assert.ok(!(await alertas('So PC')).includes('conexao_sem_sinal'));
    assert.ok(!(await alertas('Nunca pareou')).includes('conexao_sem_sinal'));
    assert.ok(!(await alertas('Sem conexao')).includes('sem_conversa_2_dias'));
    assert.ok((await alertas('Gateway caiu')).includes('conexao_sem_sinal'));
    assert.ok((await alertas('Gateway caiu')).includes('sem_conversa_2_dias'), 'com conexão, a falta de conversa continua avisando');
  });
});

describe('conferência pós-migração (achados 14 e 15)', () => {
  const CONFERENCIA = 'banco/conferencia-pos-migracao.sql';
  test('passa no banco com as migrações 001–005 e falha quando uma policy abre o conteúdo', async () => {
    const db = await novoBanco({ extras: FASE5 });
    await db.exec(ler(CONFERENCIA));
    // reaplicar a 003 devolve a policy antiga, que deixa o admin passar: a conferência acusa
    await db.exec(ler('banco/migracoes/003-dados-e-ia.sql'));
    await assert.rejects(db.exec(ler(CONFERENCIA)), /policy sem a guarda do opt-in/);
    await db.exec(ler(M004));
    await db.exec(ler(M005));
    await db.exec(ler(CONFERENCIA));
  });

  test('acusa policy de storage que abre o bucket e tabela de conteúdo no Realtime', async () => {
    const db = await novoBanco({ extras: FASE5 });
    await db.exec(`CREATE POLICY "authenticated pode ler storage" ON storage.objects FOR SELECT TO authenticated USING (true)`);
    await assert.rejects(db.exec(ler(CONFERENCIA)), /policy de storage.objects/);
    await db.exec(`DROP POLICY "authenticated pode ler storage" ON storage.objects`);
    await db.exec(`CREATE PUBLICATION supabase_realtime FOR TABLE public.bot_mensagens`);
    await assert.rejects(db.exec(ler(CONFERENCIA)), /supabase_realtime: bot_mensagens/);
  });

  test('a 004 reaplicada sozinha reabre o relatório; a conferência acusa até rodar a 005', async () => {
    const db = await novoBanco({ extras: FASE5 });
    await db.exec(ler(M004));
    await assert.rejects(db.exec(ler(CONFERENCIA)), /ia_relatorios_diarios.resumo/);
    await db.exec(ler(M005));
    await db.exec(ler(CONFERENCIA));
  });
});

describe('005: roda duas vezes e depois da 004', () => {
  test('idempotente; reaplicar a 004 e a 005 mantém as travas', async () => {
    const db = await novoBanco({ extras: FASE5 });
    await db.exec(ler(M005));
    await db.exec(ler(M004));
    await db.exec(ler(M005));
    const admin = await criarUsuario(db, { email: 'm@x.com', admin: true });
    const r = await comoUsuario(db, admin.uid, () => tentar(db, `SELECT resumo FROM public.ia_relatorios_diarios`));
    assert.match(r.erro ?? '', NEGADO);
  });
});
