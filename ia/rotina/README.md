# Rotina Claude Code do dono

Rotina diária (Claude Code) que lê os lotes do dia do número do Erick, analisa as conversas e devolve o JSON do contrato v1 ao CRM. Roda só para o número dele: os mentorados usam a API Batch.

## Configurar
1. No CRM, em Admin > Tokens da IA, crie um token (`crmia_...`).
2. Guarde o token numa variável do ambiente da rotina, para o proxy do ambiente injetá-lo como `Authorization`. O token não vai em arquivo nem no `crm.sh`.
3. Política de rede: liberar só o domínio do CRM (`crm-fitmind-whatsapp.vercel.app`).
4. Aponte a rotina para esta pasta (`ia/rotina/`); o `CLAUDE.md` e o `.claude/settings.json` valem como estão.

## Por que só o número do Erick
O lote não tem telefone nem sobrenome, mas ainda traz o texto das conversas. Rodar na conta do dono evita que o conteúdo de terceiros passe por uma conta que não é a dele.

## Conferir à mão
`node scripts/validar.mjs exemplos/analise-exemplo.json --lote exemplos/lote-exemplo.txt`

`contrato/` é cópia gerada de `ia/contrato/`: não edite aqui.
