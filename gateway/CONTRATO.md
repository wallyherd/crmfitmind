# Contrato gateway ⇄ CRM (Fase 1), como está implementado

Este é o contrato que o código de `gateway/` cumpre hoje. A fatia do servidor segue isto.
Onde o código escolheu algo que o contrato da Fase 1 deixava aberto, está marcado **(decisão do gateway)**.

Arquivos: `mapear.mjs` (eventos), `sessao.mjs` (lote, spool, fila), `nuvem.mjs` (assinatura,
transportes, campainha), `supervisor.mjs` (conexões e fila agregada), `midias.mjs` (comprovantes: download e fila em disco).

---

## 1. Autenticação

### Modo gateway (VPS): HMAC em toda chamada

Cabeçalhos:

```
x-gateway-ts:          1791000000000        (unix em milissegundos, só dígitos)
x-gateway-assinatura:  hex(HMAC_SHA256(GATEWAY_SECRET, ts + "." + METODO + "." + caminho + "." + sha256hex(corpo)))
```

- `ts` em **milissegundos** (13 dígitos hoje), o mesmo texto do cabeçalho.
- `METODO` em maiúsculas (`GET`, `POST`).
- `caminho` é o *pathname* **completo, com o prefixo `/api`, sem query**: `GET /api/gateway/fila?limite=50`
  assina `/api/gateway/fila`; `POST /api/bot/eventos` assina `/api/bot/eventos`. A query não entra
  (o único parâmetro é `limite`, inofensivo). No Express use `req.originalUrl.split('?')[0]` — **não**
  `req.path`, que dentro de `app.use('/api', …)` perde o `/api`. É o que `server/auth.ts`
  (`assinaturaGatewayValida`) já faz.
- `corpo` são os **bytes crus** do corpo (UTF-8 do `JSON.stringify` enviado). Sem corpo (GET): string vazia,
  `sha256hex("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- Separador é o ponto (`.`), sem espaços. A assinatura sai em hex minúsculo (64 caracteres).
- O servidor deve recusar `|agora − ts| > 300000` e comparar com `timingSafeEqual`.
- Para o Express conseguir o corpo cru: `express.json({ verify: (req, _res, buf) => { req.corpoBruto = buf } })`.
- POST sempre vai com `Content-Type: application/json`; GET vai sem corpo e sem `Content-Type`.

Vetores para teste (segredo **de exemplo**, `exemplo-de-segredo-so-para-teste-0123456789`, `ts = 1791000000000`;
conferidos com `openssl dgst -sha256 -hmac` e travados em `test/nuvem.test.mjs`):

| Chamada | Corpo cru | `x-gateway-assinatura` |
|---|---|---|
| `POST /api/bot/eventos` | `{"conexaoId":"8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f","eventos":[{"tipo":"batimento","versao":"2.00.00"}]}` | `9423923d6a794b5b175e21dcdb858054fafdbbde7a0c8fc87053df7a78675cd4` |
| `GET /api/gateway/fila?limite=50` | (vazio) | `81a751499d7914d98bf8a32bedd305a4209e8e10dac0b00ec2fa8060e2c3d63c` |
| `POST /acordar` | `{"conexaoId":"8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f","motivo":"fila"}` | `4fdb4cd5b421cdd4887de940e063f3d8bb51e20c1fec18c4e068c82bc43c24fd` |

Texto assinado do primeiro, para depurar: `1791000000000.POST./api/bot/eventos.de3761733fe8f894918b991e4207595868e6f715ec5fbeecc8d8ccad3078ed17`.

Referência (é o que `nuvem.mjs` faz):

```js
import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
const sha256hex = (b) => createHash('sha256').update(b ?? '').digest('hex');
const assinar = (segredo, ts, metodo, caminho, corpo = '') =>
  createHmac('sha256', segredo).update(`${ts}.${metodo.toUpperCase()}.${caminho}.${sha256hex(corpo)}`).digest('hex');
```

### Modo PC: uma conexão só

```
x-bot-conexao: <bot_conexoes.id>
x-bot-segredo: <bot_conexoes.webhook_segredo>
```

O `conexaoId` vem do cabeçalho; o corpo de `/api/bot/eventos` não traz `conexaoId`.

---

## 2. `POST /api/bot/eventos`

```json
{ "conexaoId": "8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f", "eventos": [ { "tipo": "mensagem", "...": "..." } ] }
```

- Modo gateway: `conexaoId` sempre presente. Modo PC: `{ "eventos": [...] }`.
- O gateway sempre manda `eventos` como lista (o servidor pode aceitar também um evento solto, mas o gateway não usa).
- Até **50 eventos** ou cerca de **900 KB** por chamada; lote sai quando junta 50 ou depois de 1 s.

Resposta esperada: `200 {"ok":true,"processados":n,"erros":[{"indice":i,"erro":"..."}]}`.

Como o gateway trata a resposta:

| Resposta | O que o gateway faz |
|---|---|
| 200 | Tira o lote do spool. Cada `erros[i]` é recusa **daquele** evento: vai para `rejeitados.jsonl` e não volta. |
| 400, 413, 422 | Lote inteiro recusado: divide ao meio e tenta de novo até isolar o evento ruim, que vai para `rejeitados.jsonl`. Os bons sobem. |
| 401, 403, 404, 408, 429, rede | Guarda tudo e tenta de novo com espera de 1 s, 2 s, 4 s… até 60 s. Nada é descartado. |
| 5xx | Igual, e conta falha no primeiro evento; com 3 falhas o lote encolhe; um evento sozinho com 20 falhas vai para `rejeitados.jsonl`. |

**O servidor precisa ser idempotente.** A entrega é "pelo menos uma vez": depois de queda, reinício ou
resposta perdida, o mesmo evento pode chegar de novo. `mensagem` deduplica por `(conversa, waId)`;
`recibo`, `edicao` e `apagada` devem poder ser aplicados duas vezes.

A ordem dentro de uma conexão é a ordem em que os eventos aconteceram. Entre conexões não há ordem.

**`recibo`, `edicao` e `apagada` para um `waId` que o servidor não conhece** são normais e não são erro:
a mensagem pode ser de antes do histórico, de um grupo que não era marcado na época, ou ter sido apagada
antes de subir (quando o original e o "apagar" chegam no mesmo lote do Baileys, o original já vem vazio e
o gateway não o manda). Responder `processados` normalmente, sem `erros[i]`, e ignorar.

**A mesma `waId` com conteúdo melhor.** Uma mensagem de visualização única pode chegar primeiro vazia
(`tipoMidia: "outro"`, `midia.visualizacaoUnica`) e depois, se o celular reenviar, com o conteúdo. Ao
deduplicar, se a gravada não tem `corpo` nem `midia` além da marca e a nova tem, atualizar em vez de
descartar.

### Eventos que não vão para o disco **(decisão do gateway)**

`qr`, `codigo_pareamento` e `batimento` valem na hora ou nunca: sobem fora do spool e, se a chamada
falhar, se perdem. Todos os outros ficam em `dados/sessoes/<conexaoId>/pendentes.jsonl` até o CRM aceitar.

---

## 3. Os eventos

### 3.1 `mensagem`

```json
{
  "tipo": "mensagem",
  "waId": "3EB0C767D82A1E4F1B2C",
  "chatJid": "556599990000@s.whatsapp.net",
  "grupo": false,
  "grupoNome": null,
  "telefone": "556599990000",
  "telefoneConfirmado": true,
  "lid": "103843987759126@lid",
  "nome": "João",
  "deMim": false,
  "participanteJid": null,
  "participanteTelefone": null,
  "participanteNome": null,
  "tipoMidia": "audio",
  "corpo": null,
  "midia": { "mimetype": "audio/ogg; codecs=opus", "duracaoSeg": 42, "ptt": true, "tamanho": 81234 },
  "citadoWaId": null,
  "anuncio": {
    "sourceType": "ad", "sourceId": "120210000000000", "sourceUrl": "https://fb.me/abc",
    "ctwaClid": "AfcXYZ", "titulo": "Plano trimestral", "corpo": "Treine 3x por semana",
    "conversionSource": "FB_Ads", "entryPointConversionSource": "ctwa_ad", "entryPointConversionApp": "instagram"
  },
  "origemEvento": "tempo_real",
  "waEm": "2026-10-05T13:22:10.000Z"
}
```

Campo a campo, como o gateway preenche:

| Campo | Regra |
|---|---|
| `waId` | `key.id` do WhatsApp. Sem `waId` não há evento. |
| `chatJid` | Jid da conversa sem `:device`. 1:1 por telefone (`...@s.whatsapp.net`), 1:1 por LID (`...@lid`) ou grupo (`...@g.us`). |
| `grupo`, `grupoNome` | Grupo só sai se o jid estiver em `gruposPermitidos`. `grupoNome` vem da lista de grupos da sessão (pode ser `null`). |
| `telefone` | Só dígitos, E.164 sem `+`. Conversa por telefone: os dígitos do jid. Conversa por LID: o telefone que o WhatsApp revelou (`key.senderPn`, `chats.phoneNumberShare`, contatos, histórico) ou **`null`**. **Nunca** os dígitos do LID. Em grupo: sempre `null`. |
| `telefoneConfirmado` | `true` exatamente quando `telefone` não é `null`. |
| `lid` | Jid LID **completo** (`"103843987759126@lid"`) quando conhecido; `null` se não. Em grupo, `null`. |
| `nome` | `pushName` de quem mandou, **só** em 1:1 e só quando `deMim=false`. Em mensagem do mentorado o `pushName` é o nome dele, e em grupo o autor vai em `participanteNome`: nos dois casos `null` **(decisão do gateway)**. |
| `deMim` | `key.fromMe`: o mentorado digitou no celular (ou em outro aparelho dele). O eco do que o próprio gateway enviou pela fila **não** chega aqui (ver §5). |
| `participante*` | Só em grupo e só quando `deMim=false`. `participanteJid` pode ser LID; `participanteTelefone` segue a mesma regra de `telefone`. |
| `tipoMidia` | `texto`, `imagem`, `audio`, `video`, `documento`, `figurinha`, `localizacao`, `contato`, `reacao`, `enquete`, `outro`. |
| `corpo` | Texto ou legenda (imagem, vídeo e documento). Sem texto: `null`. Até 10.000 caracteres, sem `\u0000`. Localização: nome/endereço (nunca as coordenadas). Contato: o nome do cartão. Enquete: `"pergunta (opções: a / b)"`. Reação: o emoji. |
| `midia` | `{mimetype?, duracaoSeg?, ptt?, nomeArquivo?, tamanho?, visualizacaoUnica?}` ou `null`. `ptt` só em áudio (`true` = gravado na hora). `visualizacaoUnica: true` é **acréscimo do gateway**: a mensagem era de visualização única. **A mídia não vem no evento**: só a imagem e o PDF de um cliente são baixados, e sobem à parte por `POST /api/gateway/midia` (§9). |
| `citadoWaId` | `contextInfo.stanzaId` (a mensagem respondida). Em `reacao`, o `waId` da mensagem que recebeu a reação. |
| `anuncio` | Bruto, como veio de `contextInfo` + `contextInfo.externalAdReply`. Só as chaves presentes. `null` quando não há nenhum sinal (`ctwaClid`, `sourceId`, `sourceUrl`, `sourceType`, `conversionSource`, `entryPointConversionSource`, `entryPointConversionApp`). Sempre `null` em `deMim` e em grupo. **O gateway não decide se é tráfego pago** (revisão C3): quem decide é o servidor. |
| `origemEvento` | `tempo_real`: `messages.upsert` tipo `notify` com até 120 s de idade. `offline`: tipo `append` (chegou com a sessão fora do ar, ou foi digitado no celular enquanto ela estava fora) **ou** `notify` com mais de 120 s **(decisão do gateway: o buffer do Baileys rotula um lote misto pelo primeiro)**. `historico`: veio do histórico do pareamento. |
| `waEm` | Hora do WhatsApp (`messageTimestamp`), ISO em UTC. |

Casos especiais:

- **Visualização única** que o WhatsApp não entrega ao aparelho conectado: vem como `tipoMidia: "outro"`,
  `corpo: null`, `midia: {"visualizacaoUnica": true}`.
- **Não viram evento:** status, canais (`@newsletter`), listas de transmissão, "conversa comigo mesmo",
  chamadas, votos de enquete, chave de grupo, aviso de histórico, mensagem que falhou ao decifrar
  (a reentrega traz o conteúdo com o mesmo `waId`), e tirar uma reação.

### 3.2 `edicao`

```json
{ "tipo": "edicao", "waId": "3EB0C767D82A1E4F1B2C", "chatJid": "556599990000@s.whatsapp.net",
  "deMim": false, "participanteJid": null,
  "corpo": "o valor certo é R$ 350", "waEm": "2026-10-05T13:25:02.114Z" }
```

`waId` é o da mensagem **editada** (não o da edição). `corpo` é o texto novo (`null` se a edição não tem texto).
Vale para mensagens do cliente e do mentorado. `deMim` e `participanteJid` (só em grupo, quando
não é de mim) dizem **quem editou**: o id alvo vem de dentro do conteúdo, que o remetente controla, então o
servidor só edita a mensagem da própria conversa e do mesmo lado (saída se `deMim`, entrada se não; em grupo,
do mesmo participante). O gateway descarta o protocolMessage cuja `key.remoteJid` não é o chat do envelope.

### 3.3 `apagada`

```json
{ "tipo": "apagada", "waId": "3EB0C767D82A1E4F1B2C", "chatJid": "556599990000@s.whatsapp.net",
  "deMim": false, "participanteJid": null, "waEm": "2026-10-05T13:26:40.000Z" }
```

"Apagar para todos", de qualquer lado (mesma regra de autoria da edição: `deMim`/`participanteJid`). `waId` é o da mensagem apagada. O evento só informa: o gateway não
pede para apagar o corpo já gravado (guardar ou não é decisão do servidor; o arquivo completo do dono
precisa da conversa como ela foi).

### 3.4 `recibo`

```json
{ "tipo": "recibo", "waId": "3EB0C767D82A1E4F1B2C", "chatJid": "556599990000@s.whatsapp.net",
  "deMim": true, "status": "lida", "em": "2026-10-05T13:30:00.000Z" }
```

- `deMim: true` + `entregue`/`lida`/`reproduzida`: o **cliente** recebeu, viu, ouviu o que o mentorado mandou.
- `deMim: false` + `lida`/`reproduzida`: o **mentorado** viu ou ouviu no celular o que o cliente mandou.
  (`deMim: false` + `entregue` não é enviado.)
- 1:1: `em` é a hora em que o gateway soube (o WhatsApp não manda a hora nesse recibo).
- Grupo marcado: só recibo de mensagem do mentorado, o **primeiro** de cada status, com a hora do WhatsApp
  (o Baileys 6.7.24 manda "ouviu" de grupo como "leu": em grupo `reproduzida` praticamente não aparece).
- Quem desligou a confirmação de leitura só gera `entregue`.
- **Localize a mensagem pelo `waId` dentro da conexão**, não pelo `chatJid`: o recibo pode vir com o jid em
  LID e a mensagem ter sido gravada pelo telefone (ou o contrário).
- **Recibo grudado (decisão do gateway):** quando o Baileys junta a mensagem e o recibo dela no mesmo lote
  (sessão voltando do ar), o recibo não sai sozinho; o gateway o tira da mensagem e manda logo **depois**
  dela, no mesmo lote. Mesmo formato; `em` é a hora em que o gateway soube.

### 3.5 `status`

```json
{ "tipo": "status", "status": "conectado", "numero": "5565988887777" }
```

```json
{ "tipo": "status", "status": "desconectado", "detalhe": "queda de conexão (código 428)" }
```

| `status` | Quando |
|---|---|
| `conectando` | Abrindo o socket (início e cada religada). |
| `aguardando_qr` | Primeiro QR do pareamento por QR (os QRs seguem como evento `qr`). |
| `aguardando_codigo` | Código de pareamento gerado (vai junto um `codigo_pareamento`). |
| `conectado` | Sessão aberta. `numero` = telefone do mentorado, só dígitos. |
| `desconectado` | Queda (religa sozinho), sessão parada pelo supervisor (`detalhe: "parada"`), `sem_sessao` (precisa parear), `pareamento_expirou` / `pareamento_interrompido (…)`. |
| `deslogado` | O mentorado tirou o aparelho no celular, ou o CRM pediu para desconectar. A sessão foi apagada: só volta com pareamento novo. |
| `erro` | 403 (número possivelmente bloqueado), 440 (outra cópia da sessão), código de pareamento recusado, falha ao abrir o socket. |

`detalhe` tem até 300 caracteres e é texto livre para mostrar na tela.

### 3.6 `qr` (não vai para o disco)

```json
{ "tipo": "qr", "qr": "2@k3J9…,f0Xb…,Zp2…,a1B…" }
```

A string crua que o app do WhatsApp lê; o front desenha o QR. Um novo a cada ~20 s até expirar.

### 3.7 `codigo_pareamento` (não vai para o disco)

```json
{ "tipo": "codigo_pareamento", "codigo": "ABCD1234" }
```

8 caracteres; o front mostra como `ABCD-1234`. O gateway pede o código para
`pareamento.telefone` normalizado: só dígitos; com `+` na frente fica como está; sem `+`, 10 ou 11 dígitos
ganham `55`. No pareamento por código o QR dura 60 s em vez de 20 s, o que dá uns 6 minutos para digitar.

### 3.8 `grupos`

```json
{ "tipo": "grupos", "grupos": [
  { "jid": "120363000000000001@g.us", "nome": "Alunos turma 3", "participantes": 42 },
  { "jid": "120363000000000002@g.us", "nome": "Família", "participantes": 9 }
] }
```

Enviado a cada conexão aberta e quando o mentorado entra num grupo novo. `participantes` é a **contagem**
(número), nunca a lista de telefones **(decisão do gateway)**. Serve para a tela "grupos que eu acompanho".

### 3.9 `chats_base`

```json
{ "tipo": "chats_base", "chats": [
  { "jid": "556599990000@s.whatsapp.net", "telefone": "556599990000", "lid": "111111111111111@lid",
    "nome": "João Academia", "ultimoEm": "2026-07-01T18:03:11.000Z" },
  { "jid": "222222222222222@lid", "telefone": null, "lid": "222222222222222@lid",
    "nome": null, "ultimoEm": null }
] }
```

A lista de conversas 1:1 que o histórico do pareamento trouxe, **sem corpo** (revisão V11): serve para
semear os contatos antigos, e cliente antigo que volta meses depois não contar como conversa nova.

- Só conversas 1:1 (grupo, status e canal ficam de fora). Até 200 por evento.
- `nome` é o nome da conversa no celular (normalmente o da agenda) e pode ser `null`.
- `ultimoEm` é a última atividade da conversa, quando o histórico informa.
- Pode repetir o mesmo `jid` (o histórico chega em partes): o servidor faz upsert e não apaga campo com `null`.
- Sai independente de `historicoDias` (mesmo com 0).

### 3.10 `batimento` (não vai para o disco)

```json
{ "tipo": "batimento", "versao": "2.00.00" }
```

A cada 60 s, só enquanto a sessão está `conectado`. Serve para o `visto_em`. A versão tem dois dígitos em
cada parte (a comparação textual de `1.9.0` com `1.10.0` daria errado).

---

## 4. `GET /api/gateway/conexoes`

```json
{ "conexoes": [
  { "id": "8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f", "deveRodar": true, "pareamento": null,
    "opcoes": { "gruposPermitidos": ["120363000000000001@g.us"], "historicoDias": 7, "botAtivo": false } },
  { "id": "1b7c0d2e-2222-4c66-8e1a-1a2b3c4d5e6f", "deveRodar": true,
    "pareamento": { "metodo": "codigo", "telefone": "5565988887777", "solicitadoEm": "2026-10-07T14:58:00.000Z" },
    "opcoes": { "gruposPermitidos": [], "historicoDias": 7, "botAtivo": false } },
  { "id": "2c8d1e3f-3333-4d77-9f2b-3c4d5e6f7081", "deveRodar": false, "desconectar": true, "pareamento": null,
    "opcoes": { "gruposPermitidos": [], "historicoDias": 7, "botAtivo": false } }
] }
```

`desconectar` é **opcional (acréscimo do gateway)**: `true` = o mentorado pediu para desconectar de vez.
Serve para o pedido chegar mesmo sem campainha (gateway rodando no PC do piloto, sem endereço público).
Pode ficar `true` enquanto `deveRodar` for `false`; o gateway só age se ainda houver pasta da sessão, então
repetir não faz mal. Ao parear de novo, mandar `deveRodar: true` (o `desconectar` passa a ser ignorado) e
depois limpar.

Lido a cada 60 s e a cada campainha `parear`, `desconectar`, `opcoes`. Como o gateway interpreta:

| Situação | O que acontece |
|---|---|
| `deveRodar: true`, sessão salva no VPS | Sobe (se não estiver rodando). Várias de uma vez: uma a uma, com 5 a 15 s aleatórios entre elas (R1). |
| `deveRodar: true`, sem sessão salva, sem pedido de pareamento | Não sobe. Fica esperando um `pareamento`. |
| `pareamento` novo (com `deveRodar: true`) | Sobe (ou repassa à sessão que já roda) com `{metodo, telefone}`. "Novo" = `solicitadoEm` diferente do último atendido **e** com menos de 10 minutos. Pedido mais velho é ignorado. Para pedir de novo, grave um `solicitadoEm` novo. Sessão já pareada ignora o pedido. Com `deveRodar: false` o pedido é ignorado. |
| `deveRodar: false` | Para a sessão **sem deslogar** (a sessão fica no disco e volta quando voltar a `true`). |
| `deveRodar: false` + (`desconectar: true` **ou** campainha `desconectar` para esse id nos últimos 10 min) | Desconecta de vez: sai do aparelho no celular e **apaga a pasta da sessão**. Manda `status: deslogado`. Se a sessão já estava parando, o pedido não se perde: quando ela termina de parar, o gateway sobe um processo só para desconectar. |
| Conexão some da lista | Para, sem deslogar. |
| Pasta de sessão que não roda há **7 dias** (`deveRodar: false` ou fora da lista) | Sai do aparelho e apaga a pasta (LGPD) **(decisão do gateway)**. |
| Resposta com erro / CRM fora | Nada muda: ninguém é parado nem iniciado por falta de resposta. |

Para desconectar, o servidor grava `deveRodar: false` (e `desconectar: true`) **antes** de tocar a campainha:
a campainha só faz o gateway reler esta lista.

`opcoes`: `gruposPermitidos` (só jids `@g.us`), `historicoDias` de 0 a 30 (padrão 7; fora disso é cortado),
`botAtivo` (só `true` liga; padrão `false`). Mudou: a sessão que roda recebe na hora.
`historicoDias` só vale para o histórico do pareamento (que só existe no primeiro pareamento).
O histórico de grupos não vem: no pareamento nenhum grupo está marcado ainda (V1).

`id` só com letras, dígitos e hífen (até 64): é nome de pasta no VPS. Outro formato é ignorado.

---

## 5. Fila de saída

### Gateway: `GET /api/gateway/fila?limite=50`

```json
{ "mensagens": [
  { "id": "4b1e2c3d-3333-4d77-9f2b-2b3c4d5e6f70", "conexaoId": "8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f",
    "para": "556599990000@s.whatsapp.net", "corpo": "Oi João! Seguem os horários…", "tipo": "texto" }
] }
```

Lida a cada 30 s, a cada campainha `fila`, e quando uma sessão conecta. Com 50 na resposta, o gateway
lê de novo (até 5 vezes seguidas). **O servidor marca a reserva**: o que devolveu não volta no próximo poll.

### PC: `GET /api/bot/fila?limite=10`

Mesmo formato. Só com `botAtivo: true` no `config.json` do PC; a cada 5 s com movimento nos últimos
10 min, a cada 20 s parado.

### O que o gateway faz com cada mensagem

1. `botAtivo: false` na conexão: **não envia**; confirma `erro: "envio_desligado: …"` **(decisão do gateway:
   robô desligado é trava aqui também, não só no servidor)**.
2. Sessão não está rodando no VPS, ou está parando/parada (precisa parear, deslogada, erro fatal):
   confirma `erro: "sessao_parada"` na hora.
3. `para` precisa ser jid 1:1 (`@s.whatsapp.net` ou `@lid`). Grupo ou outro: `erro: "destino_invalido: …"`.
   Sem `@` (só telefone): pergunta ao WhatsApp o jid certo (`erro: "numero_sem_whatsapp"` se não existir).
4. `tipo` diferente de `texto`: `erro: "tipo_nao_suportado"`. Corpo vazio: `erro: "corpo_vazio"`.
5. WhatsApp desconectado: espera até 5 min pela volta; depois `erro: "whatsapp_desconectado"`.
6. No máximo **1 envio a cada 8 s** por número, com "digitando…" de 1,2 a 6 s (45 ms por caractere).
7. Envia com `messageId = waIdDaFila(id)` e confirma `enviada` com esse `waId`.
8. A mesma `id` entregue de novo (confirmação perdida): **não reenvia**, só confirma `enviada` de novo.
   (O gateway guarda os últimos 2.000 envios em `enviados.json`, que sobrevive a reinício.)

### `waId` do envio (decisão do gateway)

Determinístico, no formato do WhatsApp Web:

```js
const waIdDaFila = (id) => '3EB0' + createHash('sha256').update(`fila:${id}`).digest('hex').toUpperCase().slice(0, 18);
// waIdDaFila('4b1e2c3d-3333-4d77-9f2b-2b3c4d5e6f70') -> "3EB0" + 18 hex maiúsculos
```

Assim o servidor sabe o `wa_id` **antes** do `/confirmar` (pode gravar ao reservar) e reconhece o eco mesmo
que a confirmação se perca.

### Eco

O próprio envio volta do Baileys como mensagem `fromMe` com o mesmo `waId`. O gateway **filtra** esse eco
(filtro em memória + `enviados.json`), então ele não chega como `mensagem` `deMim`. Se chegar mesmo assim
(caso raro: LID × telefone no jid, V10), o servidor descarta por `wa_id` igual ao de uma saída da fila.

### `POST /api/bot/confirmar` (os dois modos)

```json
{ "id": "4b1e2c3d-3333-4d77-9f2b-2b3c4d5e6f70", "status": "enviada", "waId": "3EB0A1B2C3D4E5F6A7B8C9" }
```

```json
{ "id": "4b1e2c3d-3333-4d77-9f2b-2b3c4d5e6f70", "status": "erro", "erro": "whatsapp_desconectado" }
```

`erro` tem até 300 caracteres. Falha de rede no confirmar: até 5 tentativas (1, 2, 4, 8 s); 4xx que não seja
401/403/408/429 não é repetido. Precisa ser idempotente (o mesmo `id` pode ser confirmado de novo).

---

## 6. Campainha: `POST {GATEWAY_URL}/acordar`

A nuvem chama quando há algo para o gateway olhar agora. **Não carrega conteúdo.**

```json
{ "conexaoId": "8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f", "motivo": "fila" }
```

- Mesma assinatura do §1, com `METODO = POST` e `caminho = /acordar`. `GATEWAY_URL` é só a origem
  (`https://gw.exemplo.com.br`, sem caminho), porque o gateway confere o caminho `/acordar`.
- `motivo`: `fila` (lê a fila agregada), `parear`, `desconectar`, `opcoes` (relê as conexões).
- Respostas: `202 {"ok":true}`; `401` assinatura inválida, vencida (5 min) ou **repetida** (a mesma assinatura
  não vale duas vezes); `400` corpo ou motivo inválido; `413` corpo acima de 4 KB; `404` qualquer outro
  método ou caminho.
- Sem campainha (gateway local, sem endereço público) tudo continua funcionando: a fila é lida a cada 30 s e
  as conexões a cada 60 s.
- Do lado do servidor a campainha é "dispara e esquece": timeout curto (2 a 3 s), e falha nela **nunca**
  pode derrubar a rota do front que a tocou. Sem `GATEWAY_URL`, não toca.
- Duas campainhas idênticas no mesmo milissegundo têm a mesma assinatura: a segunda volta `401`. Inofensivo.

---

## 7. Lista do que o servidor precisa fazer para bater com isto

1. Validar a assinatura sobre o corpo **cru** e o caminho **com `/api` e sem query**, com janela de 5 min e
   `timingSafeEqual` (§1; os vetores da tabela servem de teste).
2. Responder `200` com `erros` por índice para evento ruim; `4xx` só para autenticação/envelope.
3. Deduplicar `mensagem` por `(conversa, waId)`; `recibo`/`edicao`/`apagada`/`chats_base` idempotentes.
   `recibo`/`edicao`/`apagada` de `waId` desconhecido: ignorar sem erro (§2).
4. `telefone: null` + `telefoneConfirmado: false` = conversa por LID ainda sem telefone; quando chegar uma
   mensagem com `telefone` e `lid`, juntar as conversas.
5. `lid` é jid completo (`…@lid`).
6. Não usar `nome` de `deMim` nem de grupo (o gateway já manda `null`).
7. Guardar `anuncio` bruto (C3) e decidir a origem do lead no servidor.
8. `deveRodar: false` para pausar; para apagar a sessão, `deveRodar: false` **e** (`desconectar: true` na
   lista e/ou campainha `desconectar`).
9. Reservar a fila no `GET` e, de preferência, gravar `wa_id = waIdDaFila(id)` já na reserva.
10. Nunca mandar mensagem de campanha nem para grupo na fila do gateway (o gateway também recusa grupo).
11. Recibo: achar a mensagem por `waId` dentro da conexão (o `chatJid` pode estar na outra forma).
12. Comprovante (§9): assinatura sobre os **bytes** do arquivo; recusar grupo, mensagem do mentorado e conversa com
    privacidade diferente de `normal` (o gateway pode não saber); responder 404 enquanto não conhecer o `waId`.

---

## 8. Onde este arquivo diverge do contrato da Fase 1 (e prevalece)

| # | Contrato da Fase 1 | O que o gateway faz | Por quê |
|---|---|---|---|
| 1 | Envio com `messageId` = id do servidor | `messageId = waIdDaFila(id)` (`3EB0` + 18 hex do SHA-256 de `fila:<id>`), §5 | Um UUID como id de mensagem destoa do WhatsApp Web (mais um sinal de robô). Continua determinístico: o servidor calcula o mesmo valor. |
| 2 | `midia: {mimetype?, duracaoSeg?, ptt?, nomeArquivo?, tamanho?}` | Pode trazer também `visualizacaoUnica: true` | Saber que a mensagem era de visualização única (e por isso pode vir vazia). |
| 3 | Conexão: `{id, deveRodar, pareamento, opcoes}` | Aceita também `desconectar?: boolean`, §4 | O "Desconectar" do front funcionar sem campainha (piloto sem endereço público). Sem o campo, a campainha continua valendo. |
| 4 | `origemEvento`: `notify` → `tempo_real`, `append` → `offline` | `notify` com mais de 120 s de idade também vira `offline` | O buffer do Baileys rotula um lote misto pelo tipo do primeiro. |
| 5 | `nome` = pushName | `null` em `deMim` e em grupo | Em mensagem do mentorado o pushName é o dele; em grupo o autor vai em `participanteNome`. |
| 6 | Recibo só de `messages.update` / `message-receipt.update` | Também o recibo que veio fundido na mensagem, logo depois dela, §3.4 | Sem isso o "leu" de mensagens trocadas com a sessão fora do ar se perde. |
| 7 | Eventos em lote | `qr`, `codigo_pareamento` e `batimento` não vão para o spool; sobem na hora, numa chamada à parte | Valem agora ou nunca. |
| 8 | Aceitar evento solto | O gateway sempre manda `eventos: [...]` | Simplicidade; o servidor pode continuar aceitando o solto. |
| 9 | `deveRodar:false` + campainha `desconectar` | Pedido da campainha vale por 10 min e só é dado como atendido quando a sessão termina desconectada | Um "parar" em curso não engole o "desconectar". |
| 10 | Modo PC lê as opções do CRM | Modo PC lê `botAtivo`, `gruposPermitidos` e `historicoDias` do `config.json` local | O contrato não tem rota para o PC ler as opções. **Pendência:** se o servidor criar uma, o `pc.mjs` passa a usá-la. |
| 11 | Mídia não é baixada | Imagem e PDF de **cliente** em conversa individual são baixados e sobem por `POST /api/gateway/midia`, §9 | Comprovante de venda: o mentorado precisa ver o arquivo na hora de confirmar. Privado, 90 dias. |

---

## 9. Comprovantes: `POST /api/gateway/midia`

Imagem ou PDF que o **cliente** mandou, para o mentorado ver o comprovante ao confirmar uma venda. Decisão do Erick
(09/10): guardado em bucket **privado**, por **90 dias**. O comprovante **nunca** confirma venda sozinho (comprovante
falso é comum): é só uma prova a mais na tela.

### O que o gateway baixa (`midias.mjs`, `avaliarMidia`)

| Baixa | Nunca baixa |
|---|---|
| `tipoMidia` `imagem` ou `documento`, de **cliente** (`deMim: false`), em conversa **individual** (`@s.whatsapp.net` ou `@lid`) | Grupo, o que o próprio mentorado manda, áudio, vídeo, figurinha, visualização única, histórico do pareamento |
| `midia.mimetype` em `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | GIF, SVG, HEIC, zip, Word… (continuam como metadado do §3.1) |
| Até **4 MB** (4.194.304 bytes) | Acima disso vira só metadado: o tamanho declarado já corta antes de baixar, e o download em stream para ao passar do teto (o tamanho declarado é do remetente e pode mentir) |

Download com `downloadMediaMessage(m, 'stream', …, { reuploadRequest })` do Baileys 6.7.24, **um por vez**. Falha de
download (link expirado) não é repetida: a mensagem já subiu como evento e o arquivo simplesmente não existe.

### A chamada

```
POST /api/gateway/midia
Content-Type:   image/jpeg            (o mimetype; só os 4 da tabela)
x-conexao-id:   8f2d6a8e-1111-4b55-9d0f-0a0b0c0d0e0f     (gateway; no modo PC vai x-bot-conexao)
x-wa-id:        3EB0C767D82A1E4F1B2C
x-chat-jid:     556599990000@s.whatsapp.net
x-gateway-ts / x-gateway-assinatura       (§1; o PC manda x-bot-conexao + x-bot-segredo)
<corpo: os bytes do arquivo, crus>
```

- A assinatura é a do §1 com `METODO = POST`, `caminho = /api/gateway/midia` e `sha256hex(corpo)` dos **bytes do
  arquivo**. Os cabeçalhos `x-*` não entram na assinatura (o TLS cobre o trânsito); o servidor confere tudo
  contra o banco, não confia neles.
- Cabeçalhos só em ASCII imprimível, até 120 caracteres.
- O servidor acha a mensagem pelo `waId` **dentro da conexão** (não pelo `chatJid`, que pode estar em LID).
- Caminho no bucket privado `comprovantes`: `{partner_id}/{conversa_id}/{mensagem_id}.{jpg|png|webp|pdf}`.

### Respostas

| Resposta | O que o gateway faz |
|---|---|
| 200 `{"ok":true}` ou `{"ok":true,"ja":true}` | Guardado (ou já estava: a entrega é "pelo menos uma vez"). Apaga do disco. |
| 404 `mensagem_desconhecida` / `conexao` | O CRM ainda não conhece a mensagem. Tenta de novo (30 s), no máximo **5 respostas 404** e **24 h**. |
| 400, 403, 413, 415, 422 (`grupo`, `de_mim`, `tipo`, `privacidade`, `conteudo_nao_confere`, `arquivo_grande_demais`) | Recusa definitiva: apaga o arquivo e não tenta de novo. |
| 401, 408, 429, 5xx, rede | Guarda e tenta de novo com 1 s, 2 s, 4 s… até 60 s. Nada é descartado (salvo as 24 h). |

O servidor **recusa a conversa com privacidade diferente de `normal`** (`so_metadados`, `ignorar`), grupo e mensagem do
mentorado mesmo que o gateway mande: ele não sabe a privacidade marcada à mão no CRM. O servidor também confere os
primeiros bytes (JPEG `FF D8 FF`, PNG, WEBP `RIFF…WEBP`, PDF `%PDF-`) contra o mimetype dito.

### Fila em disco (CRM fora do ar)

Cada arquivo baixado vai para `dados/sessoes/<conexaoId>/midias/<id>.bin` (bytes) e `<id>.json` (waId, chatJid,
mimetype, hora). O envio só começa **depois que o spool de eventos esvaziou**, porque o CRM precisa conhecer o `waId`
antes de receber o arquivo. Reiniciar o processo relê a pasta e continua. Limites: 200 arquivos e 200 MB guardados
(passou, o novo fica só como metadado); sobra de queda no meio da gravação é apagada ao carregar. Desconectar a
sessão apaga a pasta inteira (LGPD), com os arquivos que ainda não subiram.

### Do lado do servidor

- `GET /api/mensagens/:id/arquivo` (JWT + guarda de conteúdo: membro, ou admin com o opt-in do dono) devolve
  `{url, expira_em, tipo}` com link assinado de **60 s**.
- 90 dias depois de guardado, a manutenção (`/api/cron/manutencao`) apaga o arquivo e limpa o caminho; o mesmo vale
  para a pessoa apagada pela LGPD e para a conversa marcada como `so_metadados`/`ignorar` depois.
