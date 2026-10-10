// banco/migracoes/001-fase0-seguranca.sql: idempotente e capaz de consertar um banco afrouxado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { novoBanco, ler, MIGRACOES } from './pg.mjs';

const M001 = ler(MIGRACOES[0]);

// Retrato do que decide acesso: RLS, policies, privilégios de tabela/coluna/função e colunas de profiles.
async function retrato(db) {
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    rls: await q(`SELECT relname, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND relkind = 'r' ORDER BY relname`),
    policies: await q(`SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies
                       WHERE schemaname = 'public' ORDER BY tablename, policyname`),
    tabelas: await q(`SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
                      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role')
                      ORDER BY 1, 2, 3`),
    colunas: await q(`SELECT table_name, column_name, grantee, privilege_type FROM information_schema.column_privileges
                      WHERE table_schema = 'public' AND table_name = 'bot_conexoes' AND grantee IN ('anon', 'authenticated')
                      ORDER BY 1, 2, 3, 4`),
    funcoes: await q(`SELECT p.oid::regprocedure::text AS f,
                             has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                             has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                             has_function_privilege('service_role', p.oid, 'EXECUTE') AS servico
                      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' ORDER BY 1`),
    profiles: await q(`SELECT column_name FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'profiles' ORDER BY 1`),
    gatilho: await q(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal`),
  };
}

test('001 roda duas vezes num banco novo, sem erro e sem mudar nada', async () => {
  const db = await novoBanco();
  const antes = await retrato(db);
  await db.exec(M001);
  const depois1 = await retrato(db);
  await db.exec(M001);
  const depois2 = await retrato(db);
  assert.deepEqual(depois1, antes, 'o instalador já deve sair no mesmo estado da 001');
  assert.deepEqual(depois2, depois1);
});

test('o bloco de permissões é o mesmo no instalador e na 001', () => {
  const bloco = (txt) => {
    const i = txt.indexOf('-- >>> permissoes');
    const j = txt.indexOf('-- <<< permissoes');
    assert.ok(i >= 0 && j > i, 'marcadores do bloco');
    return txt.slice(i, j).replace(/\r\n/g, '\n');
  };
  assert.equal(bloco(ler('banco-instalar-completo.sql')), bloco(M001));
});

test('toda função do esquema base está na lista do bloco de permissões', async () => {
  const db = await novoBanco();
  const { rows } = await db.query(
    `SELECT DISTINCT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'`);
  const bloco = M001.slice(M001.indexOf('funcoes_crm text[]'), M001.indexOf('funcoes_usuario text[]'));
  for (const { proname } of rows) assert.ok(bloco.includes(`'${proname}'`), `função fora da lista: ${proname}`);
});

test('001 conserta um banco antigo afrouxado e chega no mesmo estado do instalador', async () => {
  const referencia = await retrato(await novoBanco({ extras: MIGRACOES }));

  const db = await novoBanco();
  // O que o banco no ar pode ter: senha em texto, RLS desligada, policy aberta,
  // grants padrão do Supabase, funções liberadas, gatilho sumido, admin semeado.
  await db.exec(`
    ALTER TABLE public.profiles ADD COLUMN senha_hash text;
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_status_check;
    ALTER TABLE public.ia_retroalimentacao_config DISABLE ROW LEVEL SECURITY;
    ALTER TABLE public.ia_relatorios_diarios DISABLE ROW LEVEL SECURITY;
    ALTER TABLE public.bot_mensagens DISABLE ROW LEVEL SECURITY;
    DROP POLICY "Ler relatorios da minha empresa" ON public.ia_relatorios_diarios;
    DROP POLICY "Ver meu profile" ON public.profiles;
    CREATE POLICY "aberto" ON public.bot_mensagens FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
    CREATE POLICY "aberto" ON public.ia_retroalimentacao_config FOR SELECT USING (true);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated;
    CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
      SET search_path TO 'public' AS $f$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = _user_id AND role = 'admin') $f$;
    DROP TRIGGER trg_criar_profile_do_usuario ON auth.users;
    INSERT INTO auth.users (email) VALUES ('sem-profile@x.com');
    INSERT INTO public.profiles (email, role, senha_hash) VALUES ('admin@fitmind.com', 'admin', 'qualquer');
  `);

  await db.exec(M001);
  await db.exec(M001);

  assert.deepEqual(await retrato(db), referencia);

  const { rows: [semProfile] } = await db.query(
    `SELECT p.status FROM public.profiles p JOIN auth.users u ON u.id = p.user_id WHERE u.email = 'sem-profile@x.com'`);
  assert.equal(semProfile.status, 'suspenso', 'usuário do Auth sem profile ganha um, suspenso');
  const { rows: [semeado] } = await db.query(`SELECT role, status FROM public.profiles WHERE email = 'admin@fitmind.com'`);
  assert.deepEqual(semeado, { role: 'user', status: 'suspenso' });
});
