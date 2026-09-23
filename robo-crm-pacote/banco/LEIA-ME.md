# Banco — robô de WhatsApp + CRM

Postgres do **Supabase** (usa `auth.users`, `auth.uid()` e o papel `authenticated`).

| Arquivo | O que tem |
|---|---|
| `00-dependencias.sql` | Versões mínimas do que o FitMind já tinha e o `01` chama: `profiles`, `partners`, `partner_members`, `partner_acesso_config`, `leads`, `is_admin()`, `partner_pode()`, `academia_parceiros_do_grupo()`, com os mesmos nomes e assinaturas |
| `01-robo-crm.sql` | O robô e o CRM: 15 tabelas, 18 funções, 10 gatilhos, RLS em tudo. **Extraído do banco em produção** em 11/09/2026 |
| `02-conector-versoes.sql` | A tabela que alimenta a auto-atualização do conector |
| `instalar.sql` | Roda os três pelo `psql`, numa transação só |

## Instalar

Pelo `psql`, de dentro desta pasta:

```
psql "postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres" -f instalar.sql
```

Pelo **SQL Editor** do Supabase: cole os três na ordem, cada um num "Run" separado,
e ponha esta linha no topo de cada colagem:

```sql
SET check_function_bodies = off;
```

Ela não é opcional. Várias funções em SQL puro chamam outras que só são criadas
depois, por ordem alfabética (`bot_acesso_conexao` chama `bot_acesso_dono`;
`bot_contar_envio` chama `bot_dia_da_conexao`). Com a checagem ligada o Postgres
recusa a primeira. O `pg_dump` desliga pelo mesmo motivo.

> **Não testado num banco limpo.** A máquina onde o pacote foi montado não tem
> Postgres. O `01` saiu do catálogo de um banco que está rodando, byte a byte
> (md5 `3526acf083da9c266a225505aaf6b644`); o `00` e o `02` foram escritos à mão
> a partir das definições reais. Na primeira vez, instale num projeto descartável.

Depois de instalar, crie o primeiro dono:

```sql
-- o usuário precisa existir no Auth (cadastro normal); o profile nasce sozinho
INSERT INTO public.partners (profile_id, fantasy_name)
SELECT id, 'Minha Empresa' FROM public.profiles WHERE email = 'dono@empresa.com'
RETURNING id;   -- guarde: este é o owner_id do escopo 'parceiro'

INSERT INTO public.partner_members (partner_id, profile_id, papel)
SELECT '<id acima>', id, 'owner' FROM public.profiles WHERE email = 'dono@empresa.com';

INSERT INTO public.partner_acesso_config (partner_id, timezone)
VALUES ('<id acima>', 'America/Sao_Paulo');
```

`partner_pode()` só enxerga `partner_members`: **o dono também precisa da linha
com `papel = 'owner'`**, não basta ser o `profile_id` de `partners`.

## Por que do banco e não das migrations

No repositório do FitMind as migrations **não reproduzem** o que está rodando.
Em 11/09/2026, das 18 funções do banco só 3 batiam com alguma migration, e 4
nunca estiveram em migration nenhuma (`bot_clonar_fluxo`,
`bot_registrar_no_cartao`, `crm_clonar_quadro`, `crm_importar_contatos`) — foram
aplicadas direto. Quem quiser acompanhar mudanças futuras do FitMind precisa
extrair de novo do banco; seguir as migrations traz a versão errada.

## O modelo de dono: `escopo` + `owner_id`

As quatro tabelas-raiz (`bot_conexoes`, `bot_fluxos`, `bot_disparos`,
`crm_quadros`) têm as duas colunas. As outras herdam o dono pela chave
estrangeira (mensagem → conversa → conexão; cartão → quadro).

| `escopo` | `owner_id` aponta para | Quem acessa (`bot_acesso_dono` / `crm_acesso_quadro`) |
|---|---|---|
| `parceiro` | `partners.id` — a empresa | `partner_pode(owner_id, 'robo')` ou `'crm'` |
| `coach`, `profissional` | `profiles.id` — a própria pessoa | o dono do profile |
| `admin` | `NULL` — a plataforma | só `is_admin` |

Para vender, `parceiro` é o cliente e `admin` é você. `coach` e `profissional` são
perfis do FitMind; podem ficar sem uso (o CHECK aceita, não atrapalha).

**`owner_id` não tem chave estrangeira** — ele aponta para tabelas diferentes
conforme o escopo. Por isso apagar uma empresa **não** apaga o robô e o CRM
dela: é preciso remover as linhas de `bot_conexoes`, `bot_fluxos`,
`bot_disparos` e `crm_quadros` com aquele `owner_id` (o resto cai em cascata).

## As 18 funções, por papel

| Papel | Funções |
|---|---|
| Quem pode | `bot_acesso_dono`, `bot_acesso_conexao`, `bot_acesso_fluxo`, `crm_acesso_quadro` — usadas pelas policies |
| **Costura robô ↔ CRM** | `bot_vincular_cartao` (conversa vira cartão no primeiro funil do dono), `bot_registrar_no_cartao` (cada mensagem vira atividade do cartão), gatilho `crm_registrar_mudanca_coluna` |
| Envio | `bot_escolher_conexao` (qual número manda: do dono ou do grupo, conector visto há menos de 5 min, dentro da cota diária), `bot_contar_envio`, `bot_dia_da_conexao` (dia no fuso da empresa), `bot_bloquear_conexao` (existe, mas nenhum código chama) |
| Modelos | `bot_clonar_fluxo`, `crm_clonar_quadro`, `crm_criar_quadro` (cria com as etapas padrão) |
| Entrada de dados | `crm_importar_contatos` (lista colada, ignora telefone repetido), `bot_confirmar_verificacao` |
| Gatilhos | `bot_marcar_ultima_mensagem`, `crm_touch_updated_at` |

`bot_verificacoes` + `bot_confirmar_verificacao` são a **confirmação de
cadastro do FitMind**: o app mostra um código `FIT-7K2P`, a pessoa manda para o
número da plataforma (`uso = 'plataforma'`), e o robô confirma. Sem um app que
gere esses códigos, a tabela fica vazia e nada quebra.

## O que ficou de fora de propósito

A **integração com academia** mora em funções que dependem das tabelas de aluno,
mensalidade e acesso do FitMind — não fazem sentido fora dele:

| Função (no FitMind) | O que faz | Quem chama |
|---|---|---|
| `academia_crm_sincronizar` | move o aluno no funil pelo vencimento (3 dias antes, no dia, depois, 7/30/60/90, lista fria) | pg_cron, 10h e 22h |
| `academia_avisos_preparar` | cria as campanhas de aviso do dia como rascunho | pg_cron, 12h |
| `academia_avisos_a_disparar` | diz quais rascunhos já podem sair, pelo fuso de cada academia | `rotas/api.public.hooks.avisos-automaticos.ts` |
| `academia_avisos_devidos`, `academia_avisos_marcar_enviados` | alvos de um aviso e baixa depois do envio | `executarDisparo` em `bot-disparos.functions.ts` |
| `academia_publico`, `academia_reativacao_previa` | público de campanha da academia | `alvosDaAcademia`, `previaDaAcademia` |
| `partner_feriado_de_hoje` | feriado da unidade, para o aviso de fora do horário | `bot-engine.ts`, só se `acao_params.partnerId` existir |

O gancho de hora em hora (`avisos-automaticos`) veio junto porque é o modelo de
como disparar campanha agendada sem ninguém apertar botão — troque a chamada
`academia_avisos_a_disparar` pela sua regra.

## Publicar versão nova do conector

```sql
INSERT INTO public.conector_versoes (versao, arquivos, notas)
VALUES ('1.04.00', jsonb_build_object('conector.mjs', '<conteúdo inteiro do arquivo>'), 'o que mudou');
```

- Atualize a constante `VERSAO` dentro do `conector.mjs` para o **mesmo** valor
  da linha. Se esquecer, o conector aplica, mas continua se declarando na versão
  antiga em `bot_conexoes.versao`.
- Dois dígitos em cada parte, sempre: a comparação é textual.
- A tabela é **global**: a linha nova chega a todos os conectores de todas as
  empresas em até 10 minutos. Teste num PC antes de inserir.
