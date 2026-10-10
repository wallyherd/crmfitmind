# Banco do CRM

Tudo roda no SQL Editor do Supabase (projeto do CRM), colando o arquivo inteiro.

| Arquivo | Para quê |
|---|---|
| `../banco-instalar-completo.sql` | Esquema inteiro, para um projeto **vazio** |
| `../banco-retroalimentacao.sql` | Tabelas da retroalimentação de IA (pode rodar de novo) |
| `migracoes/001-fase0-seguranca.sql` | Fase 0 num banco que **já existe**. Idempotente |
| `migracoes/002-fase1-captura.sql` | Fase 1 (captura do WhatsApp, fila com reserva, arquivo completo). Idempotente |
| `migracoes/003-dados-e-ia.sql` | Fases 2 e 3 (contatos, métricas do dia, lote da IA, vendas, follow-ups, retroalimentação). Idempotente |
| `migracoes/004-ajustes-mentoria.sql` | Ajustes da mentoria: fuso Cuiabá; privacidade do mentorado (o admin só lê conteúdo com o opt-in do dono) e `mentor_painel`. Idempotente |
| `migracoes/005-achados-revisao.sql` | Achados da revisão N7: o navegador não muda o dono de quadro/campanha/fluxo; o texto do relatório e os ids de lote saem do navegador; LGPD completa (alvos, grupos, conversa sem contato, nome no resumo, arquivo pendente e lote refeito); alertas do painel sem ruído. Idempotente |
| `migracoes/006-comprovantes.sql` | Comprovantes (imagem/PDF que o cliente manda): bucket privado `comprovantes`, coluna `bot_mensagens.arquivo_path`, fila `comprovantes_apagar`, funções `comprovante_preparar`/`comprovante_registrar`; retenção de 90 dias em `crm_retencao`; `lgpd_apagar_contato` devolve os comprovantes da pessoa; mudar a privacidade da conversa também apaga. Idempotente |
| `conferencia-pos-migracao.sql` | Só leitura: **falha** se alguma policy de conteúdo não passa pela guarda do opt-in, se faltam as travas da 005, se o Realtime publica tabela de conteúdo ou se uma policy do Storage abre o bucket `conversas-ia`. Rode depois de qualquer migração |
| `agendamentos.sql` | pg_cron + pg_net chamando as rotas `/api/cron/*` (roda uma vez, depois da 003) |
| `diagnostico-banco-vivo.sql` | Só leitura: foto do banco no ar (estrutura, RLS, policies) |
| `APLICAR-NO-AR.md` | **Passo a passo para o banco que já está no ar** (extensões, 001 a 006, conferência, sementes, usuário admin, agendamentos), com o que esperar e o que fazer se der erro |
| `limpar-sementes.sql` | Opcional e separado: apaga os 3 profiles sem login e a empresa-semente do banco antigo. Só apaga se `false` virar `true` no arquivo; recusa se houver dado de verdade |

## Banco novo

1. `banco-instalar-completo.sql`
2. `banco-retroalimentacao.sql`
3. `migracoes/001-fase0-seguranca.sql` (não muda nada num banco recém-instalado, mas mantém a sequência)
4. `migracoes/002-fase1-captura.sql` — **obrigatória**: o instalador ainda é o esquema da Fase 0, e o
   servidor da Fase 1 depende das colunas e funções que só a 002 cria.
5. `migracoes/003-dados-e-ia.sql`.
6. `migracoes/004-ajustes-mentoria.sql`.
7. `migracoes/005-achados-revisao.sql`.
8. `migracoes/006-comprovantes.sql`.
9. `conferencia-pos-migracao.sql` (tem que terminar em `OK`).
10. `agendamentos.sql` (ver a seção Fases 2 e 3).

## Banco que já existe (o que está no ar)

O roteiro para seguir no painel é o `APLICAR-NO-AR.md`. O teste `testes/banco/10-banco-no-ar.test.mjs` reconstrói um banco igual ao do
diagnóstico de 09/10 (instalador antigo + sementes) e prova que 001→005 rodam por cima dele e chegam ao estado de um banco novo.
O que segue abaixo é a descrição do que cada migração muda.

1. Rodar `diagnostico-banco-vivo.sql` e guardar o JSON (antes de mudar qualquer coisa).
2. `banco-retroalimentacao.sql` (cria as tabelas de IA se faltarem e liga a RLS delas).
3. `migracoes/001-fase0-seguranca.sql`. Roda numa transação: se der erro, nada muda.
   Ela tira `profiles.senha_hash`, liga RLS, **apaga todas as policies** das tabelas do CRM
   e recria as do instalador, esconde `bot_conexoes.webhook_segredo` e revoga as funções
   de ação de `anon`/`authenticated`.
4. Depois:
   - `VACUUM FULL public.profiles;` (sozinho, fora de transação) para a senha apagada sair do disco.
   - Em Authentication > Users, apagar qualquer `admin@fitmind.com*` (a 001 já suspendeu o profile).
   - Trocar os segredos dos conectores (os conectores em uso precisam ser configurados de novo):
     `UPDATE public.bot_conexoes SET webhook_segredo = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');`
5. `migracoes/002-fase1-captura.sql` (pode ser no mesmo dia; também roda numa transação).
   O que muda para quem já usa:
   - **o robô fica desligado em todas as conexões** (`bot_ativo = false`). Desligado = nenhum envio
     pela conexão (nem do CRM nem de campanha). Liga na tela Conectar WhatsApp, conexão por conexão
     (nas conexões `pc` também: Opções do cartão da conexão; o `botAtivo` do `config.json` do PC não liga nada);
   - conexão nova pela tela nasce no modo `gateway`; as que já existem ficam no modo `pc`;
   - conversa de grupo gravada pelo conector antigo vira `tipo = 'grupo'`, sem telefone e sem robô;
     conversa por LID (`…@lid`) deixa de ter os dígitos do LID como telefone;
   - mensagem que estava na fila ganha o `wa_id` que o gateway vai usar (o eco não duplica).
   - **o navegador deixa de gravar direto** o que alimenta a fila e o gateway: `bot_mensagens` só aceita campanha
     (e só em conexão `pc`), `bot_conversas` só aceita criar com telefone e mudar privacidade/estado,
     `bot_conexoes` só aceita criar conexão `pc` e renomear. Quem usar a chave anon fora do CRM para escrever
     nessas tabelas passa a receber `permission denied`;
   - nova tabela `gateway_assinaturas_vistas` (a assinatura do gateway não vale duas vezes);
   - o fuso de cada empresa é o de `partner_acesso_config.timezone` (padrão `America/Cuiaba`; a 004
     converte as linhas que estavam em `America/Sao_Paulo`)
   Rodar a 001 de novo depois da 002 não desfaz nada da 002, exceto a policy "Criar conexao no meu escopo"
   (volta a ser a da 001; as colunas liberadas continuam travando). Rode a 002 de novo se rodar a 001.
   Rodar a 001, a 002 ou a 003 de novo **devolve ao admin a leitura do conteúdo** (elas recriam as
   policies antigas): rode a 004, a 005 **e a 006** de novo logo depois e confira com `conferencia-pos-migracao.sql`.
   Empresas que já existem e têm o admin como `owner` em `partner_members` (a tela antiga criava assim) precisam passar
   o `owner` para o mentorado antes de contar com a privacidade: o servidor novo já não cria empresa assim, mas não
   corrige as que existem (script de dados no N9).
   **Antes de subir o servidor novo:** conector antigo do PC passa a funcionar em modo "offline" (grava as
   conversas, não aciona o robô); o ideal é trocar para `gateway/pc.mjs`.

## Conferir o banco, passo a passo

Tudo no painel do Supabase, no projeto **do CRM** (confira o nome no topo antes de colar qualquer coisa).

1. Menu da esquerda > **SQL Editor** > **New query** (aba em branco).
2. Abra `diagnostico-banco-vivo.sql` no computador, copie o arquivo **inteiro** e cole na aba.
3. Clique em **Run** (ou Ctrl+Enter). Ele só lê: não muda nada e não traz telefone, mensagem nem senha.
4. O resultado é **uma linha** com uma coluna `diagnostico`. O valor é um JSON grande e a grade corta
   o texto: clique na célula e use o botão de copiar do visualizador, ou **Export > Download CSV**.
   Guarde o arquivo antes de rodar qualquer migração.
5. Se aparecer erro, copie a mensagem inteira (com o número da linha) e mande junto: o script foi
   escrito sem acesso ao banco no ar e pode tropeçar em alguma diferença dele.

Depois da 002, estas três consultas curtas (uma por vez) confirmam que ela entrou:

```sql
-- tudo true
SELECT to_regclass('public.wa_contatos_base') IS NOT NULL AS base_de_contatos,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bot_registrar_eventos') AS ingestao,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bot_conexoes' AND column_name = 'bot_ativo') AS chave_do_robo;

-- bot_ativo = false em todas, até alguém ligar na tela
SELECT modo, bot_ativo, count(*) FROM public.bot_conexoes GROUP BY 1, 2 ORDER BY 1, 2;

-- só as 4 funções que as policies usam: bot_acesso_conexao, bot_acesso_dono, bot_acesso_fluxo, bot_clonar_fluxo
SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'bot\_%'
   AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
 ORDER BY 1;
```

## Fase 1: o que a 002 deixa pronto

- `bot_registrar_eventos(conexao, eventos)`: o lote do `POST /api/bot/eventos` numa ida ao banco,
  com erro por evento. Só o servidor (service role) executa.
- `bot_reservar_fila` / `bot_confirmar_envio`: fila com reserva de 15 min e no máximo 3 entregas.
  No gateway (VPS) nunca sai campanha e só sai para quem já escreveu.
- `bot_arquivo_completo`: dados do .txt completo que o dono baixa. O texto é montado no servidor e
  nunca é gravado (nem no Storage).
- `wa_contatos_base`: conversas antigas que o histórico do pareamento trouxe, sem corpo.
- Privacidade da conversa (`normal` / `so_metadados` / `ignorar`) marcada à mão apaga o texto
  que já estava gravado (gatilho).
- Travas do robô no banco: nada automático nem da fila em grupo (gatilho) e grupo nunca em `estado = 'bot'`.

## Primeiro admin

Conta nova nasce **suspensa** (o gatilho de `auth.users` cria o profile assim); quem libera é um admin.
O primeiro é feito à mão:

1. Authentication > Users > Add user > Create new user, com "Auto Confirm User" marcado.
2. No SQL Editor:

```sql
UPDATE public.profiles
   SET role = 'admin', status = 'ativo', expira_em = NULL
 WHERE user_id = (SELECT id FROM auth.users WHERE email = 'seu-email@exemplo.com');
```

Os próximos usuários o admin cria pela tela (POST `/api/admin/usuarios`), já ativos.
Recomendado: em Authentication > Sign In / Providers, desligar "Allow new users to sign up".

## Coluna nova em `bot_conexoes`

O navegador só lê as colunas liberadas uma a uma (o segredo fica de fora). Migração que
acrescentar coluna precisa liberar a coluna para `authenticated`, ou repetir o bloco
`-- >>> permissoes` da 001.

## Testes

`cd testes && npm test` sobe um Postgres embutido (PGlite) com o mínimo do Supabase e confere
instalação do zero, a 001 rodando duas vezes, a 001 consertando um banco afrouxado, o
isolamento entre empresas (também depois da 002), em `04-fase1` a 002 rodando duas vezes e
a ingestão com os exemplos do `gateway/CONTRATO.md`, e em `05-fase23` a 003 (métricas, lote sem telefone,
análise com venda forçada, isolamento e funções revogadas).

## Fases 2 e 3 (`migracoes/003-dados-e-ia.sql`)

Roda depois da 002, numa transação, e pode rodar de novo. **Se rodar a 001 de novo, rode a 003 depois**:
a 001 volta o funil padrão antigo (`bootstrap_empresa_completa`).

O que muda para quem já usa:
- `ia_retroalimentacao_config` perde `github_*`, `gemini_api_key` e `horario_execucao` (o módulo antigo de
  Gemini/GitHub sai na Fase 2) e ganha `motor` (`manual` por padrão), `limiar_confianca`, `consentimento_ia_em`,
  `autoconfirmar_pix` (desligado) e `teto_autoconfirmacao`. Linha repetida da mesma empresa é apagada (fica a mais nova).
- `ia_relatorios_diarios`: relatório repetido do mesmo dia é apagado (fica o mais novo); ganha `metricas` (números do SQL),
  `ia_estimativas` e `resumo` (opinião da IA).
- Cada conversa ganha um `contatos` (por telefone; grupo e LID pelo jid). Quem veio do histórico do pareamento
  (`wa_contatos_base`) vira `base_existente` e não conta como conversa nova.
- Colunas de funil ganham `etapa_chave` pelo nome/tipo; o que não casar o mentorado mapeia na tela.
  Quadro novo nasce com: Novo contato, Em atendimento, Proposta enviada, Negociando, Aguardando pagamento, Ganho, Perdido, Pós-venda.
- Bucket privado `conversas-ia` (só o servidor lê e grava). Caminho: `{partner}/{dia}[-pN][-vN].txt`.

Agendamento (`agendamentos.sql`): ligar pg_cron e pg_net, guardar no Vault `crm_url_base` e `crm_cron_secret`
(o mesmo `CRON_SECRET` da Vercel) e rodar o arquivo. Exportar e manutenção a cada 15 min, envio ao Batch de hora em hora,
coleta a cada 30 min.

Lote de exemplo gerado pelo SQL: `testes/banco/fixtures/lote-exemplo.txt` (`cd testes && node banco/gerar-lote-exemplo.mjs`).
