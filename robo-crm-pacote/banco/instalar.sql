-- Instala tudo de uma vez, pelo psql, a partir desta pasta:
--
--   psql "postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres" -f instalar.sql
--
-- Ou tudo ou nada: se qualquer linha falhar, nada fica gravado.
--
-- check_function_bodies = off NAO e opcional. Varias funcoes em SQL puro
-- chamam outras que so sao criadas depois (bot_acesso_conexao chama
-- bot_acesso_dono; bot_contar_envio chama bot_dia_da_conexao). Com a
-- checagem ligada, o Postgres recusa a primeira. O pg_dump faz o mesmo.

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL check_function_bodies = off;
\ir 00-dependencias.sql
\ir 01-robo-crm.sql
\ir 02-conector-versoes.sql
COMMIT;
