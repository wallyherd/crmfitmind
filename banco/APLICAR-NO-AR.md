# Colocar o banco novo no ar — passo a passo

Para o Erick seguir no painel do Supabase. Leva uns 30 minutos. Cada passo diz **o que fazer**,
**o que você deve ver** e **o que fazer se der erro**.

## O que você vai fazer, em uma frase

O banco que está no ar é o esquema **antigo** do CRM, praticamente vazio (nenhum usuário de login, 1 empresa-semente, nenhuma
conversa). Você vai aplicar seis arquivos de atualização, na ordem, apagar as sementes antigas, criar o seu usuário e ligar os
agendamentos. Nada disso apaga conversa ou dado de cliente, porque **não há nenhum** no banco hoje.

## Antes de começar

- Abra o projeto **do CRM** no painel do Supabase e **confira o nome do projeto no topo da tela**. Não cole nada em outro projeto.
- Tenha os arquivos abertos no computador (pasta `banco` do repositório): `diagnostico-banco-vivo.sql`, `migracoes/001` a `006`,
  `conferencia-pos-migracao.sql`, `limpar-sementes.sql` e `agendamentos.sql`.
- Para o passo 8 você vai precisar do endereço do CRM na Vercel e do valor do `CRON_SECRET` da Vercel. Se o site novo ainda não
  foi publicado, faça os passos 1 a 7 agora e deixe o 8 para depois: não há pressa nele.
- **O site novo só deve ir para a Vercel depois do passo 7.** O servidor novo precisa das colunas e funções que estas atualizações criam.

### Como rodar um arquivo (vale para todos os passos)

1. Menu da esquerda → **SQL Editor** → **New query** (uma aba em branco).
2. Abra o arquivo no computador, copie **tudo** (Ctrl+A, Ctrl+C) e cole na aba.
3. Clique em **Run** (ou Ctrl+Enter).
4. Se o painel avisar *"Potential issue detected… destructive operations"* (aparece nas atualizações, porque elas apagam
   policies antigas e a coluna de senha), é esperado: confirme com **Run this query**.
5. Resultado bom: **"Success. No rows returned"**. Cada atualização roda **dentro de uma transação**: se qualquer linha der erro,
   **nada** é gravado, e você pode corrigir e rodar de novo.

Todas as atualizações podem ser rodadas de novo sem estragar nada. Rodar uma de novo é sempre seguro, com **uma exceção**
(explicada no fim): se você repetir a 001, a 002 ou a 003, repita também a 004, a 005 e a 006 em seguida.

---

## Passo 1 — Tirar uma foto do banco antes de mexer

**Fazer:** rodar `diagnostico-banco-vivo.sql`. Só lê; não muda nada.

**Esperar:** uma linha com uma coluna `diagnostico` (um texto JSON grande). Clique na célula e copie, ou use
**Export → Download CSV**. Guarde o arquivo. Confira, perto do fim, o bloco `contagens`: tem que continuar como em 09/10
(`auth_users` 0, `profiles` 3, `partners` 1, `partner_members` 1, `bot_conexoes` 0, `bot_conversas` 0, `crm_cartoes` 0).

**Se não bater:** alguém usou o banco depois de 09/10. **Pare aqui** e mande o JSON novo antes de seguir.

Depois, numa aba nova, rode esta consulta (só lê). Ela confere três funções que alguém editou à mão no banco no ar e que as
atualizações vão substituir:

```sql
-- confere
SELECT p.proname AS funcao, pg_get_function_result(p.oid) AS devolve, pg_get_function_arguments(p.oid) AS recebe
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('partner_pode', 'crm_criar_quadro', 'bootstrap_empresa_completa')
 ORDER BY 1;
```

**Esperar:** 3 linhas:

| funcao | devolve | recebe |
|---|---|---|
| `bootstrap_empresa_completa` | `jsonb` | `_user_id uuid DEFAULT NULL::uuid, _empresa_nome text DEFAULT 'Minha Empresa'::text, _cidade text DEFAULT NULL::text, _estado text DEFAULT NULL::text` |
| `crm_criar_quadro` | `uuid` | `_escopo text, _owner_id uuid, _nome text, _tipo text DEFAULT 'funil'::text` |
| `partner_pode` | `boolean` | `_partner_id uuid, _permissao text` |

**Se for diferente:** não rode as atualizações. Copie as 3 linhas e mande. (O Postgres não deixa trocar o tipo de retorno de uma
função nem tirar um valor padrão com `CREATE OR REPLACE`; se for esse o caso, a 001 pararia com erro `42P13` e desfaria tudo,
sem estrago, mas é melhor saber antes.)

---

## Passo 2 — Ligar `pg_cron` e `pg_net`

**Fazer:** menu da esquerda → **Database** → **Extensions**. Procure `pg_cron`, ligue o botão. Procure `pg_net`, ligue o botão.
Deixe o schema que o painel sugerir.

**Esperar:** as duas aparecem como ligadas (*enabled*). No diagnóstico de 09/10 nenhuma das duas estava ligada.
O Vault (`supabase_vault`) já está ligado.

**Se der erro:** *"permission denied"* ou o botão não liga: confirme que você é Owner do projeto. Se continuar, mande a mensagem.
Os passos 3 a 7 não dependem disso; só o passo 8 depende.

---

## Passo 3 — Aplicar as atualizações 001 a 006, uma por vez, nesta ordem

Rode **um arquivo por aba**, esperando o *Success* antes do próximo. Não pule nenhum e não inverta a ordem.

### 3.1 — `migracoes/001-fase0-seguranca.sql`

**O que faz:** fecha as brechas do banco antigo. Tira a coluna `senha_hash` (a senha em texto puro dos admins antigos), liga a
proteção por linha, recria as regras de acesso, esconde `webhook_segredo` e tira de `anon`/`authenticated` o direito de executar
funções como `bootstrap_empresa_completa` (que hoje qualquer pessoa na internet poderia chamar para criar empresa e admin).

**Esperar:** *Success. No rows returned*. Conferir (cole numa aba nova):

```sql
-- confere
SELECT (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'senha_hash') AS colunas_de_senha,
       has_function_privilege('anon', 'public.bootstrap_empresa_completa(uuid,text,text,text)', 'EXECUTE') AS anon_cria_empresa;
```

Tem que dar `0` e `false`.

**Opcional:** a senha antiga só some do disco quando o Postgres reescreve a tabela. Rode, sozinho numa aba:
`VACUUM FULL public.profiles;`. Se o painel responder *"cannot run inside a transaction block"*, ignore: a coluna já foi apagada
e essas linhas são apagadas no passo 5. A senha antiga esteve no GitHub público, então considere-a perdida de qualquer forma; nunca
a reutilize em lugar nenhum.

### 3.2 — `migracoes/002-fase1-captura.sql`

**O que faz:** captura do WhatsApp no servidor (fila, arquivo completo, trava do robô). Todas as conexões ficam com o robô
**desligado**; no banco no ar não existe nenhuma conexão, então nada muda na prática.

**Esperar:** *Success*. Conferir:

```sql
-- confere
SELECT to_regclass('public.wa_contatos_base') IS NOT NULL AS base_de_contatos,
       EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bot_registrar_eventos') AS ingestao,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bot_conexoes' AND column_name = 'bot_ativo') AS chave_do_robo;
```

Tem que dar `true`, `true`, `true`.

### 3.3 — `migracoes/003-dados-e-ia.sql`

**O que faz:** contatos, métricas do dia, lote da IA sem telefone, vendas, follow-ups, e o bucket privado `conversas-ia` no Storage.
É o arquivo maior; pode levar alguns segundos.

**Esperar:** *Success*. Conferir:

```sql
-- confere
SELECT (SELECT count(*) FROM storage.buckets WHERE id = 'conversas-ia' AND public = false) AS bucket_privado,
       to_regclass('public.vendas') IS NOT NULL AS tem_vendas,
       to_regclass('public.ia_lotes') IS NOT NULL AS tem_lotes;
```

Tem que dar `1`, `true`, `true`.

### 3.4 — `migracoes/004-ajustes-mentoria.sql`

**O que faz:** fuso padrão **Cuiabá**; a empresa-semente que estava em São Paulo passa para Cuiabá; privacidade do mentorado
(você, como admin, só lê conversas de quem liberar) e o painel do mentor.

**Esperar:** *Success*. Conferir:

```sql
-- confere
SELECT (SELECT timezone FROM public.partner_acesso_config LIMIT 1) AS fuso_da_semente,
       to_regprocedure('public.mentor_painel(date)') IS NOT NULL AS tem_painel_do_mentor,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                AND table_name = 'partner_acesso_config' AND column_name = 'mentor_pode_ver_conversas') AS tem_chave_de_privacidade;
```

Tem que dar `America/Cuiaba`, `true`, `true`.

### 3.5 — `migracoes/005-achados-revisao.sql`

**O que faz:** travas da revisão de segurança (o navegador não troca o dono de quadro, campanha e fluxo; o texto do relatório
sai do navegador; apagamento LGPD completo).

**Esperar:** *Success*.

### 3.6 — `migracoes/006-comprovantes.sql`

**O que faz:** guarda a imagem ou o PDF que o **cliente** manda (comprovante de pagamento), para o mentorado ver o arquivo na
hora de confirmar uma venda. Cria o bucket **privado** `comprovantes` (só o servidor lê e grava; o navegador recebe um link que
vale 60 segundos), a coluna `arquivo_path` na mensagem e a fila de arquivos a apagar. Passados **90 dias**, a manutenção diária
apaga o arquivo; a LGPD (apagar a pessoa) e marcar a conversa como "só metadados" ou "não registrar" também apagam. O arquivo
**nunca** confirma uma venda sozinho.

**Esperar:** *Success*. Se aparecer a nota *"sem permissao para criar a policy em storage.objects"*, tudo bem: o bucket continua
fechado (não há nenhuma policy para o navegador); a conferência do passo 4 confirma.

### Se alguma atualização der erro

1. **Não rode a seguinte.** Nada foi gravado pela que falhou (é uma transação), mas as anteriores ficaram.
2. Copie a mensagem **inteira**, com o número da linha, e o nome do arquivo.
3. Erros que você pode reconhecer:
   - `relation "…" does not exist` ou `function … does not exist`: uma atualização anterior foi pulada. Volte e rode na ordem.
   - `42P13` / *cannot change return type* / *cannot remove parameter defaults*: uma das três funções editadas à mão (passo 1)
     é diferente do esperado. Mande a mensagem; não tente consertar.
   - `canceling statement due to statement timeout`: rode a mesma atualização de novo (é seguro).
   - `must be owner of …`: o editor não está rodando como `postgres`. Recarregue a página e confira o projeto.

---

## Passo 4 — Conferência das travas

**Fazer:** rodar `conferencia-pos-migracao.sql`. Só lê.

**Esperar:** nenhuma mensagem de erro. Dependendo da versão do painel, aparece a nota
*"OK: policies de conteúdo, travas da 005, colunas do relatório, Realtime, Storage e comprovantes (006) conferidos."* ou só *Success*.

**Se der erro:** a mensagem começa com *"Conferencia falhou:"* e lista, linha por linha, o que está errado. Mande a lista. Se
a lista falar em *"policy sem a guarda do opt-in"* ou *"falta o gatilho travar_dono"*, rode de novo a `004`, a `005` e a `006` e repita
esta conferência.

---

## Passo 5 — Apagar as sementes antigas (opcional, mas recomendado)

**O que são:** 3 perfis **sem login** que sobraram da época da senha mestra (dois admins `admin@fitmind.com` e
`admin@fitmind.com.br`, mais o dono de uma empresa-semente) e a empresa-semente com o funil dela. A atualização 001 já os
deixou suspensos e sem senha, então eles **não representam risco**; apagar só deixa o banco limpo e libera o e-mail
`admin@fitmind.com` caso um dia queira usá-lo. Este passo **apaga dados**, por isso está num arquivo separado.

**Fazer:**

1. Abra `limpar-sementes.sql` numa aba nova. Com o mouse, **selecione só o trecho "PARTE 1"** (do `WITH sem_login AS` até o
   primeiro `;`) e clique em **Run** (o botão passa a dizer *Run selected*).
2. **Esperar 4 linhas:** três `profile sem login` e uma `empresa-semente` (chamada `Empresa Semente` ou parecida), com a coluna
   `dados` em **0** na empresa. Se aparecer mais alguma coisa, ou `dados` maior que 0, **não apague**: mande o resultado.
3. Se for isso, ache no arquivo a linha `v_confirmo constant boolean := false;  -- <<< TROQUE false POR true…` e troque
   `false` por `true`. Agora rode o arquivo **inteiro** (Ctrl+A e Run).
4. **Esperar** uma última linha com `profiles_sem_login = 0`, `empresas_sem_dono_com_login = 0` e `profiles_com_login = 0`.

**Se o arquivo não trocar nada e você só quis ver:** rodar o arquivo inteiro **sem** trocar o `false` não apaga nada.

**Se der erro:** o arquivo se recusa a apagar (com a frase *"Nada foi apagado"*) se a empresa tiver conexão, cartão ou campanha
de verdade, ou se um perfil sem login estiver numa empresa com gente de login. Nesse caso nada foi apagado: mande a mensagem.

**Não pule a ordem:** faça este passo **antes** do passo 6. Se um perfil sem login com o mesmo e-mail ainda existir quando você
criar o seu usuário, o Supabase responde *"Database error saving new user"*.

---

## Passo 6 — Criar o seu usuário admin

**Fazer:**

1. Menu da esquerda → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Preencha **o seu e-mail de verdade** (não use `admin@fitmind.com`) e uma senha forte e nova. Marque **Auto Confirm User**.
   Clique em **Create user**.
3. No **SQL Editor**, troque `seu-email@exemplo.com` pelo e-mail que você acabou de cadastrar e rode:

```sql
UPDATE public.profiles
   SET role = 'admin', status = 'ativo', expira_em = NULL
 WHERE user_id = (SELECT id FROM auth.users WHERE email = 'seu-email@exemplo.com')
RETURNING email, role, status;
```

**Esperar:** uma linha: o seu e-mail, `admin`, `ativo`.

**Se vier 0 linhas:** o e-mail está diferente do cadastrado em Authentication (confira maiúsculas e espaços), ou o usuário não
foi criado.

**Recomendado:** **Authentication** → **Sign In / Providers** → desligue **Allow new users to sign up**. Conta nova nasce
**suspensa**, mas assim ninguém de fora sequer cria conta; os próximos usuários você cria pela tela do CRM.

---

## Passo 7 — Publicar o site novo na Vercel

Agora o banco está pronto para o servidor novo. Publique o site (esta parte está no `EXECUCAO.md`, bloco C). Só depois disso
o passo 8 faz sentido.

---

## Passo 8 — Agendamentos (`agendamentos.sql`)

É o que faz o CRM exportar o lote do dia, enviar à IA e coletar o resultado sozinho.

**Antes:** o passo 2 (extensões) feito, o site publicado e o `CRON_SECRET` da Vercel em mãos.

**Fazer:**

1. Numa aba nova, guarde no Vault o endereço do CRM e o segredo. Troque os dois textos e rode **só estas duas linhas**:

```sql
select vault.create_secret('https://SEU-CRM.vercel.app', 'crm_url_base');
select vault.create_secret('COLE-AQUI-O-CRON_SECRET', 'crm_cron_secret');
```

   **Esperar:** cada uma devolve um id (um código comprido). O segredo **não** fica escrito em arquivo nenhum e não deve ser
   colado em conversa.
2. Rode `agendamentos.sql` inteiro. **Esperar:** *Success*. Pode rodar de novo à vontade: os 4 agendamentos são recriados.
3. Conferir:

```sql
select jobname, schedule, active from cron.job where jobname like 'crm-%';
```

   **Esperar 5 linhas** (`crm-exportar`, `crm-ia-enviar`, `crm-ia-coletar`, `crm-ler-comprovantes`, `crm-manutencao`), todas com `active = true`.
4. Quinze minutos depois, veja as respostas do site:

```sql
select status_code, created from net._http_response order by created desc limit 10;
```

   **Esperar:** `status_code` 200. **401** = o `CRON_SECRET` do Vault é diferente do da Vercel (troque com
   `select vault.update_secret(id, 'novo valor') from vault.secrets where name = 'crm_cron_secret';`). **404** = o site novo
   ainda não está no ar com as rotas `/api/cron/*`.

**Se der erro:** *"extension pg_cron is not available"* ou *"schema cron does not exist"*: o passo 2 não foi feito. Volte nele.
*"faltam os segredos crm_url_base e crm_cron_secret no Vault"* (aparece em `net._http_response` ou ao testar
`select public.crm_chamar_cron('manutencao');`): refaça o item 1.

---

## Passo 9 — Conferência final

Rode de novo `diagnostico-banco-vivo.sql` e compare com a foto do passo 1. Tem que estar assim:

- em `funcoes`, `bootstrap_empresa_completa` com `execute_anon` e `execute_authenticated` **false**;
- `grants_bot_conexoes_webhook_segredo`: `anon` e `authenticated` **false**;
- `storage_buckets`: aparece `conversas-ia` com `public` = `false`;
- `cron_jobs`: os 4 agendamentos `crm-…` (depois do passo 8);
- em `contagens`: `profiles_sem_user_id` 0 (depois do passo 5) e `auth_users` 1 (depois do passo 6).

Rode também `conferencia-pos-migracao.sql` uma última vez.

---

## Para guardar

- **Repetir uma atualização é seguro, mas...** a 001, a 002 e a 003 recriam as regras antigas de acesso e devolvem ao admin a
  leitura de conteúdo. Se você repetir qualquer uma delas, rode em seguida a **004, a 005 e a 006** e a conferência (passo 4).
- **Empresa cujo dono seja o admin:** a tela antiga criava empresa com o admin como `owner`. No banco no ar a única empresa era a
  semente (apagada no passo 5). Se um dia achar outra assim, passe o `owner` para o mentorado antes de contar com a privacidade.
- **Um resto inofensivo:** o banco no ar tem um índice único em `profiles.email` (`profiles_email_idx`) que o banco novo não tem.
  Ele vem do script antigo dos admins e não atrapalha; só impede dois perfis com o mesmo e-mail.
- **Se algo der muito errado:** não tente consertar à mão. O banco no ar tinha só sementes, então o pior caso é refazer o projeto
  do Supabase do zero com `banco-instalar-completo.sql`, `banco-retroalimentacao.sql` e as seis atualizações (ver `LEIA-ME.md`).
