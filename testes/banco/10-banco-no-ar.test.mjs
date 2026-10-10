// N9: um banco "como o do diagnóstico de 09/10" (instalador antigo + sementes) com as migrações 001→005 por cima.
// O banco no ar não é acessado: os arquivos de fixtures/banco-no-ar reconstroem o esquema antigo e
// diagnostico-2026-10-09.json é a foto do banco no ar, usada para provar que a reconstrução é fiel.
import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { novoBanco, ler, FASE5, M004, M005, comoPapel, comoUsuario, tentar, criarUsuario, popularEmpresa } from './pg.mjs';

const F = (n) => `testes/banco/fixtures/banco-no-ar/${n}`;
const diag = JSON.parse(ler(F('diagnostico-2026-10-09.json')));
const CONFERENCIA = 'banco/conferencia-pos-migracao.sql';
const LIMPAR = 'banco/limpar-sementes.sql';
const md5 = (s) => createHash('md5').update(s).digest('hex');

// Funções que no banco no ar têm corpo diferente de qualquer versão do repositório (alguém editou à mão).
// As três são recriadas pelas migrações (partner_pode na 001/004, bootstrap na 001/003, crm_criar_quadro na 003).
const EDITADAS_NO_AR = ['bootstrap_empresa_completa', 'crm_criar_quadro', 'partner_pode'];

// Instalador antigo + retroalimentação antiga + script antigo dos admins + a empresa-semente.
async function bancoComoNoAr() {
  const db = await novoBanco({ base: [F('01-instalador-antigo.sql'), F('02-retroalimentacao-antiga.sql'), F('03-admin-antigo.sql')] });
  // o projeto no ar tem RLS nas duas tabelas de IA (o Supabase liga sozinho em tabela nova); o arquivo antigo não ligava
  await db.exec(`ALTER TABLE public.ia_retroalimentacao_config ENABLE ROW LEVEL SECURITY;
                 ALTER TABLE public.ia_relatorios_diarios ENABLE ROW LEVEL SECURITY;`);
  await db.exec(ler(F('04-sementes.sql')));
  return db;
}

async function migrar(db, arquivos = FASE5) {
  for (const f of arquivos) {
    try { await db.exec(ler(f)); } catch (e) { e.message = `${f}: ${e.message}`; throw e; }
  }
}

const linhas = async (db, sql, params) => (await db.query(sql, params)).rows;
const um = async (db, sql, params) => (await linhas(db, sql, params))[0];
const n = async (db, sql, params) => Number((await um(db, sql, params)).n);

// Estrutura inteira que o diagnóstico mede, no mesmo formato dele.
async function foto(db) {
  const tabelas = {};
  for (const t of await linhas(db, `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
                                     WHERE ns.nspname = 'public' AND c.relkind = 'r'`)) {
    tabelas[t.relname] = {
      rls: t.relrowsecurity,
      colunas: await linhas(db, `SELECT a.attname AS nome, format_type(a.atttypid, a.atttypmod) AS tipo, NOT a.attnotnull AS nulo,
                                        pg_get_expr(d.adbin, d.adrelid) AS padrao
                                   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
                                  WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`, [`public.${t.relname}`]),
      restricoes: await linhas(db, `SELECT conname AS nome, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = $1::regclass ORDER BY conname`,
        [`public.${t.relname}`]),
      indices: (await linhas(db, `SELECT pg_get_indexdef(indexrelid) AS d FROM pg_index WHERE indrelid = $1::regclass ORDER BY 1`, [`public.${t.relname}`]))
        .map((r) => r.d),
    };
  }
  const policies = await linhas(db, `SELECT tablename AS tabela, policyname AS nome, cmd, qual AS "using", with_check AS "check"
                                       FROM pg_policies WHERE schemaname = 'public'`);
  const funcoes = await linhas(db, `SELECT p.proname AS nome, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc,
                                           has_function_privilege('anon', p.oid, 'EXECUTE') AS execute_anon,
                                           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS execute_authenticated
                                      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`);
  const gatilhos = await linhas(db, `SELECT event_object_schema || '.' || event_object_table AS tabela, trigger_name AS nome
                                       FROM information_schema.triggers WHERE event_object_schema IN ('public', 'auth')`);
  // a ordem de leitura do catálogo muda quando o objeto é recriado; o que vale é o conjunto
  const por = (xs, k) => [...xs].sort((x, y) => k(x).localeCompare(k(y)));
  return {
    tabelas,
    policies: por(policies, (x) => `${x.tabela}|${x.nome}`),
    funcoes: por(funcoes, (x) => `${x.nome}(${x.args})`),
    gatilhos: por(gatilhos, (x) => `${x.tabela}|${x.nome}`),
  };
}

const conjunto = (xs) => new Set(xs);
const ordenar = (xs) => [...xs].sort();

describe('o banco reconstruído é o do diagnóstico de 09/10', () => {
  let db, f;
  before(async () => { db = await bancoComoNoAr(); f = await foto(db); });

  test('mesmas tabelas, colunas, restrições (CHECKs antigos inclusos), índices e RLS', () => {
    assert.deepEqual(ordenar(Object.keys(f.tabelas)), ordenar(Object.keys(diag.tabelas)));
    for (const [t, v] of Object.entries(diag.tabelas)) {
      assert.equal(f.tabelas[t].rls, v.rls, `RLS de ${t}`);
      assert.deepEqual(f.tabelas[t].colunas, v.colunas, `colunas de ${t}`);
      assert.deepEqual(ordenar(f.tabelas[t].restricoes.map((r) => `${r.nome}|${r.def}`)), ordenar((v.restricoes || []).map((r) => `${r.nome}|${r.def}`)),
        `restrições de ${t}`);
      assert.deepEqual(ordenar(f.tabelas[t].indices), ordenar(v.indices || []), `índices de ${t}`);
    }
  });

  test('mesmas policies e mesmos gatilhos', () => {
    const chave = (p) => [p.tabela, p.nome, p.cmd, p.using, p.check].join('|');
    assert.deepEqual(ordenar(f.policies.map(chave)), ordenar(diag.policies.map(chave)));
    const gat = (g) => `${g.tabela}|${g.nome}`;
    assert.deepEqual(ordenar(f.gatilhos.map(gat)), ordenar(diag.gatilhos.map(gat)));
  });

  test('as 23 funções: mesmo md5 (o banco no ar foi colado com quebra de linha do Windows), menos 3 editadas à mão', () => {
    assert.equal(diag.funcoes.length, 23);
    assert.equal(f.funcoes.length, 23);
    const divergentes = [];
    for (const d of diag.funcoes) {
      const meu = f.funcoes.find((x) => x.nome === d.nome && x.args === d.args);
      assert.ok(meu, `falta a função ${d.nome}(${d.args})`);
      const iguais = [meu.prosrc, meu.prosrc.replace(/\n/g, '\r\n')].some((s) => md5(s) === d.md5);
      if (!iguais) divergentes.push(d.nome);
      // a brecha: toda função executável por anon e authenticated, como no diagnóstico
      assert.equal(meu.execute_anon, d.execute_anon, `${d.nome} anon`);
      assert.equal(meu.execute_authenticated, d.execute_authenticated, `${d.nome} authenticated`);
    }
    assert.deepEqual(ordenar(divergentes), EDITADAS_NO_AR);
  });

  test('as brechas do diagnóstico estão lá: tudo executável por anon/authenticated e webhook_segredo legível', async () => {
    assert.ok(diag.funcoes.every((x) => x.execute_anon && x.execute_authenticated));
    assert.deepEqual(diag.grants_bot_conexoes_webhook_segredo, { anon: true, authenticated: true });
    const g = await um(db, `SELECT has_column_privilege('anon', 'public.bot_conexoes', 'webhook_segredo', 'SELECT') AS anon,
                                   has_column_privilege('authenticated', 'public.bot_conexoes', 'webhook_segredo', 'SELECT') AS authenticated`);
    assert.deepEqual(g, diag.grants_bot_conexoes_webhook_segredo);
  });

  test('as contagens do diagnóstico: 0 logins, 3 profiles sem login, 1 empresa, 1 membro, 1 funil, nada de conversa', async () => {
    const c = diag.contagens;
    assert.equal(c.auth_users, await n(db, `SELECT count(*) AS n FROM auth.users`));
    assert.equal(c.profiles, await n(db, `SELECT count(*) AS n FROM public.profiles`));
    assert.equal(c.profiles_sem_user_id, await n(db, `SELECT count(*) AS n FROM public.profiles WHERE user_id IS NULL`));
    assert.equal(c.partners, await n(db, `SELECT count(*) AS n FROM public.partners`));
    assert.equal(c.partner_members, await n(db, `SELECT count(*) AS n FROM public.partner_members`));
    assert.equal(c.bot_conexoes, await n(db, `SELECT count(*) AS n FROM public.bot_conexoes`));
    assert.equal(c.bot_conversas, await n(db, `SELECT count(*) AS n FROM public.bot_conversas`));
    assert.equal(c.bot_mensagens, await n(db, `SELECT count(*) AS n FROM public.bot_mensagens`));
    assert.equal(c.crm_quadros, await n(db, `SELECT count(*) AS n FROM public.crm_quadros`));
    assert.equal(c.crm_cartoes, await n(db, `SELECT count(*) AS n FROM public.crm_cartoes`));
    assert.ok(!String(diag.storage_buckets ?? '').includes('<row'), 'nenhum bucket no Storage');
    assert.equal(diag.cron_jobs, null);
    assert.ok(!diag.extensoes.includes('pg_cron') && !diag.extensoes.includes('pg_net'));
  });

  test('as sementes têm a senha antiga em texto puro e fuso de São Paulo', async () => {
    assert.equal(await n(db, `SELECT count(*) AS n FROM public.profiles WHERE senha_hash IS NOT NULL`), 2);
    assert.equal((await um(db, `SELECT timezone FROM public.partner_acesso_config`)).timezone, 'America/Sao_Paulo');
  });
});

describe('001→005 por cima do banco do diagnóstico', () => {
  let db, novo;
  before(async () => {
    db = await bancoComoNoAr();
    await migrar(db);
    novo = await novoBanco({ extras: FASE5 });
  });

  test('cada migração roda sem erro, uma depois da outra, e a conferência pós-migração passa', async () => {
    await db.exec(ler(CONFERENCIA));
  });

  test('chega ao mesmo estado de um banco novo (tabelas, colunas, restrições, índices, policies, funções, gatilhos)', async () => {
    const a = await foto(db), b = await foto(novo);
    assert.deepEqual(ordenar(Object.keys(a.tabelas)), ordenar(Object.keys(b.tabelas)));
    for (const t of Object.keys(b.tabelas)) {
      assert.equal(a.tabelas[t].rls, b.tabelas[t].rls, `RLS de ${t}`);
      // a ordem das colunas muda (as antigas foram acrescentadas depois); o que importa é nome, tipo, nulo e padrão
      const porNome = (x) => [...x].sort((c1, c2) => c1.nome.localeCompare(c2.nome));
      assert.deepEqual(porNome(a.tabelas[t].colunas), porNome(b.tabelas[t].colunas), `colunas de ${t}`);
      assert.deepEqual(ordenar(a.tabelas[t].restricoes.map((r) => `${r.nome}|${r.def}`)), ordenar(b.tabelas[t].restricoes.map((r) => `${r.nome}|${r.def}`)),
        `restrições de ${t}`);
      // único resto: o índice único de e-mail que o script antigo dos admins criou (inofensivo; sai junto com as sementes)
      const idx = (x) => ordenar(x.tabelas[t].indices.filter((i) => !/profiles_email_idx/.test(i)));
      assert.deepEqual(idx(a), idx(b), `índices de ${t}`);
    }
    const chave = (p) => [p.tabela, p.nome, p.cmd, p.using, p.check].join('|');
    assert.deepEqual(ordenar(a.policies.map(chave)), ordenar(b.policies.map(chave)));
    const fun = (x) => `${x.nome}(${x.args})|${md5(x.prosrc)}|${x.execute_anon}|${x.execute_authenticated}`;
    assert.deepEqual(ordenar(a.funcoes.map(fun)), ordenar(b.funcoes.map(fun)), 'funções, corpos e quem pode executar');
    const gat = (g) => `${g.tabela}|${g.nome}`;
    assert.deepEqual(ordenar(a.gatilhos.map(gat)), ordenar(b.gatilhos.map(gat)));
  });

  test('a diferença que sobra é só o índice do e-mail, e ele está no diagnóstico', async () => {
    const a = await foto(db), b = await foto(novo);
    const soAntigo = a.tabelas.profiles.indices.filter((i) => !b.tabelas.profiles.indices.includes(i));
    assert.equal(soAntigo.length, 1);
    assert.match(soAntigo[0], /profiles_email_idx/);
    assert.ok(diag.tabelas.profiles.indices.some((i) => /profiles_email_idx/.test(i)));
  });

  test('as brechas fecham: nenhuma função de ação para anon/authenticated e webhook_segredo escondido', async () => {
    const a = await foto(db);
    const abertas = a.funcoes.filter((x) => x.execute_anon || x.execute_authenticated).map((x) => x.nome);
    for (const nome of ['bootstrap_empresa_completa', 'bot_registrar_eventos', 'bot_reservar_fila']) {
      assert.ok(!abertas.includes(nome), `${nome} ainda executável por anon/authenticated`);
    }
    const g = await um(db, `SELECT has_column_privilege('anon', 'public.bot_conexoes', 'webhook_segredo', 'SELECT') AS anon,
                                   has_column_privilege('authenticated', 'public.bot_conexoes', 'webhook_segredo', 'SELECT') AS authenticated`);
    assert.deepEqual(g, { anon: false, authenticated: false });
    const r = await comoPapel(db, 'anon', '', () => tentar(db, `SELECT bootstrap_empresa_completa(NULL, 'Invasora')`));
    assert.match(r.erro, /permission denied/);
  });

  test('a senha em texto puro some do banco: coluna apagada e sementes suspensas', async () => {
    const cols = (await linhas(db, `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles'`))
      .map((c) => c.column_name);
    assert.ok(!cols.some((c) => /senha|password/i.test(c)), `coluna de senha: ${cols}`);
    const adm = await linhas(db, `SELECT status FROM public.profiles WHERE email LIKE 'admin@fitmind.com%'`);
    assert.equal(adm.length, 2);
    assert.ok(adm.every((p) => p.status === 'suspenso'), 'a 001 suspende os admins antigos');
  });

  test('o fuso da empresa-semente vira Cuiabá, o padrão novo é Cuiabá e o dia da conexão cai em Cuiabá sem configuração', async () => {
    assert.equal((await um(db, `SELECT timezone FROM public.partner_acesso_config`)).timezone, 'America/Cuiaba');
    const pad = await um(db, `SELECT pg_get_expr(d.adbin, d.adrelid) AS p FROM pg_attrdef d
                               WHERE d.adrelid = 'public.partner_acesso_config'::regclass
                                 AND d.adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = d.adrelid AND attname = 'timezone')`);
    assert.match(pad.p, /America\/Cuiaba/);
    const fn = await um(db, `SELECT prosrc FROM pg_proc WHERE proname = 'bot_dia_da_conexao'`);
    assert.match(fn.prosrc, /America\/Cuiaba/);
    assert.doesNotMatch(fn.prosrc, /Sao_Paulo/);
  });

  test('empresa nova criada depois também nasce em Cuiabá', async () => {
    const e = await criarUsuario(db, { email: 'primeira@x.com', empresa: 'Primeira' });
    assert.equal((await um(db, `SELECT timezone FROM public.partner_acesso_config WHERE partner_id = $1`, [e.partnerId])).timezone, 'America/Cuiaba');
  });

  test('rodar tudo de novo no mesmo banco não dá erro nem muda o estado (retrato antes e depois)', async () => {
    const antes = await foto(db);
    await migrar(db);
    await db.exec(ler(CONFERENCIA));
    const depois = await foto(db);
    assert.deepEqual(depois, antes);
  });

  test('a ordem do roteiro funciona também com a 004 e a 005 repetidas depois da 003 repetida', async () => {
    await migrar(db, [FASE5[2], M004, M005]);
    await db.exec(ler(CONFERENCIA));
  });
});

describe('limpar-sementes.sql', () => {
  const confirmar = (sql) => {
    assert.match(sql, /v_confirmo constant boolean := false;/);
    return sql.replace('v_confirmo constant boolean := false;', 'v_confirmo constant boolean := true;');
  };
  const contagens = async (db) => ({
    semLogin: await n(db, `SELECT count(*) AS n FROM public.profiles WHERE user_id IS NULL`),
    comLogin: await n(db, `SELECT count(*) AS n FROM public.profiles WHERE user_id IS NOT NULL`),
    empresas: await n(db, `SELECT count(*) AS n FROM public.partners`),
    quadros: await n(db, `SELECT count(*) AS n FROM public.crm_quadros`),
    fluxos: await n(db, `SELECT count(*) AS n FROM public.bot_fluxos`),
    passos: await n(db, `SELECT count(*) AS n FROM public.bot_passos`),
    colunas: await n(db, `SELECT count(*) AS n FROM public.crm_colunas`),
  });

  async function bancoMigradoComEmpresaReal() {
    const db = await bancoComoNoAr();
    await migrar(db);
    const real = await criarUsuario(db, { email: 'mentorado@x.com', empresa: 'Empresa Real' });
    await popularEmpresa(db, real, '5565999990000');
    return { db, real };
  }

  test('rodado inteiro sem trocar o false, não apaga nada; a conferência da parte 1 lista as 3 sementes e a empresa', async () => {
    const { db } = await bancoMigradoComEmpresaReal();
    const antes = await contagens(db);
    const resultados = await db.exec(ler(LIMPAR));
    assert.deepEqual(await contagens(db), antes);
    // o painel mostra o último resultado (a parte 3); a parte 1 é o primeiro
    assert.equal(Number(resultados.at(-1).rows[0].profiles_sem_login), 3);
    const primeiro = resultados[0].rows;
    assert.equal(primeiro.filter((r) => r.tipo === 'profile sem login').length, 3);
    const emp = primeiro.filter((r) => r.tipo === 'empresa-semente');
    assert.equal(emp.length, 1);
    assert.match(emp[0].quem, /Empresa Semente/);
    assert.equal(Number(emp[0].dados), 0);
  });

  test('com true: apaga as 3 sementes, a empresa-semente e o funil dela, e nada da empresa real', async () => {
    const { db, real } = await bancoMigradoComEmpresaReal();
    const antes = await contagens(db);
    assert.equal(antes.semLogin, 3);
    await db.exec(confirmar(ler(LIMPAR)));
    const depois = await contagens(db);
    assert.equal(depois.semLogin, 0);
    assert.equal(depois.comLogin, antes.comLogin, 'quem tem login não sai');
    assert.equal(depois.empresas, antes.empresas - 1);
    assert.equal(depois.quadros, antes.quadros - 1, 'o funil da semente sai (owner_id não tem chave estrangeira)');
    assert.equal(depois.fluxos, antes.fluxos - 1);
    assert.equal(depois.colunas, antes.colunas - 6);
    assert.equal(depois.passos, antes.passos, 'a semente não tem passos; os da empresa real ficam');
    assert.equal(await n(db, `SELECT count(*) AS n FROM public.partner_acesso_config`), 1);
    // a empresa real continua inteira
    assert.equal(await n(db, `SELECT count(*) AS n FROM public.bot_conversas`), 1);
    assert.equal(await n(db, `SELECT count(*) AS n FROM public.crm_cartoes WHERE quadro_id = $1`, [real.quadroId]), 1);
    assert.equal(await n(db, `SELECT count(*) AS n FROM public.bot_fluxos WHERE owner_id = $1`, [real.partnerId]), 1);
    const [fim] = (await db.exec(ler(LIMPAR).replace('v_confirmo constant boolean := false;', 'v_confirmo constant boolean := true;'))).slice(-1);
    assert.deepEqual(fim.rows[0], { profiles_sem_login: 0, empresas_sem_dono_com_login: 0, profiles_com_login: 1 });
  });

  test('rodar de novo depois de limpo não faz nada e não dá erro', async () => {
    const { db } = await bancoMigradoComEmpresaReal();
    await db.exec(confirmar(ler(LIMPAR)));
    const antes = await contagens(db);
    await db.exec(confirmar(ler(LIMPAR)));
    assert.deepEqual(await contagens(db), antes);
  });

  test('se a empresa-semente tiver conexão, cartão ou campanha, recusa e não apaga nada', async () => {
    const { db } = await bancoMigradoComEmpresaReal();
    const sem = await um(db, `SELECT id FROM public.partners WHERE fantasy_name = 'Empresa Semente'`);
    const antes = await contagens(db);

    await db.query(`INSERT INTO public.bot_conexoes (escopo, owner_id, nome) VALUES ('parceiro', $1, 'Numero de verdade')`, [sem.id]);
    await assert.rejects(db.exec(confirmar(ler(LIMPAR))), /Nada foi apagado/);
    assert.deepEqual(await contagens(db), antes);
    await db.query(`DELETE FROM public.bot_conexoes WHERE owner_id = $1`, [sem.id]);

    const col = await um(db, `SELECT c.id, c.quadro_id FROM public.crm_colunas c JOIN public.crm_quadros q ON q.id = c.quadro_id WHERE q.owner_id = $1 LIMIT 1`, [sem.id]);
    await db.query(`INSERT INTO public.crm_cartoes (quadro_id, coluna_id, titulo) VALUES ($1, $2, 'Lead de verdade')`, [col.quadro_id, col.id]);
    await assert.rejects(db.exec(confirmar(ler(LIMPAR))), /Nada foi apagado/);
    assert.deepEqual((await contagens(db)).semLogin, 3);
  });

  test('se um profile sem login participa de empresa com login, recusa e não apaga nada', async () => {
    const { db, real } = await bancoMigradoComEmpresaReal();
    const orfao = await um(db, `SELECT id FROM public.profiles WHERE email = 'admin@fitmind.com'`);
    await db.query(`INSERT INTO public.partner_members (partner_id, profile_id, papel, permissoes) VALUES ($1, $2, 'membro', ARRAY['crm'])`,
      [real.partnerId, orfao.id]);
    await assert.rejects(db.exec(confirmar(ler(LIMPAR))), /Nada foi apagado/);
    assert.equal((await contagens(db)).semLogin, 3);
  });

  test('depois da limpeza, criar o admin em Authentication e promover (o UPDATE do APLICAR-NO-AR.md, passo 6) funciona', async () => {
    const { db } = await bancoMigradoComEmpresaReal();
    await db.exec(confirmar(ler(LIMPAR)));
    await db.query(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('erick@exemplo.com', '{"name":"Erick"}')`);
    const nasceu = await um(db, `SELECT role, status FROM public.profiles WHERE email = 'erick@exemplo.com'`);
    assert.deepEqual(nasceu, { role: 'user', status: 'suspenso' });
    const guia = readFileSync(new URL('../../banco/APLICAR-NO-AR.md', import.meta.url), 'utf8');
    const update = guia.match(/```sql\n(UPDATE public\.profiles[\s\S]*?;)\n```/)[1].replace('seu-email@exemplo.com', 'erick@exemplo.com');
    assert.deepEqual(await linhas(db, update), [{ email: 'erick@exemplo.com', role: 'admin', status: 'ativo' }]);
  });

  test('sem limpar, usar o e-mail de uma semente para criar o admin dá erro (por isso a limpeza vem antes)', async () => {
    const { db } = await bancoMigradoComEmpresaReal();
    await assert.rejects(db.query(`INSERT INTO auth.users (email, raw_user_meta_data) VALUES ('admin@fitmind.com', '{}')`), /profiles_email_idx|duplicate key/);
  });
});

describe('APLICAR-NO-AR.md', () => {
  const md = readFileSync(new URL('../../banco/APLICAR-NO-AR.md', import.meta.url), 'utf8');

  test('cita os arquivos na ordem do roteiro', () => {
    const ordem = ['diagnostico-banco-vivo.sql', 'pg_cron', '001-fase0-seguranca.sql', '002-fase1-captura.sql', '003-dados-e-ia.sql',
      '004-ajustes-mentoria.sql', '005-achados-revisao.sql', '006-comprovantes.sql', 'conferencia-pos-migracao.sql', 'limpar-sementes.sql', 'agendamentos.sql'];
    let pos = -1;
    for (const nome of ordem) {
      const i = md.indexOf(nome, pos + 1);
      assert.ok(i > pos, `${nome} não aparece depois do anterior`);
      pos = i;
    }
  });

  test('não carrega a senha antiga nem segredo', () => {
    assert.ok(!new RegExp('itmind' + '123', 'i').test(md));
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(md), 'parece um token');
  });

  // blocos ```sql que começam com "-- confere": são consultas de conferência que o Erick cola no painel
  const BLOCO = new RegExp('```sql\\n(-- confere\\n[\\s\\S]*?)```', 'g');
  const confere = [...md.matchAll(BLOCO)].map((m) => m[1]);

  test('as 5 consultas de conferência rodam e dão o que o texto promete', async () => {
    assert.equal(confere.length, 5);
    // passo 1: no banco antigo (o do repositório; o do ar tem 3 corpos editados, mas assinatura e retorno são estes)
    const antigo = await bancoComoNoAr();
    const assinaturas = await linhas(antigo, confere[0]);
    assert.deepEqual(assinaturas.map((r) => [r.funcao, r.devolve]),
      [['bootstrap_empresa_completa', 'jsonb'], ['crm_criar_quadro', 'uuid'], ['partner_pode', 'boolean']]);
    assert.ok(md.includes(assinaturas[0].recebe) && md.includes(assinaturas[1].recebe) && md.includes(assinaturas[2].recebe),
      'a tabela do passo 1 diz o que a função recebe');

    const db = await bancoComoNoAr();
    await db.exec(ler(FASE5[0]));
    assert.deepEqual(await um(db, confere[1]), { colunas_de_senha: 0, anon_cria_empresa: false });
    await db.exec(ler(FASE5[1]));
    assert.deepEqual(await um(db, confere[2]), { base_de_contatos: true, ingestao: true, chave_do_robo: true });
    await db.exec(ler(FASE5[2]));
    assert.deepEqual(Object.values(await um(db, confere[3])).map(Number), [1, 1, 1]);
    await db.exec(ler(FASE5[3]));
    assert.deepEqual(await um(db, confere[4]), { fuso_da_semente: 'America/Cuiaba', tem_painel_do_mentor: true, tem_chave_de_privacidade: true });
    await db.exec(ler(FASE5[4]));
  });

  test('o UPDATE do passo do admin é o mesmo que o teste roda', () => {
    assert.match(md, /SET role = 'admin', status = 'ativo', expira_em = NULL/);
    assert.match(md, /WHERE user_id = \(SELECT id FROM auth\.users WHERE email = /);
  });
});
