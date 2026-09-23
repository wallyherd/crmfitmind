# Robô de WhatsApp + CRM

O robô de atendimento por WhatsApp e o CRM de funil do FitMind, separados do
resto do aplicativo. Os dois já vêm integrados: toda conversa que chega pelo
WhatsApp vira um cartão no funil sozinha, e do funil sai campanha pelo mesmo
número.

**Isto é um pacote de arquivos, não um aplicativo que abre com dois cliques.**
O código do servidor e das telas foi escrito para morar dentro de um app
TanStack Start + Supabase; para rodar fora do FitMind ele precisa de um app
desses em volta (seção [Para rodar fora do FitMind](#para-rodar-fora-do-fitmind)).
O banco e o conector já estão prontos para instalar.

## De onde veio cada parte

| Parte | Origem | Conferência |
|---|---|---|
| `servidor/`, `telas/` | repositório do FitMind, commit `11907f0b` (09/09/2026); `admin-crm.functions.ts`, `bot-disparos.functions.ts` e `rotas/api.bot.fila.ts` do `ed47d101` (11/09/2026), com as duas correções da seção [Defeitos já corrigidos](#defeitos-já-corrigidos-neste-pacote) | os 17 arquivos são idênticos aos do repositório, por hash |
| `banco/01-robo-crm.sql` | **banco em produção**, lido do catálogo do Postgres em 11/09/2026 | md5 `3526acf083da9c266a225505aaf6b644`, igual ao gerado no banco |
| `conector/conector.mjs` | versão **1.03.00**, a que está publicada para auto-atualização | igual à que roda hoje nos PCs das academias, exceto um telefone real num comentário (linha 238), trocado por um fictício |

As migrations do repositório **não** foram usadas: não batem com o banco
(detalhes em `banco/LEIA-ME.md`).

## O que tem aqui

```
banco/
  00-dependencias.sql        o mínimo do FitMind que o robô e o CRM chamam
  01-robo-crm.sql            15 tabelas, 18 funções, gatilhos e RLS
  02-conector-versoes.sql    auto-atualização do conector
  instalar.sql               os três de uma vez, pelo psql
  LEIA-ME.md                 instalação, modelo de dono, o que ficou de fora
servidor/
  bot-engine.ts              o motor: decide o que responder
  bot-disparos.functions.ts  campanhas e mensagem avulsa
  admin-robo.functions.ts    admin: números, segredo do conector, teste, conversas
  admin-crm.functions.ts     admin: funis e quadros de cada dono
  admin-whatsapp.functions.ts  admin: números da própria plataforma
  whatsapp.ts                link wa.me
  rotas/
    api.bot.eventos.ts       o conector avisa: mensagem, status, batimento
    api.bot.fila.ts          o conector busca o que enviar
    api.bot.confirmar.ts     o conector diz se enviou
    api.bot.atualizacao.ts   o conector pergunta se há versão nova
    api.public.hooks.avisos-automaticos.ts   campanha agendada (modelo; é da academia)
telas/
  CrmBoard.tsx               o quadro kanban do CRM, com importação de contatos
  PartnerRoboPanel.tsx       painel da empresa: números, atendimentos, conversas, campanhas
  FunilComCampanhas.tsx      funil com campanha por coluna (é da academia)
  admin/admin.crm.tsx, admin.robo.tsx, admin.whatsapp.tsx   telas do dono da plataforma
conector/
  conector.mjs, painel.html  o programa do PC do cliente (Node + Baileys)
  iniciar.bat                abre e reabre quando se atualiza
  package.json, package-lock.json
  README.md                  manual de operação (escrito para o FitMind)
  marca/fitmind.ico
```

Ficaram fora: `FitMindConector.exe` (lançador com a marca; o `iniciar.bat` faz o
mesmo papel), `node.exe` (100 MB, baixa-se do nodejs.org) e `node_modules`
(o `iniciar.bat` instala na primeira vez).

## Como as peças conversam

```
  celular do cliente final
          │ WhatsApp
          ▼
  ┌─────────────────────────────┐
  │ conector/  (PC da empresa)  │  mantém a sessão do WhatsApp viva (Baileys)
  └─────────────────────────────┘
          │  toda chamada SAI daqui — a nuvem nunca chama o PC,
          │  que fica atrás do roteador, sem IP fixo
          │  cabeçalhos x-bot-conexao + x-bot-segredo
          ▼
  ┌─────────────────────────────┐
  │ servidor/rotas/api.bot.*    │  service role do Supabase
  │   └ bot-engine.ts           │  decide a resposta e põe na fila
  └─────────────────────────────┘
          │
          ▼
  ┌─────────────────────────────┐        ┌──────────────────────────┐
  │ Supabase (banco/)           │ ◄───── │ telas/  (navegador, RLS) │
  └─────────────────────────────┘        └──────────────────────────┘
```

| Chamada do conector | Quando | O que acontece |
|---|---|---|
| `POST /api/bot/eventos` `{tipo:"mensagem"}` | chegou mensagem | grava em `bot_mensagens` (sem duplicar, pelo `wa_id`), roda o motor |
| `POST /api/bot/eventos` `{tipo:"status"}` | QR, conectou, caiu | atualiza `bot_conexoes.status` |
| `POST /api/bot/eventos` `{tipo:"batimento"}` | a cada ciclo | marca `visto_em` — é por ele que se sabe que o PC está ligado |
| `GET /api/bot/fila?limite=10` | a cada 3 s | devolve mensagens `pendente` já no horário e marca `entregue_em` |
| `POST /api/bot/confirmar` | depois de cada envio | `enviada` ou `erro`; o alvo da campanha anda junto |
| `GET /api/bot/atualizacao?versao=` | a cada 10 min | se houver versão maior em `conector_versoes`, manda os arquivos |

**Enviar é só inserir.** Tudo que o sistema quer dizer — resposta do robô,
mensagem avulsa do CRM, campanha — vira uma linha `pendente` em `bot_mensagens`.
O conector busca e manda. Campanha sai espaçada porque cada mensagem ganha um
`agendado_para` (20 s de intervalo por padrão), sem precisar de agendador.

## A costura robô ↔ CRM

É toda no banco, em duas funções que o motor chama a cada mensagem:

1. **`bot_vincular_cartao(conversa)`** — procura o primeiro funil
   (`crm_quadros.tipo = 'funil'`) do mesmo dono da conexão. Se ainda não há
   cartão com aquele telefone, cria na primeira coluna, com a atividade
   "Entrou pelo WhatsApp". Grava o `cartao_id` na conversa. Dono sem funil: o
   robô atende normalmente e nenhum cartão é criado.
2. **`bot_registrar_no_cartao(conversa, texto, direção)`** — cada mensagem, de
   entrada ou de saída, vira atividade `whatsapp` no histórico do cartão.

No sentido contrário: mover um cartão de coluna grava a atividade sozinho
(gatilho), o `CrmBoard` manda WhatsApp direto do cartão (`enviarMensagemDireta`),
e uma coluna do funil pode virar público de campanha (`alvosDoFunil`; cada alvo
guarda o `cartao_id`).

O motor, em ordem: token de verificação → conversa com atendente humano não é
tocada → vira cartão → "falar com atendente" funciona em qualquer ponto → casa
a resposta com uma opção do passo atual (número, sinônimo, texto da opção) →
não entendeu duas vezes, chama gente → conversa nova escolhe o fluxo
(palavra-chave antes de "primeira mensagem").

## Para rodar fora do FitMind

**Pilha esperada:** TanStack Start (rotas de servidor com `createFileRoute` e
funções com `createServerFn`), React, Supabase, `zod`, `sonner`, `lucide-react`,
Tailwind com componentes shadcn. O FitMind roda isso em Cloudflare Workers.

**Onde cada arquivo entra**, com o alias `@/` apontando para `src/`:

| Do pacote | Para |
|---|---|
| `servidor/*.ts` | `src/lib/` |
| `servidor/rotas/api.bot.*.ts` | `src/routes/` (o nome do arquivo é a rota) |
| `servidor/rotas/api.public.hooks.avisos-automaticos.ts` | `src/routes/api/public/hooks/avisos-automaticos.ts` |
| `telas/*.tsx` | `src/components/crm/CrmBoard.tsx`, `src/components/partner/…` |
| `telas/admin/*.tsx` | `src/routes/_authenticated/` |

**Quatro módulos que o código importa e não estão no pacote** — no FitMind são
gerados pelo Lovable, sem regra de negócio:

| Import | Tem que exportar |
|---|---|
| `@/integrations/supabase/client` | `supabase`: cliente do navegador, `createClient(URL, CHAVE_ANON)` |
| `@/integrations/supabase/client.server` | `supabaseAdmin`: cliente com a **service role**, só no servidor |
| `@/integrations/supabase/auth-middleware` | `requireSupabaseAuth`: middleware que valida o `Bearer` e põe `context.userId` (o `auth.users.id`). É o único campo que o código usa |
| `@/integrations/supabase/auth-client-middleware` | `attachSupabaseAuth`: middleware do cliente que anexa o token da sessão |

Variáveis de ambiente do servidor: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`.

**Imports que são do FitMind e precisam sair ou ser trocados:**

- `@/components/ui/button`, `input`, `label` (shadcn) — em `admin.whatsapp.tsx`
- `@/lib/academia-teste.functions` e `@/components/partner/PessoasDoRelatorio` —
  em `FunilComCampanhas.tsx`, que é da academia de ponta a ponta

## O que é genérico e o que é do FitMind

| Arquivo | Genérico? | Amarrações |
|---|---|---|
| `bot-engine.ts` | sim | texto de confirmação de cadastro cita a FitMind (linha 75); feriado só se `acao_params.partnerId` existir |
| `rotas/api.bot.*` | sim | nenhuma além dos quatro módulos acima |
| `rotas/…avisos-automaticos.ts` | não | chama `academia_avisos_a_disparar` — serve de modelo |
| `bot-disparos.functions.ts` | quase | `alvosDaAcademia` e `previaDaAcademia` são da academia; `executarDisparo` dá baixa em `academia_avisos_*` quando a campanha é aviso automático; permissão lê `profiles.role` e `partner_members` |
| `admin-robo`, `admin-crm` | não | listam `partners` com colunas do FitMind (`fantasy_name`, `city`, `business_area`) e `coaches` |
| `admin-whatsapp` | sim | números da plataforma (`uso = 'plataforma'`) |
| `CrmBoard.tsx` | sim | — |
| `PartnerRoboPanel.tsx` | sim | recebe `partnerId`; textos falam em academia |
| `FunilComCampanhas.tsx` | não | funil de mensalidade da academia |
| `telas/admin/*` | não | telas do admin do FitMind |

**Marca e textos fixos a revisar:**

| Onde | O quê |
|---|---|
| `conector/conector.mjs` linha 283 | `browser: ['FitMind', 'Chrome', '1.0.0']` — é o nome que aparece no celular, em *Aparelhos conectados* |
| `conector/painel.html` | título, marca, "Endereço da FitMind", placeholder `fitmindclub.com.br` |
| `conector/conector.mjs`, `package.json`, `README.md`, `marca/fitmind.ico` | nome e descrição |
| `banco/01-robo-crm.sql`, `crm_criar_quadro` | etapas padrão do funil: "Aula experimental", "Matriculado" |
| `banco/01-robo-crm.sql`, `bot_vincular_cartao` | "Entrou pelo WhatsApp da academia" |
| `servidor/bot-engine.ts` | "Sua conta na FitMind está confirmada", "a academia não abre" |
| telas e mensagens de erro do servidor | ~90 ocorrências de academia/aluno/FitMind — `grep -rn "academia\|aluno\|FitMind"` |

## Vender para outras empresas

### O que já está pronto

- **Isolamento no banco.** Cada linha tem dono (`escopo` + `owner_id`) e toda
  tabela tem RLS. O navegador de uma empresa não enxerga nada de outra — nem
  conversa, nem cartão, nem campanha.
- **Número próprio por empresa.** Cada conexão tem o seu segredo; o conector só
  fala pela conexão dele, e `/api/bot/confirmar` recusa (403) mensagem de outra
  conexão.
- **Vários números por empresa**, com prioridade, cota diária no fuso da
  empresa (300 por número, ao criar pelo painel), e empresas de um mesmo grupo
  dividindo número. Há também `bot_bloquear_conexao` e a coluna
  `falhas_seguidas` para tirar de rodízio um número com problema — mas **nenhum
  código chama nem incrementa ainda**.
- **Modelos.** Fluxo ou funil marcado `modelo = true` aparece para todos e se
  clona (`bot_clonar_fluxo`, `crm_clonar_quadro`) — é o kit de boas-vindas de
  um cliente novo.
- **Permissão por módulo.** `partner_pode(empresa, 'robo')` e `'crm'` são
  separadas: dá para vender um sem o outro.

### O que falta construir

1. **Cadastro de empresa.** Nada cria sozinho `partners` + `partner_members`
   (dono) + `partner_acesso_config` + o primeiro funil + o fluxo clonado do
   modelo. Hoje é à mão (`banco/LEIA-ME.md`). Uma função `SECURITY DEFINER` que
   faça tudo numa transação resolve.
2. **Cobrança e bloqueio.** `partner_pode()` libera o dono sempre
   (`papel = 'owner'`). Para desligar quem não paga, acrescente a condição de
   empresa ativa dentro dela (ex.: `partners.status = 'ativo'`) — um lugar só,
   e as policies todas passam a respeitar.
3. **Painel da plataforma.** `telas/admin/*` são do admin do FitMind; reescreva
   para listar empresas.
4. **Marca** — tabela acima, incluindo recompilar ou dispensar o lançador `.exe`.
5. **Apagar empresa.** `owner_id` não tem chave estrangeira; é preciso uma
   rotina que remova as quatro tabelas-raiz daquele dono. Pense nisso junto com
   a LGPD: `bot_mensagens` guarda o texto das conversas sem prazo de expiração.
6. **Onde o conector roda.** Cada número precisa de um processo Node ligado o
   tempo todo — um PC da empresa ou um servidor seu. Vários conectores cabem na
   mesma máquina, cada um na sua pasta e com `PORT` diferente.

### Riscos para pôr no contrato

- **API não oficial.** O conector usa Baileys, que imita o WhatsApp Web. O
  WhatsApp pode banir o número. O valor `oficial` existe no banco, mas **não há
  código** para a API oficial (Cloud API) — o sistema sempre grava `nao_oficial`.
- **Atualização é para todos de uma vez.** `conector_versoes` é global.
- **Custo por conector.** Cada conector chama a fila a cada 3 s: ~29 mil
  chamadas por dia, por número. Com 100 números, ~2,9 milhões/dia no servidor.

## Defeitos já corrigidos neste pacote

Os dois foram achados ao montar o pacote e corrigidos no FitMind em 11/09/2026.
Ficam registrados porque são o tipo de erro que volta ao escrever código novo.

**A fila parava aos ~390 contatos por número (commit `ed47d101`).**
`api.bot.fila.ts` carregava todas as conversas da conexão e passava os ids num
`.in()`, que vai na URL. O gateway do Supabase corta em ~16 KB: 380 ids passam,
400 derrubam a conexão. Daí em diante nenhuma resposta sairia, enquanto as
recebidas continuavam gravando — o painel pareceria normal. Agora a fila filtra
pelo join `bot_conversas!inner(conexao_id)` e a URL fica em 437 caracteres com
qualquer número de conversas; `executarDisparo` consulta em lotes de 200 e
`cancelarCampanha` cancela pelo filtro da campanha. **Regra:** `.in()` só com
lista pequena e de tamanho conhecido — lista que cresce com o uso funciona por
semanas e para de uma vez.

**Vazamento entre empresas (commit `50e84b34`):** quatro
funções recebiam um id do navegador e consultavam com a service role sem
conferir o dono. `meusQuadrosCrm` listava os funis de qualquer empresa;
`alvosDoFunil` puxava nome e telefone dos leads do funil de **outra empresa**
para a própria campanha; `previaDaAcademia` devolvia contagem de alunos de
qualquer academia; `enviarMensagemDireta` ligava a conversa a cartão alheio. A
primeira passou a ler pela RLS (`context.supabase`); as outras conferem a
pertença antes (`quadroEhDoDono`, `cartaoEhDoParceiro`). **Ao escrever função de
servidor nova, siga o mesmo padrão:** id que vem do navegador + service role =
conferir o dono primeiro.

## Armadilhas que já custaram caro

Estão nos comentários do código, com a história de cada uma. As que mais
importam para quem vai manter:

- **Resposta volta pelo `jid`, não pelo telefone.** O WhatsApp passou a
  endereçar conversas por LID (`…@lid`), números que não são telefone de
  ninguém. Busque a conversa pelo `jid` e, se não achar, pelo telefone.
- **Erro que repetir não resolve nunca pode virar 500.** O conector guarda o
  evento em disco e repete para sempre; um evento envenenado trava a fila local
  inteira atrás dele. Duplicata (`23505`) é sucesso.
- **Uma rodada de fila por vez.** Sem a trava `rodandoFila`, a rodada seguinte
  pegava a mesma mensagem ainda pendente: uma mensagem saiu quatro vezes em
  26/08.
- **Horário de negócio vem do banco, no fuso da empresa.** O servidor está em
  UTC; foi assim que a cota diária do chip passou a virar às 20h de Cuiabá.
- **Versão do conector com dois dígitos por parte** (`1.03.00`): a comparação
  é textual.
- **Campanha não entra no fluxo do robô.** A conversa aberta por campanha nasce
  em estado `humano`, senão a resposta do cliente cairia num menu que ele não
  pediu.
