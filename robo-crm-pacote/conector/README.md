# Conector de WhatsApp — FitMind

> **Nesta cópia do pacote.** Este é o manual que acompanha o conector no FitMind;
> onde se lê "FitMind", leia "o seu servidor". Diferenças do que vem aqui:
>
> - **`iniciar.bat`** substitui o lançador `FitMindConector.exe` (que ficou fora por
>   ter a marca). Faz o mesmo: abre o `conector.mjs` e o reabre quando ele sai com
>   código 42, que é o pedido de reinício depois de uma auto-atualização. Na
>   primeira vez instala as dependências com `npm ci` — precisa do Node.js LTS
>   instalado.
> - **`baixar-node.bat`, `instalar-inicio-automatico.bat` e `mock-fitmind.mjs`**,
>   citados abaixo, **não vêm**: não foram encontrados nem no repositório nem no
>   pacote de instalação atual do FitMind. Para abrir junto com o Windows, ponha um
>   atalho do `iniciar.bat` na pasta `shell:startup`.
> - A versão do `conector.mjs` é a **1.03.00**, a mesma publicada no banco.

Roda no **PC da academia** (o mesmo da catraca) e mantém o WhatsApp da unidade
conectado ao robô da FitMind.

## Por que roda aqui e não na nuvem

A API não oficial mantém uma sessão viva do WhatsApp — o mesmo vínculo que o seu
celular tem quando lê o QR. Isso exige um processo ligado o tempo todo, com disco
para guardar as credenciais. A FitMind roda em Cloudflare, onde cada requisição
sobe e morre: não cabe lá.

Rodando aqui você ganha uma coisa boa de graça: **cada academia tem o próprio
número e a própria sessão**. Sem servidor central, sem sessão compartilhada.

## Instalar

1. Copie esta pasta para o PC da academia (ex.: `C:\FitMind\Conector`).

2. **Node.js.** O conector precisa dele. Duas opções:

   **Recomendado — sem instalar nada:** dê dois cliques em **`baixar-node.bat`**.
   Ele baixa o Node (~30 MB) *dentro desta pasta*, descobrindo sozinho a versão
   LTS atual e a arquitetura da máquina. Não mexe no computador, não pede senha
   de administrador e não conflita com nada que já esteja instalado. É o jeito
   certo para máquina de academia, que é ambiente de produção de outra pessoa.

   **Alternativa:** instalar pelo site https://nodejs.org (botão LTS). Depois de
   instalar, **feche a janela preta e abra de novo** — senão o Windows continua
   sem enxergar o Node.

3. Dê dois cliques em **`iniciar.bat`**. Na primeira vez ele baixa as
   dependências (alguns minutos, precisa de internet) e depois abre o painel.

4. Para o conector abrir sozinho quando ligar o computador, clique com o botão
   direito em **`instalar-inicio-automatico.bat`** e escolha *Executar como
   administrador*.

O `iniciar.bat` procura primeiro o Node da pasta e só depois o do sistema — então
se um dia a academia instalar outra versão, o conector continua usando a dele.

## Conectar o WhatsApp

1. Na FitMind, vá em **Admin → Robô de WhatsApp**, escolha a academia e clique
   em **Conectar número**. Ele mostra três dados, cada um com botão de copiar.
2. Cole os três no painel do conector (`http://localhost:3100`) e clique
   **Salvar**.
3. Clique **Testar ligação com a FitMind** — a luz da nuvem tem que ficar verde.
4. Aparece um QR. No celular da academia: **WhatsApp → Aparelhos conectados →
   Conectar aparelho**, e leia o código.
5. A luz do WhatsApp fica verde. Pronto.

Para testar a volta: na FitMind, botão **Enviar teste**, com um telefone seu.

## O painel

| Indicador | O que quer dizer |
|---|---|
| WhatsApp | se a sessão está de pé |
| nuvem | se a FitMind está respondendo |
| recebidas / enviadas | contagem desde que o conector abriu |
| **presas aqui** | mensagens que não subiram porque a nuvem não respondeu |

Se aparecer número em **presas aqui**, não faça nada: elas sobem sozinhas quando
a internet voltar. É proteção contra oscilação da rede da academia.

## Testar sem depender da FitMind

Tem uma FitMind de mentira junto:

```
node mock-fitmind.mjs          (num terminal)
node conector.mjs              (noutro)
```

No painel use `http://localhost:4000`, conexão `conexao-de-teste`, segredo
`segredo-de-teste`. Toda mensagem recebida ganha resposta automática.
Para forçar um envio: `http://localhost:4000/enfileirar?tel=SEUNUMERO&txt=oi`

## Arquivos

```
baixar-node.bat                   baixa o Node na pasta (sem instalar nada)
iniciar.bat                       dois cliques para abrir
instalar-inicio-automatico.bat    abre sozinho ao ligar o PC
conector.mjs                      o conector
painel.html                       o painel local
mock-fitmind.mjs                  FitMind de mentira, so para teste
config.json                       endereco, conexao e segredo (criado no 1o uso)
node/                             Node portatil (criado pelo baixar-node.bat)
sessao/                           credenciais do WhatsApp — NAO apague nem copie
pendentes.json                    mensagens presas esperando a internet
```

## Cuidados

- A pasta **`sessao/`** é o que mantém o número conectado. Se apagar, precisa ler
  o QR de novo. Se alguém copiar, tem acesso ao WhatsApp da academia. Não
  versione no Git e não mande por e-mail.
- Número em API não oficial **pode ser banido** pelo WhatsApp. Não use o número
  principal da academia sem estar disposto a perdê-lo.
- Se o WhatsApp for desconectado pelo celular (Aparelhos conectados → sair), o
  conector avisa e para. Apague a pasta `sessao/`, reinicie e leia o QR de novo.
- Grupos e status são ignorados de propósito: o robô só responde conversa direta.

## Contrato com a FitMind

Três chamadas, todas saindo daqui, autenticadas pelos cabeçalhos
`x-bot-conexao` e `x-bot-segredo`:

| Chamada | Para quê |
|---|---|
| `POST /api/bot/eventos` | avisa mensagem recebida, mudança de estado e batimento |
| `GET /api/bot/fila` | busca o que a FitMind quer enviar |
| `POST /api/bot/confirmar` | devolve se enviou ou deu erro |

Nenhuma credencial do banco fica nesta máquina.
