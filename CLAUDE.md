# CRM da mentoria (FitMind) — contexto para o Claude Code

CRM de WhatsApp para a mentoria de vendas do Erick: cada mentorado conecta o próprio
WhatsApp, o sistema captura as conversas, o SQL calcula os números do dia e a IA
(API Batch da Anthropic) julga vendas, funil e próximos passos.

## Onde está o plano

- **O que fazer agora, tarefa por tarefa, com modelo e esforço:** `C:\dev\crm-mentoria-plano\EXECUCAO.md`
- Instruções completas de cada parte: `C:\dev\crm-mentoria-plano\especificacoes\*.md`
- Desenho e auditoria: `C:\dev\crm-mentoria-plano\desenho\`, `...\auditoria\` (consulte, não leia tudo)

Leia só o arquivo da tarefa que você vai fazer. Contexto grande custa caro.

## Estado (branch local `fase-0-1`)

| Commit | O que é |
|---|---|
| `b098fde` | Fase 0: Supabase Auth com JWT em toda rota, isolamento por empresa, fim da senha mestra, crash ESM da Vercel |
| `dd8c813` | Gateway Baileys 6.7.24 em `gateway/` (várias sessões, HMAC, spool) |
| `fac2451` + `44ef002` | Fase 1: captura no servidor (migração 002), tela Conectar WhatsApp, 24 achados de revisão aplicados |
| `2fba4da`…`4968478` | Fases 2+3: migração 003 (métricas, lote da IA sem telefone, vendas), rotas, cron, API Batch, Vendas, Relatório do dia; revisão com 18 achados aplicados |
| `ecccb63`…`c2dc173` | Fase 5: PWA instalável, layout de celular, tela Hoje; pendências pequenas |

Falta: visão do mentor (Fase 6) e colocar no ar (bloco C do EXECUCAO.md). Nada foi aplicado no
Supabase nem publicado.

## Regras que não mudam

- **Não fazer push.** O repositório é público e é do Wallace; o Erick decide quando subir.
- Não acessar o Supabase nem o site no ar; não usar credencial real; não aplicar migração no banco
  no ar (quem aplica é o Erick, depois do diagnóstico em `banco/diagnostico-banco-vivo.sql`).
- A senha mestra antiga não pode voltar: `grep -rli "itmind123" . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=.claude --exclude=CLAUDE.md` tem que dar vazio (este arquivo e o verificador citam o padrão de propósito).
- Toda rota `/api` exige JWT, salvo as do conector/gateway (segredo/HMAC), `crmia_` em `/api/ia/*`
  e `CRON_SECRET` em `/api/cron/*`. Rota nova entra na lista do teste que enumera rotas.
- Conteúdo (mensagens, contatos, cartões, vendas, lotes, análises, .txt) passa por `podeVerConteudo`/`exigirConteudo` em `server/auth.ts`: membro ou (admin **e** opt-in do dono). `podeNaEmpresa` é só para estrutura. Rota nova de conteúdo usa a guarda e entra em `testes/servidor/mentor.test.ts`.
- Imports relativos do servidor com extensão `.js` (senão a Vercel quebra — há teste).
- O arquivo que vai para a IA nunca leva telefone nem nome completo; o .txt COMPLETO (com telefone)
  nunca vai para a IA nem para o Storage.
  Exceção consciente (decisão do Erick, 09/10/2026): o comprovante que o cliente manda (imagem/PDF) vai inteiro para a
  Anthropic ler valor, data, banco e ID, e a imagem pode mostrar nome, CPF/CNPJ e chave PIX. Só vale com
  `consentimento_ia_em` + motor `api_batch`, o texto do consentimento e o guia dizem isso, e o servidor só grava esses
  campos (banco de lista fechada, ID sem cara de CPF/telefone; nunca nome nem documento do pagador).
- Identificadores em português, no padrão do repo. Comentário só onde o porquê não é óbvio.

## Checagens (tudo tem que passar antes de commitar)

```
npx tsc --noEmit -p .
npm run build
cd testes && npm test        # banco (PGlite) + servidor + prova ESM da Vercel
cd gateway && npm test
```

Para economizar, delegue a rodada de checagens ao subagente `verificador` (Haiku).

## Commits

Mensagem em português, dizendo o que mudou e por quê, terminando com
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (troque pelo modelo que fez o trabalho).
