// Tarefa Q1: comprovantes (migração 006). Bucket privado, caminho {partner}/{conversa}/{id da mensagem}.{ext}, 90 dias,
// LGPD e privacidade apagam o caminho e deixam o arquivo na fila de apagar até o servidor confirmar.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, FASE6, M006, ler, comoUsuario, comoPapel, tentar } from './pg.mjs';
import { montarCenario, conversa, msg, local, q, um } from './cenario-fase23.mjs';

const NEGADO = /permission denied/;
const preparar = (db, conexao, waId, jid = '5565999990002@s.whatsapp.net', mime = 'image/jpeg') =>
  um(db, `SELECT public.comprovante_preparar($1, $2, $3, $4) AS r`, [conexao, waId, jid, mime]).then((x) => x.r);

describe('006: comprovantes no banco', () => {
  let db, a, brunoMsg, brunoWa;
  before(async () => {
    db = await novoBanco({ extras: FASE6 });
    a = await montarCenario(db);
    brunoMsg = a.m.bruno3;
    brunoWa = 'WA-BRUNO-COMPROVANTE';
    await db.query(`UPDATE public.bot_mensagens SET wa_id = $2 WHERE id = $1`, [brunoMsg, brunoWa]);
  });

  test('a 006 roda de novo sem estragar nada', async () => {
    await db.exec(ler(M006));
    await db.exec(ler(M006));
    const col = await q(db, `SELECT column_name FROM information_schema.columns WHERE table_name = 'bot_mensagens' AND column_name IN ('arquivo_path', 'arquivo_em')`);
    assert.equal(col.length, 2);
  });

  test('bucket privado, 4 MB, só imagem e PDF, e policy restritiva para o navegador', async () => {
    const b = await um(db, `SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'comprovantes'`);
    assert.equal(b.public, false);
    assert.equal(Number(b.file_size_limit), 4 * 1024 * 1024);
    assert.deepEqual([...b.allowed_mime_types].sort(), ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
    const pol = await q(db, `SELECT permissive, roles FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'comprovantes so o servidor'`);
    assert.equal(pol.length, 1);
    assert.equal(pol[0].permissive, 'RESTRICTIVE');
    assert.ok(String(pol[0].roles).includes('authenticated') && String(pol[0].roles).includes('anon'));
  });

  test('o caminho é {empresa}/{conversa}/{id da mensagem}.{extensão}', async () => {
    const r = await preparar(db, a.emp.conexaoId, brunoWa);
    assert.equal(r.ok, true);
    assert.equal(r.mensagemId, brunoMsg);
    assert.equal(r.caminho, `${a.p}/${a.bruno.id}/${brunoMsg}.jpg`);
    for (const [mime, ext] of [['image/png', 'png'], ['image/webp', 'webp'], ['application/pdf', 'pdf'], ['IMAGE/JPEG; charset=x', 'jpg']]) {
      assert.match((await preparar(db, a.emp.conexaoId, brunoWa, undefined, mime)).caminho, new RegExp(`\\.${ext}$`));
    }
  });

  // Achado A7 da Q4: o waId é escolhido por quem envia; 'ABC.1' e 'ABC_1' davam o mesmo caminho e um sobrescrevia o outro.
  test('waIds parecidos na mesma conversa não dividem o caminho', async () => {
    const m1 = await msg(db, a.bruno.id, 'cliente', local('15:10'), null, { tipo: 'imagem' });
    const m2 = await msg(db, a.bruno.id, 'cliente', local('15:11'), null, { tipo: 'imagem' });
    await db.query(`UPDATE public.bot_mensagens SET wa_id = 'ABC.1' WHERE id = $1`, [m1]);
    await db.query(`UPDATE public.bot_mensagens SET wa_id = 'ABC_1' WHERE id = $1`, [m2]);
    const r1 = await preparar(db, a.emp.conexaoId, 'ABC.1');
    const r2 = await preparar(db, a.emp.conexaoId, 'ABC_1');
    assert.equal(r1.caminho, `${a.p}/${a.bruno.id}/${m1}.jpg`);
    assert.equal(r2.caminho, `${a.p}/${a.bruno.id}/${m2}.jpg`);
    assert.notEqual(r1.caminho, r2.caminho);
    assert.equal((await preparar(db, a.emp.conexaoId, '   ')).erro, 'mensagem_desconhecida');
  });

  test('recusa o que não é imagem nem PDF, grupo, mensagem do próprio mentorado, texto e mensagem desconhecida', async () => {
    assert.equal((await preparar(db, a.emp.conexaoId, brunoWa, undefined, 'audio/ogg')).erro, 'mimetype');
    assert.equal((await preparar(db, a.emp.conexaoId, brunoWa, undefined, 'image/svg+xml')).erro, 'mimetype');
    assert.equal((await preparar(db, a.emp.conexaoId, brunoWa, '120363000000000001@g.us')).erro, 'grupo');
    assert.equal((await preparar(db, a.emp.conexaoId, 'NAO-EXISTE')).erro, 'mensagem_desconhecida');

    await db.query(`UPDATE public.bot_mensagens SET wa_id = 'WA-SAIDA' WHERE id = $1`, [a.m.bruno4]);
    await db.query(`UPDATE public.bot_mensagens SET tipo = 'imagem' WHERE id = $1`, [a.m.bruno4]);
    assert.equal((await preparar(db, a.emp.conexaoId, 'WA-SAIDA')).erro, 'de_mim');

    await db.query(`UPDATE public.bot_mensagens SET wa_id = 'WA-TEXTO' WHERE id = $1`, [a.m.bruno1]);
    assert.equal((await preparar(db, a.emp.conexaoId, 'WA-TEXTO')).erro, 'tipo');

    // mensagem de grupo (mesmo que o gateway diga que é 1:1)
    const gm = await msg(db, a.grupo.id, 'cliente', local('08:20'), null, { tipo: 'imagem' });
    await db.query(`UPDATE public.bot_mensagens SET wa_id = 'WA-GRUPO' WHERE id = $1`, [gm]);
    assert.equal((await preparar(db, a.emp.conexaoId, 'WA-GRUPO', '5565999990002@s.whatsapp.net')).erro, 'grupo');
  });

  test('conexão de outra empresa não acha a mensagem; conexão arquivada e conexão sem empresa são recusadas', async () => {
    const outra = await um(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('parceiro', $1, 'Outra', 'gateway') RETURNING id`, [a.p]);
    assert.equal((await preparar(db, outra.id, brunoWa)).erro, 'mensagem_desconhecida');
    await db.query(`UPDATE public.bot_conexoes SET arquivado_em = now() WHERE id = $1`, [outra.id]);
    assert.equal((await preparar(db, outra.id, brunoWa)).erro, 'conexao');
    assert.equal((await preparar(db, '00000000-0000-4000-8000-000000000000', brunoWa)).erro, 'conexao');
    const admin = await um(db, `INSERT INTO public.bot_conexoes (escopo, owner_id, nome, modo) VALUES ('admin', NULL, 'Do admin', 'gateway') RETURNING id`);
    assert.equal((await preparar(db, admin.id, brunoWa)).erro, 'sem_empresa');
  });

  test('privacidade diferente de normal: o servidor recusa o upload', async () => {
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'so_metadados' WHERE id = $1`, [a.bruno.id]);
    assert.equal((await preparar(db, a.emp.conexaoId, brunoWa)).erro, 'privacidade');
    assert.equal((await um(db, `SELECT public.comprovante_registrar($1, 'x/y.jpg') AS ok`, [brunoMsg])).ok, false);
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'normal' WHERE id = $1`, [a.bruno.id]);
  });

  test('registrar grava o caminho uma vez só; repetir o upload devolve "ja"', async () => {
    const caminho = `${a.p}/${a.bruno.id}/${brunoMsg}.jpg`;
    assert.equal((await um(db, `SELECT public.comprovante_registrar($1, $2) AS ok`, [brunoMsg, caminho])).ok, true);
    assert.equal((await um(db, `SELECT public.comprovante_registrar($1, $2) AS ok`, [brunoMsg, 'outro/caminho.jpg'])).ok, false);
    const m = await um(db, `SELECT arquivo_path, arquivo_em FROM public.bot_mensagens WHERE id = $1`, [brunoMsg]);
    assert.equal(m.arquivo_path, caminho);
    assert.ok(m.arquivo_em);
    const r = await preparar(db, a.emp.conexaoId, brunoWa);
    assert.deepEqual([r.ok, r.ja], [true, true]);
  });

  test('o navegador não executa as funções nem lê a fila de apagar, mas a service role sim', async () => {
    for (const sql of [
      `SELECT public.comprovante_preparar('${a.emp.conexaoId}', 'x', 'y', 'image/png')`,
      `SELECT public.comprovante_registrar('${brunoMsg}', 'x')`,
      `SELECT public.comprovantes_marcar_apagados(ARRAY['x'])`,
      `SELECT public.crm_retencao()`,
    ]) {
      const r = await comoUsuario(db, a.emp.uid, () => tentar(db, sql));
      assert.match(r.erro ?? '', NEGADO, sql);
    }
    const fila = await comoUsuario(db, a.emp.uid, () => tentar(db, `SELECT * FROM public.comprovantes_apagar`));
    assert.match(fila.erro ?? '', NEGADO);
    const ok = await comoPapel(db, 'service_role', null, () => tentar(db, `SELECT public.comprovantes_marcar_apagados(ARRAY['x']) AS n`));
    assert.equal(ok.erro, undefined);
  });

  test('a mensagem com arquivo continua legível pela empresa (o front precisa do caminho para o botão)', async () => {
    const r = await comoUsuario(db, a.emp.uid, () => tentar(db, `SELECT arquivo_path FROM public.bot_mensagens WHERE id = $1`, [brunoMsg]));
    assert.equal(r.linhas?.[0]?.arquivo_path, `${a.p}/${a.bruno.id}/${brunoMsg}.jpg`);
    const escrita = await comoUsuario(db, a.emp.uid, () => tentar(db, `UPDATE public.bot_mensagens SET arquivo_path = 'x' WHERE id = $1`, [brunoMsg]));
    assert.match(escrita.erro ?? '', NEGADO, 'o navegador não escreve o caminho');
  });
});

describe('006: retenção de 90 dias, privacidade e LGPD', () => {
  let db, a;
  const comArquivo = async (conv, waId, extra = {}) => {
    const id = await msg(db, conv.id, 'cliente', local('15:00'), null, { tipo: 'imagem', ...extra });
    await db.query(`UPDATE public.bot_mensagens SET wa_id = $2, arquivo_path = $3, arquivo_em = now() WHERE id = $1`,
      [id, waId, `${a.p}/${conv.id}/${waId}.jpg`]);
    return { id, caminho: `${a.p}/${conv.id}/${waId}.jpg` };
  };
  const fila = async () => (await q(db, `SELECT caminho FROM public.comprovantes_apagar ORDER BY caminho`)).map((l) => l.caminho);
  const caminhoDe = async (id) => (await um(db, `SELECT arquivo_path FROM public.bot_mensagens WHERE id = $1`, [id])).arquivo_path;

  before(async () => {
    db = await novoBanco({ extras: FASE6 });
    a = await montarCenario(db);
  });

  test('crm_retencao: 90 dias vencidos saem da mensagem e vão para a fila; os novos ficam', async () => {
    const velho = await comArquivo(a.bruno, 'WA-VELHO');
    const novo = await comArquivo(a.bruno, 'WA-NOVO');
    await db.query(`UPDATE public.bot_mensagens SET arquivo_em = now() - interval '91 days' WHERE id = $1`, [velho.id]);
    await db.query(`UPDATE public.bot_mensagens SET arquivo_em = now() - interval '89 days' WHERE id = $1`, [novo.id]);

    const r = await um(db, `SELECT public.crm_retencao() AS r`).then((x) => x.r);
    assert.equal(r.comprovantes_vencidos, 1);
    assert.deepEqual(r.comprovantes_apagar, [velho.caminho]);
    assert.equal(await caminhoDe(velho.id), null);
    assert.equal((await um(db, `SELECT arquivo_em FROM public.bot_mensagens WHERE id = $1`, [velho.id])).arquivo_em, null);
    assert.equal(await caminhoDe(novo.id), novo.caminho);
    // a mensagem em si fica (só o arquivo vence)
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens WHERE id = $1`, [velho.id])).n, 1);

    // se o servidor cair antes de apagar, a próxima manutenção devolve o mesmo caminho
    const de_novo = await um(db, `SELECT public.crm_retencao() AS r`).then((x) => x.r);
    assert.deepEqual(de_novo.comprovantes_apagar, [velho.caminho]);
    assert.equal(de_novo.comprovantes_vencidos, 0);

    // o servidor apagou do Storage e confirma
    assert.equal((await um(db, `SELECT public.comprovantes_marcar_apagados($1) AS n`, [[velho.caminho]])).n, 1);
    assert.deepEqual((await um(db, `SELECT public.crm_retencao() AS r`)).r.comprovantes_apagar, []);
  });

  test('a retenção de antes (corpo, payload, arquivos da IA) continua respondendo', async () => {
    const r = (await um(db, `SELECT public.crm_retencao() AS r`)).r;
    for (const chave of ['corpos', 'trechos_venda', 'payloads', 'relatorios', 'arquivos']) assert.ok(chave in r, chave);
  });

  test('marcar a conversa como "só metadados" apaga o caminho e enfileira o arquivo', async () => {
    const c = await conversa(db, a.emp, '5565977770001', 'Cliente Privado');
    const m1 = await comArquivo(c, 'WA-PRIV-1');
    const m2 = await comArquivo(c, 'WA-PRIV-2');
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'so_metadados' WHERE id = $1`, [c.id]);
    assert.equal(await caminhoDe(m1.id), null);
    assert.equal(await caminhoDe(m2.id), null);
    const f = await fila();
    assert.ok(f.includes(m1.caminho) && f.includes(m2.caminho));
  });

  test('mudar para "normal" de novo não mexe em nada e "ignorar" também apaga', async () => {
    const c = await conversa(db, a.emp, '5565977770002', 'Outro Privado');
    const m = await comArquivo(c, 'WA-PRIV-3');
    await db.query(`UPDATE public.bot_conversas SET estado = 'encerrada' WHERE id = $1`, [c.id]);
    assert.equal(await caminhoDe(m.id), m.caminho, 'mudar outra coisa não apaga');
    await db.query(`UPDATE public.bot_conversas SET privacidade = 'ignorar' WHERE id = $1`, [c.id]);
    assert.equal(await caminhoDe(m.id), null);
    assert.ok((await fila()).includes(m.caminho));
  });

  test('lgpd_apagar_contato devolve os comprovantes da pessoa e deixa na fila; os dos outros ficam', async () => {
    const c = await conversa(db, a.emp, '5565966660001', 'Pessoa LGPD');
    const outra = await conversa(db, a.emp, '5565966660002', 'Outra Pessoa');
    const dela = await comArquivo(c, 'WA-LGPD-1');
    const dela2 = await comArquivo(c, 'WA-LGPD-2');
    const dosOutros = await comArquivo(outra, 'WA-LGPD-OUTRA');

    const r = (await um(db, `SELECT public.lgpd_apagar_contato($1) AS r`, [c.contatoId])).r;
    assert.equal(r.apagado, true);
    assert.deepEqual([...r.comprovantes_apagar].sort(), [dela.caminho, dela2.caminho].sort());
    assert.equal((await um(db, `SELECT count(*)::int AS n FROM public.bot_mensagens WHERE conversa_id = $1`, [c.id])).n, 0);
    const f = await fila();
    assert.ok(f.includes(dela.caminho) && f.includes(dela2.caminho));
    assert.ok(!f.includes(dosOutros.caminho));
    assert.equal(await caminhoDe(dosOutros.id), dosOutros.caminho);
    // o resto do retorno da 005 continua lá
    for (const chave of ['conversas', 'cartoes', 'alvos', 'mensagens_de_grupo', 'lotes_refeitos', 'arquivos']) assert.ok(chave in r, chave);
  });

  test('apagar a conversa por cascata (conexão ou conversa) também deixa o arquivo na fila', async () => {
    const c = await conversa(db, a.emp, '5565955550001', 'Cascata');
    const m = await comArquivo(c, 'WA-CASCATA');
    await db.query(`DELETE FROM public.bot_conversas WHERE id = $1`, [c.id]);
    assert.ok((await fila()).includes(m.caminho));
  });
});

describe('006: conferência pós-migração e ordem das migrações', () => {
  const CONFERENCIA = 'banco/conferencia-pos-migracao.sql';

  test('passa com a 006; acusa gatilho que falta, bucket aberto e policy que abre o bucket comprovantes', async () => {
    const db = await novoBanco({ extras: FASE6 });
    await db.exec(ler(CONFERENCIA));

    await db.exec(`DROP TRIGGER trg_comprovantes_apagar_mensagem ON public.bot_mensagens`);
    await assert.rejects(db.exec(ler(CONFERENCIA)), /trg_comprovantes_apagar_mensagem/);
    await db.exec(ler(M006));
    await db.exec(ler(CONFERENCIA));

    await db.exec(`UPDATE storage.buckets SET public = true WHERE id = 'comprovantes'`);
    await assert.rejects(db.exec(ler(CONFERENCIA)), /bucket comprovantes/);
    await db.exec(ler(M006));
    await db.exec(ler(CONFERENCIA));

    await db.exec(`CREATE POLICY "ler comprovantes" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'comprovantes')`);
    await assert.rejects(db.exec(ler(CONFERENCIA)), /policy de storage.objects/);
  });

  test('repetir a 003 e a 005 desfaz a LGPD e a retenção dos comprovantes; a conferência acusa até rodar a 006', async () => {
    const db = await novoBanco({ extras: FASE6 });
    await db.exec(ler('banco/migracoes/003-dados-e-ia.sql'));
    await db.exec(ler('banco/migracoes/004-ajustes-mentoria.sql'));
    await db.exec(ler('banco/migracoes/005-achados-revisao.sql'));
    await assert.rejects(db.exec(ler(CONFERENCIA)), /sem os comprovantes/);
    await db.exec(ler(M006));
    await db.exec(ler(CONFERENCIA));
  });

  test('o roteiro e o LEIA-ME citam a 006', () => {
    for (const arq of ['banco/APLICAR-NO-AR.md', 'banco/LEIA-ME.md']) {
      assert.match(ler(arq), /006-comprovantes\.sql/, arq);
    }
  });

  // Achado A1 da Q4: um "$" sozinho no lugar de "$$" derrubava o bloco inteiro e nenhum cron (nem a retenção) era agendado.
  test('o bloco de agendamentos roda de verdade e agenda os 5 jobs (pg_cron trocado por um falso)', async () => {
    const bloco = ler('banco/agendamentos.sql').match(/DO \$agenda\$[\s\S]*?\$agenda\$;/);
    assert.ok(bloco, 'bloco DO $agenda$ não encontrado');
    const falso = await novoBanco();
    await falso.exec(`
      CREATE SCHEMA cron;
      CREATE TABLE cron.job (jobid serial PRIMARY KEY, jobname text, schedule text, command text);
      CREATE FUNCTION cron.schedule(_nome text, _agenda text, _comando text) RETURNS bigint LANGUAGE sql
        AS $f$ INSERT INTO cron.job (jobname, schedule, command) VALUES (_nome, _agenda, _comando) RETURNING jobid::bigint $f$;
      CREATE FUNCTION cron.unschedule(_id bigint) RETURNS boolean LANGUAGE sql
        AS $f$ DELETE FROM cron.job WHERE jobid = _id RETURNING true $f$;
    `);
    await falso.exec(bloco[0]);
    await falso.exec(bloco[0]); // rodar de novo recria os jobs, sem duplicar
    const jobs = await q(falso, `SELECT jobname, command FROM cron.job ORDER BY jobname`);
    assert.deepEqual(jobs.map((j) => j.jobname), ['crm-exportar', 'crm-ia-coletar', 'crm-ia-enviar', 'crm-ler-comprovantes', 'crm-manutencao']);
    assert.ok(jobs.find((j) => j.jobname === 'crm-manutencao').command.includes("'manutencao'"));
    assert.ok(jobs.find((j) => j.jobname === 'crm-ler-comprovantes').command.includes("'ler-comprovantes'"));
  });
});
