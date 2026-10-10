# Gateway de WhatsApp do CRM da mentoria

Este programa mantém o WhatsApp de cada mentorado conectado e manda para o CRM tudo o que acontece nas
conversas: o que o cliente escreve, o que o mentorado responde pelo celular, os grupos que ele marcou,
o que chegou enquanto estava tudo desligado, se o cliente leu, e de qual anúncio ele veio.

Ele funciona como mais um "aparelho conectado" no WhatsApp do mentorado (igual ao WhatsApp Web).
O robô começa **desligado**: o gateway só lê. Responder pelo CRM é uma opção que se liga por conexão.

Dois jeitos de rodar, com o mesmo código:

| | Onde roda | Para quem |
|---|---|---|
| **Gateway** (`gateway.mjs`) | Um servidor (VPS) em São Paulo, ligado 24 h | Todos os mentorados (até ~25 por servidor) |
| **Modo PC** (`pc.mjs`) | O computador do próprio mentorado | Piloto, ou quem precisa usar a internet de casa |

O contrato com o CRM (o que o gateway manda e espera) está em [`CONTRATO.md`](CONTRATO.md).

---

## Antes de tudo: três avisos

1. **Risco de banimento.** Este é um cliente não oficial do WhatsApp. Não existe risco zero de o número ser
   bloqueado. Só ler é o perfil de menor risco, mas não é zero. Isso precisa estar no termo de adesão.
2. **Quem tem a pasta `dados/` tem o WhatsApp dos mentorados.** Com ela dá para ler e mandar mensagem pelo
   número de cada um. Nunca mande essa pasta por e-mail, nunca coloque no Git, e só guarde backup **cifrado**.
3. **No máximo ~25 números por servidor.** Muitos aparelhos saindo do mesmo IP de datacenter podem ser
   bloqueados juntos. Passou de 25, contrate um segundo servidor (ver "Mais de 25 números").

---

## 1. Contratar o servidor (VPS)

- **Região: São Paulo** (o WhatsApp do mentorado vê o aparelho conectado no Brasil).
- **Tamanho para até ~25 números:** 2 vCPU, 4 GB de RAM, 40 GB de SSD.
- **Sistema:** Ubuntu 24.04 LTS.
- IPv4 fixo (todo VPS tem).

Qualquer provedor com data center em São Paulo serve. Na criação, escolha **acesso por chave SSH**
(não por senha).

Para criar a chave no Windows (PowerShell):

```powershell
ssh-keygen -t ed25519 -C "gateway-crm"
# a chave pública fica em C:\Users\<você>\.ssh\id_ed25519.pub — é ela que se cola no painel do provedor
```

## 2. Apontar um subdomínio para o servidor

O CRM precisa "tocar a campainha" do gateway quando tem mensagem para enviar ou pedido de pareamento.
Para isso, crie no seu provedor de domínio um registro **A**:

```
gw.seudominio.com.br  ->  <IP do VPS>
```

O certificado (https) é tirado sozinho pelo Caddy, que já vem no `docker-compose.yml`.

## 3. Primeiro acesso e segurança do servidor

Entre no servidor:

```bash
ssh root@<IP do VPS>
```

Crie seu usuário e passe a chave para ele:

```bash
adduser erick
usermod -aG sudo erick
mkdir -p /home/erick/.ssh && cp /root/.ssh/authorized_keys /home/erick/.ssh/
chown -R erick:erick /home/erick/.ssh && chmod 700 /home/erick/.ssh && chmod 600 /home/erick/.ssh/authorized_keys
```

**SSH só por chave, sem root:**

```bash
cat > /etc/ssh/sshd_config.d/99-so-chave.conf <<'FIM'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
FIM
systemctl restart ssh
```

Abra **outra** janela e confirme que `ssh erick@<IP>` entra antes de fechar a primeira.

**Firewall: só 22, 80 e 443.**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

> O Docker abre por conta própria as portas que um serviço "publica" (`ports:`), passando por cima do ufw.
> Por isso o serviço `gateway` usa só `expose:` — a porta 8080 dele não sai do servidor. **Nunca acrescente
> `ports:` no serviço `gateway`.** Só o Caddy publica 80 e 443.

**Atualizações de segurança automáticas:**

```bash
sudo apt update && sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades
```

**Relógio certo.** Toda conversa com o CRM é assinada com a hora; com o relógio mais de 5 minutos errado,
o CRM recusa tudo (os eventos ficam guardados no servidor, mas nada sobe). O Ubuntu já acerta sozinho;
confira uma vez:

```bash
timedatectl          # tem que dizer "System clock synchronized: yes"
```

**Memória de folga (swap).** O primeiro histórico de uma conta grande dá um pico de memória. Com vários
mentorados conectando no mesmo dia, 2 GB de swap evitam que o sistema mate um processo:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Recomendado depois do piloto: 2FA no SSH e aviso de login por e-mail. Invadir este servidor é ter o
WhatsApp de todos os mentorados.

## 4. Instalar o Docker e subir o gateway

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker erick      # saia e entre de novo no SSH depois disso
```

Copie a pasta `gateway/` deste repositório para o servidor. Do seu PC:

```powershell
scp -r C:\dev\crmfitmind\gateway erick@<IP>:/home/erick/crm-gateway
```

No servidor:

```bash
cd ~/crm-gateway
cp .env.exemplo .env
nano .env                          # preencha (seção 5)
mkdir -p dados && sudo chown -R 1000:1000 dados && chmod 700 dados
docker compose up -d --build
docker compose logs -f gateway     # Ctrl+C sai do log, o gateway continua rodando
```

## 5. Variáveis

**No servidor** (arquivo `.env`, ao lado do `docker-compose.yml`):

| Variável | O que é |
|---|---|
| `CRM_BASE` | Endereço do CRM, só a origem: `https://crm-fitmind-whatsapp.vercel.app`. Fixo: o gateway não aceita trocar pela rede. |
| `GATEWAY_SECRET` | Segredo das assinaturas. Gere com `openssl rand -hex 32`. Mínimo 32 caracteres. |
| `GATEWAY_DOMINIO` | O subdomínio da seção 2 (ex.: `gw.seudominio.com.br`). |
| `SESSAO_MEMORIA_MB` | Opcional. Memória de cada sessão; padrão 512 (o 1º histórico de uma conta grande precisa). |

**No CRM** (variáveis da Vercel):

| Variável | Valor |
|---|---|
| `GATEWAY_SECRET` | **O mesmo** do servidor. |
| `GATEWAY_URL` | `https://gw.seudominio.com.br` — sem barra e sem caminho no fim. |

Se o segredo vazar, troque nos dois lugares e reinicie: `docker compose up -d`.

## 6. Conferir que está no ar

```bash
curl -i https://gw.seudominio.com.br/                         # 404: nada além da campainha é público
curl -i -X POST https://gw.seudominio.com.br/acordar -d '{}'  # 401: campainha sem assinatura é recusada
docker compose logs --tail 50 gateway                         # "versão 2.00.00; campainha em ..."
docker stats                                                  # memória de cada processo
```

De fora (do seu PC), `nmap -Pn gw.seudominio.com.br` deve mostrar só 22, 80 e 443.

Para conectar um mentorado: no CRM, tela da conexão, **Conectar** (QR ou código de 8 letras).
O gateway pega o pedido na hora (campainha) ou em até 60 s.

## 7. Backup cifrado das sessões (restic)

Perder a pasta `dados/` obriga todo mundo a conectar de novo. Por isso, backup diário — **sempre cifrado**,
porque o backup também é o WhatsApp de todos.

Crie um bucket num serviço de armazenamento compatível com S3 (Backblaze B2, AWS S3, Cloudflare R2…) e uma
chave de acesso só para esse bucket. Depois, no servidor:

```bash
sudo apt install -y restic
sudo sh -c 'openssl rand -hex 32 > /root/.restic-senha && chmod 600 /root/.restic-senha'
sudo tee /root/restic.env >/dev/null <<'FIM'
RESTIC_REPOSITORY=s3:https://<endpoint-do-bucket>/<nome-do-bucket>/crm-gateway
RESTIC_PASSWORD_FILE=/root/.restic-senha
AWS_ACCESS_KEY_ID=<chave>
AWS_SECRET_ACCESS_KEY=<segredo>
FIM
sudo chmod 600 /root/restic.env
sudo sh -c 'set -a; . /root/restic.env; restic init'
```

**Guarde a senha do restic** (`sudo cat /root/.restic-senha`) no seu gerenciador de senhas. Sem ela o backup
não abre; com ela e o bucket, alguém abre o WhatsApp de todos.

Backup todo dia às 03:30, mantendo 7 diários e 4 semanais:

```bash
sudo tee /root/backup-gateway.sh >/dev/null <<'FIM'
#!/bin/sh
set -a; . /root/restic.env; set +a
restic backup /home/erick/crm-gateway/dados --tag gateway --quiet
restic forget --tag gateway --keep-daily 7 --keep-weekly 4 --prune --quiet
FIM
sudo chmod 700 /root/backup-gateway.sh
echo '30 3 * * * root /root/backup-gateway.sh' | sudo tee /etc/cron.d/backup-gateway
```

Teste a volta uma vez:

```bash
sudo sh -c 'set -a; . /root/restic.env; restic snapshots; restic restore latest --target /tmp/teste-volta'
sudo rm -rf /tmp/teste-volta
```

> O backup é para desastre (servidor perdido). Uma sessão restaurada de um dia antes pode dar erro em algumas
> mensagens; se uma conexão ficar estranha depois de restaurar, peça para o mentorado conectar de novo.

## 8. Atualizar o gateway

Não existe atualização automática (no conector antigo ela permitia rodar código de fora no PC).
Atualizar é copiar a pasta nova por cima e reconstruir:

```bash
cd ~/crm-gateway
docker compose up -d --build
```

As sessões em `dados/` continuam: ninguém precisa conectar de novo.

## 9. Emergência: tirar tudo do ar

- **Parar a captura de todos:** `docker compose stop gateway`. As sessões ficam salvas; `docker compose start gateway` volta.
- **Desconectar um mentorado:** pelo CRM (botão Desconectar). O gateway sai do aparelho no celular dele e
  apaga a sessão do servidor.
- **Servidor invadido ou suspeita disso:** `docker compose down && sudo rm -rf dados/sessoes`, troque o
  `GATEWAY_SECRET` e peça para cada mentorado tirar o aparelho "Mac OS" em *WhatsApp → Aparelhos conectados*.

## 10. Mais de 25 números

Contrate um segundo servidor e suba outro gateway igual. **Pendência:** hoje o CRM conhece um gateway só
(`GATEWAY_URL`); para dividir, o CRM precisa saber qual gateway atende cada conexão.

## 11. Rodar no PC para o piloto

Precisa do Node.js 22 ou mais novo (https://nodejs.org, botão LTS) e do Git instalado (uma dependência do
WhatsApp vem do GitHub). Na primeira vez, `npm ci` dentro da pasta `gateway` baixa tudo.

### a) O gateway inteiro, no seu PC

Útil para o piloto no seu próprio número sem contratar o VPS ainda. Sem endereço público o CRM não consegue
tocar a campainha, então o gateway confere sozinho: a fila a cada 30 s e os pedidos de conectar e de
desconectar a cada 60 s. Na Vercel, deixe `GATEWAY_URL` vazio enquanto for assim.

```powershell
cd C:\dev\crmfitmind\gateway
npm ci
$env:CRM_BASE = "https://crm-fitmind-whatsapp.vercel.app"
$env:GATEWAY_SECRET = "<o mesmo da Vercel>"
node gateway.mjs
```

As sessões ficam em `gateway\dados\` (fora do Git). O PC precisa ficar ligado.

### b) Modo PC (uma conexão, com painel)

1. No CRM, na tela da conexão, clique em **Credenciais do conector** e copie o identificador e o segredo.
2. Dois cliques em `iniciar.bat` (na primeira vez ele baixa as dependências).
3. Abra **http://127.0.0.1:3100**, cole os dois e clique **Salvar**, depois **Testar ligação com o CRM**.
4. Clique **Conectar com QR** e leia no celular (*WhatsApp → Aparelhos conectados → Conectar aparelho*),
   ou **Conectar com código** e digite o código no celular.

O painel só abre no próprio computador (127.0.0.1). O endereço do CRM fica no `config.json` da pasta
(campo `base`); o painel não deixa trocar. Para o CRM poder **enviar** por este número, o robô tem de estar
ligado **no CRM** (Conectar WhatsApp → cartão da conexão → Opções): é o `bot_ativo` do banco que libera a fila,
as respostas do robô e o envio pelo Chat. O `"botAtivo": true` do `config.json` é só a trava local do
programa (os dois precisam estar ligados). Os grupos valem do mesmo jeito: o CRM só grava os grupos marcados
nas Opções da conexão, então marque lá os mesmos de `"gruposPermitidos": ["…@g.us"]`. Opcional no
`config.json`: `"historicoDias": 7`.

---

## O que fica em `dados/sessoes/<conexão>/`

| Arquivo | O que é |
|---|---|
| `auth/` | A sessão do WhatsApp. **É o acesso ao número.** |
| `pendentes.jsonl` | Eventos esperando o CRM aceitar (CRM fora do ar). Sobem sozinhos. |
| `rejeitados.jsonl` | Eventos que o CRM recusou, para diagnóstico (até ~1 MB). |
| `lids.json` | Pares LID → telefone que o WhatsApp revelou (para mostrar o número certo). |
| `enviados.json` | Últimos envios da fila, para nunca mandar a mesma mensagem duas vezes. |
| `parada.json` | Desde quando a conexão está parada. Com 7 dias, o gateway desconecta e apaga a pasta. |

## O que o gateway nunca faz

- Marcar mensagem como lida (o cliente veria os tiques azuis sem o mentorado ter lido).
- Ficar "online" no WhatsApp (isso silenciaria as notificações do celular do mentorado).
- Enviar com o robô desligado, enviar para grupo, ou mandar campanha.
- Mais de 1 envio a cada 8 s por número.
- Atualizar o próprio código ou aceitar outro endereço de CRM pela rede.
- Escrever corpo de mensagem ou telefone de cliente no log.

## Testes

```bash
npm test
```

Rodam sem WhatsApp e sem internet: as mensagens são exemplos no formato do Baileys 6.7.24 e o socket é falso.
