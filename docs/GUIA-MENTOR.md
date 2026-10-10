# Guia do mentor

Para quem administra a mentoria: cadastrar mentorados, acompanhar e resolver problemas. As telas de administração só aparecem para quem tem função **Administrador**.

## 1. Criar mentorado e empresa

Cada mentorado tem uma **empresa** (os dados dele ficam separados dos outros). Ordem recomendada:

1. Menu **Gestão de Usuários**, botão **Cadastrar Novo Usuário**.
2. Preencha **Nome Completo**, **E-mail**, **Senha Inicial** (mínimo 8 caracteres) e **WhatsApp / Telefone**. Em **Função**, deixe **Mentorado (vê só a própria empresa)**. Em **Empresa Vinculada**, deixe **Nenhuma** por enquanto.
3. Escolha o **Período de Validade do Acesso** e toque em **Cadastrar Usuário**.
4. Menu **Gestão de Empresas**, botão **Cadastrar Nova Empresa**. Preencha **Nome Fantasia / Empresa**, cidade e estado. Em **Dono (o mentorado)**, escolha a pessoa. Toque em **Criar Empresa**. O sistema já cria um funil de vendas e um fluxo do robô padrão.
5. Se criar a empresa antes do usuário, deixe "Definir depois": o primeiro usuário ligado à empresa vira o dono.
6. Mande ao mentorado o endereço, o e-mail e a senha inicial, peça que troque a senha em **Minha Conta** e envie junto o **Guia do mentorado**.

Você não fica como dono: o conteúdo é do mentorado.

## 2. Prazo de acesso

Em **Gestão de Usuários**, a coluna **Validade / Vencimento** mostra a data e os dias restantes (destaque com 5 dias ou menos).

1. Toque em **Renovar** na linha da pessoa.
2. Escolha 7, 30, 90, 180 dias, 1 ano ou acesso vitalício. O prazo conta a partir de hoje.
3. **Suspender Acesso** / **Ativar Acesso** bloqueia ou libera na hora, sem apagar nada.

## 3. A tela Mentoria

Abra **Mentoria** (grupo Administração no menu; no celular, **Mais**). Há um cartão por mentorado, com quem precisa de ajuda primeiro no topo. Cada cartão mostra os WhatsApps conectados, há quanto tempo deram sinal e os selos de alerta. Toque no cartão para ver os números do dia.

| Alerta | O que quer dizer | Cor | O que fazer |
|---|---|---|---|
| **WhatsApp sem sinal** | Conexão sem sinal há mais de 10 minutos | vermelho | Peça que reconecte em **Conectar WhatsApp**; veja a seção 6 |
| **Análise com erro** | A análise da IA do dia falhou | vermelho | Confira a autorização da IA e os tokens; tente de novo |
| **Análise atrasada** | O relatório do dia ainda não saiu | âmbar | Espere o ciclo noturno; se persistir, trate como erro |
| **2 dias sem conversa** | Nenhuma conversa registrada há 2 dias | vermelho | Mentorado parado ou WhatsApp desconectado: fale com ele |
| **Vendas para confirmar** | Mais de 5 vendas esperando decisão | âmbar | Lembre-o de abrir **Hoje** e confirmar |
| **Acesso vencendo** | Vence em até 7 dias | âmbar | Renove em **Gestão de Usuários** |

Vermelho = mentorado parado. Âmbar = vale olhar. Os números são contados pelo sistema; os alertas são calculados na hora.

## 4. O que você vê sem e com a liberação

A liberação é a chave **Permitir que o mentor veja minhas conversas**, que só o dono da empresa muda.

- **Sem liberação:** apenas os números do dia (quantas conversas, vendas, metas) e se a análise saiu. Não aparecem resumo da análise, nomes, telefones nem mensagens. Ao abrir Conversas, Funil ou Vendas dessa empresa, você vê "O mentorado não liberou as conversas" e o botão **Ir para Mentoria**. É proposital, e o servidor também bloqueia.
- **Com liberação:** contatos, mensagens, vendas e o resumo da IA. Use só para ajudar o mentorado. Ele pode desligar a qualquer momento, e vale na hora.

Se precisar ver algo, peça a liberação em vez de tentar contornar.

## 5. Tokens de IA

A rotina de análise (Claude Code) usa um **token** como credencial. Cada token só enxerga as empresas escolhidas.

1. Menu **Tokens de IA**, painel **Criar token**.
2. Dê um **Nome** (ex.: "Rotina do Erick") e marque as empresas que ele pode analisar.
3. Crie e use **Copiar token** na hora. Guarde em lugar seguro e não mande por mensagem aberta.
4. Se o token vazar ou não for mais usado, toque em **Revogar**. Quem o usa para de conseguir enviar análises imediatamente.

A lista mostra se cada token está **Ativo** ou revogado.

## 6. Quando um gateway cai

O gateway é o programa no servidor que mantém os WhatsApps conectados. O sinal da queda é vários mentorados com **WhatsApp sem sinal** ao mesmo tempo.

1. Veja se é geral (todos com alerta) ou de uma pessoa só. Se for de uma pessoa, peça que gere novo QR ou código em **Conectar WhatsApp**.
2. Se for geral, o problema está no servidor do gateway: confira se o serviço está no ar e reinicie.
3. Ao voltar, as sessões costumam reconectar sozinhas em poucos minutos.
4. Confirme na tela **Mentoria** que os alertas sumiram.
5. Sessão que caiu de vez (deslogada) só o mentorado resolve, lendo um novo QR ou código no celular dele.

Mensagens trocadas durante a queda podem não ter sido registradas.

## 7. Rotina sugerida da semana

**Toda manhã (5 minutos):**
1. Abra **Mentoria**.
2. Resolva primeiro os vermelhos (sem sinal, análise com erro, sem conversa).

**Segunda:** olhe os âmbar, veja acessos vencendo e renove.

**Quarta:** procure quem tem menos conversas e, se quiser olhar de perto, peça a liberação.

**Sexta:** compare vendas confirmadas com as metas de cada mentorado; revise os tokens de IA e revogue os que não usa.

**Uma vez por mês:** confira se há mentorados sem empresa, empresa sem dono ou acesso suspenso que deveria estar ativo.
