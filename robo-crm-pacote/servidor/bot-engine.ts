/**
 * Motor do robô — decide o que responder quando chega uma mensagem.
 *
 * Roda no servidor, chamado por /api/bot/eventos. A ordem importa:
 *
 *   1. É um token de verificação? Confirma e responde. Encerra aqui.
 *   2. A conversa está com atendente humano? Não interfere.
 *   3. Vincula ao CRM (a conversa vira lead no funil, sozinha).
 *   4. Roda o fluxo: acha a etapa atual, casa a resposta com uma opção,
 *      avança e enfileira o que o robô vai dizer.
 *
 * Enfileirar é só inserir em bot_mensagens com status 'pendente' — o conector
 * no PC da academia busca e envia. A nuvem nunca alcança aquele computador.
 */

type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

/** Formato do token de verificação: 3 letras + 4 caracteres. Ex.: FIT-7K2P */
const RE_TOKEN = /\b([A-Z]{3}-[A-Z0-9]{4})\b/i;

export type Conexao = {
  id: string;
  escopo: string;
  owner_id: string | null;
};

/** Coloca uma mensagem na fila de saída. O conector busca e envia. */
export async function enfileirar(db: Db, conversaId: string, corpo: string) {
  if (!corpo?.trim()) return null;
  const { data, error } = await db
    .from("bot_mensagens")
    .insert({ conversa_id: conversaId, direcao: "saida", tipo: "texto", corpo, status: "pendente" })
    .select("id")
    .single();
  if (error) return null;
  // registra no histórico do cartão, se a conversa já virou lead
  await db.rpc("bot_registrar_no_cartao", {
    _conversa_id: conversaId,
    _texto: corpo,
    _direcao: "saida",
  });
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * Verificação por WhatsApp. Quem manda é a pessoa, não a gente — por isso o
 * número não toma mensagem fria, que é o que faz o WhatsApp bloquear chip.
 */
async function tentarVerificacao(
  db: Db,
  texto: string,
  conversaId: string,
  telefone: string,
  conexaoId: string,
  nome: string | null,
): Promise<boolean> {
  const m = texto.match(RE_TOKEN);
  if (!m) return false;

  const { data, error } = await db.rpc("bot_confirmar_verificacao", {
    _token: m[1],
    _telefone: telefone,
    _conexao_id: conexaoId,
    _conversa_id: conversaId,
    _nome: nome,
  });
  if (error) return false;

  const r = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; motivo: string; finalidade: string | null }
    | null;
  if (!r) return false;

  if (r.ok) {
    await enfileirar(db, conversaId, "Pronto! Sua conta na FitMind está confirmada. Bons treinos 💪");
  } else if (r.motivo === "expirado") {
    await enfileirar(db, conversaId, "Esse código expirou. Volte no aplicativo e peça um novo, por favor.");
  } else if (r.motivo === "ja usado") {
    await enfileirar(db, conversaId, "Essa confirmação já tinha sido feita. Está tudo certo por aqui.");
  } else {
    // token não encontrado: pode ser texto normal parecido com token, então
    // não responde nada e deixa o fluxo seguir
    return false;
  }
  return true;
}

/** Acha o fluxo que deve atender esta conversa. */
async function escolherFluxo(db: Db, conexao: Conexao, texto: string) {
  const { data } = await db
    .from("bot_fluxos")
    .select("id, gatilho_tipo, gatilho_valor, passo_inicial_id")
    .eq("escopo", conexao.escopo)
    .eq("owner_id", conexao.owner_id)
    .eq("ativo", true)
    .is("arquivado_em", null);

  const fluxos = (data ?? []) as Array<{
    id: string;
    gatilho_tipo: string;
    gatilho_valor: string | null;
    passo_inicial_id: string | null;
  }>;
  if (!fluxos.length) return null;

  const t = texto.toLowerCase();
  // palavra-chave tem preferência sobre o fluxo genérico de primeira mensagem
  const porPalavra = fluxos.find(
    (f) =>
      f.gatilho_tipo === "palavra_chave" &&
      f.gatilho_valor &&
      f.gatilho_valor
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
        .some((p) => t.includes(p)),
  );
  return porPalavra ?? fluxos.find((f) => f.gatilho_tipo === "primeira_mensagem") ?? null;
}

/*
 * Como o robô entende a resposta.
 *
 * Era `resposta.includes(gatilho)` com gatilhos de UM dígito. Duas falhas, e as
 * duas apareceram em conversa real:
 *
 *   1. Não entendia frase. Uma cliente perguntou "Qual valor para 3 dias da
 *      semana?" — a pergunta mais comum de uma academia, com a resposta pronta
 *      no menu — e levou "Não entendi".
 *   2. Casava por acidente. "o plano de 145 reais" contém "1", "4" e "5":
 *      escolheria a opção 1 e mandaria a pessoa para o lugar errado, o que é
 *      pior que não entender, porque ninguém percebe.
 */

/** Minúsculas, sem acento, sem pontuação, espaços colapsados. */
const normalizar = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const escaparRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A frase aparece inteira no texto, com borda de palavra dos dois lados. */
const contemFrase = (texto: string, frase: string) =>
  !!frase && new RegExp(`(^| )${escaparRe(frase)}( |$)`).test(texto);

/** Só dígitos (e espaços entre eles) depois de normalizado: "2", "17 30". */
const soNumeros = (s: string) => /^\d+( \d+)*$/.test(s);

type OpcaoCasavel = { rotulo: string; gatilho: string; sinonimos?: string[] | null };

export function casarOpcao<T extends OpcaoCasavel>(opcoes: T[], resposta: string): T | null {
  const t = normalizar(resposta);
  if (!t) return null;
  const palavras = t.split(" ").length;

  // 1. A resposta É o gatilho. Cobre "2", "2)", " 2. " — tudo vira "2".
  const exata = opcoes.find((o) => normalizar(o.gatilho) === t);
  if (exata) return exata;

  /*
   * 2. Sinônimo: como a academia sabe que o cliente pergunta.
   *
   * Sinônimo de PALAVRA casa em qualquer tamanho — "qual valor para 3 dias da
   * semana" tem seis palavras e é exatamente o que "valor" existe para pegar.
   * Sinônimo que é só NÚMERO segue a regra dos números: "Posso treinar até às
   * 06:40" contém "06", mas quem escreve isso não está escolhendo a aula das 6.
   */
  const porSinonimo = opcoes.find((o) =>
    (o.sinonimos ?? []).some((s) => {
      const n = normalizar(s);
      if (soNumeros(n) && palavras > 3) return false;
      return contemFrase(t, n);
    }),
  );
  if (porSinonimo) return porSinonimo;

  // 3. O rótulo inteiro dentro da resposta ("quero agendar aula experimental").
  const porRotulo = opcoes.find((o) => contemFrase(t, normalizar(o.rotulo)));
  if (porRotulo) return porRotulo;

  /*
   * 4. Gatilho solto dentro da frase — só em resposta CURTA.
   *
   * "quero 2" é escolha de menu; "qual valor para 3 dias da semana" não é. O
   * corte por tamanho é grosseiro de propósito: quem responde menu responde
   * curto, e quem escreve uma frase quer ser lido pelo sentido, não pelo dígito
   * que por acaso apareceu nela.
   */
  if (palavras <= 3) {
    const porGatilho = opcoes.find((o) => contemFrase(t, normalizar(o.gatilho)));
    if (porGatilho) return porGatilho;
  }

  return null;
}

/** Lê um passo com as opções dele. */
async function lerPasso(db: Db, passoId: string) {
  const { data: passo } = await db
    .from("bot_passos")
    .select("id, fluxo_id, chave, tipo, conteudo, proximo_passo_id, acao, acao_params")
    .eq("id", passoId)
    .maybeSingle();
  if (!passo) return null;

  const { data: opcoes } = await db
    .from("bot_opcoes")
    .select("id, rotulo, gatilho, sinonimos, proximo_passo_id, posicao")
    .eq("passo_id", passoId)
    .order("posicao");

  return {
    ...(passo as Record<string, any>),
    opcoes: (opcoes ?? []) as Array<{ rotulo: string; gatilho: string; proximo_passo_id: string | null }>,
  } as Record<string, any> & {
    opcoes: Array<{ rotulo: string; gatilho: string; proximo_passo_id: string | null }>;
  };
}

/** Monta o texto do passo, colando as opções embaixo quando for pergunta. */
function textoDoPasso(passo: any): string {
  const base = (passo.conteudo ?? "").trim();
  if (passo.tipo !== "pergunta" || !passo.opcoes?.length) return base;
  const lista = passo.opcoes.map((o: any) => `${o.gatilho}) ${o.rotulo}`).join("\n");
  return base ? `${base}\n\n${lista}` : lista;
}

/** Executa a ação de um passo do tipo 'acao'. */
async function executarAcao(db: Db, passo: any, conversaId: string) {
  switch (passo.acao) {
    case "criar_cartao_crm":
      await db.rpc("bot_vincular_cartao", { _conversa_id: conversaId });
      break;
    case "transferir":
      await db.from("bot_conversas").update({ estado: "humano" }).eq("id", conversaId);
      break;

    /*
     * Avisa que está fora do expediente — e só nesse caso.
     *
     * A automação roda igual a qualquer hora: quem escreve às 23h merece a
     * mesma resposta de quem escreve às 10h. O que muda é o fecho, para a
     * pessoa não ficar esperando alguém que não vai responder agora.
     *
     * Os horários vêm em acao_params, não em código: academia muda horário e
     * isso não pode virar migration.
     */
    case "fora_do_horario": {
      const cfg = (passo.acao_params ?? {}) as Record<string, any>;
      const texto = String(cfg.texto ?? "").trim();
      if (!texto) break;

      /*
       * Feriado vem antes de dia e hora.
       *
       * Sem isto, no 7 de setembro o robô diria "estamos abertos" e marcaria
       * aula experimental para uma academia de porta fechada. Quem aparecesse
       * na porta não voltaria — e a academia nunca saberia por quê.
       *
       * Diz QUAL é o feriado porque "estamos fechados" sozinho, num dia de
       * semana às 10 da manhã, parece defeito do sistema.
       */
      if (cfg.partnerId) {
        const { data: feriado } = await db.rpc("partner_feriado_de_hoje", {
          p_partner_id: String(cfg.partnerId),
        });
        const nome = typeof feriado === "string" ? feriado.trim() : "";
        if (nome) {
          await enfileirar(
            db,
            conversaId,
            `Hoje é ${nome} e a academia não abre. ${texto}`,
          );
          break;
        }
      }

      const partes = new Intl.DateTimeFormat("en-GB", {
        timeZone: String(cfg.timezone ?? "America/Sao_Paulo"),
        weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(new Date());

      const achar = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
      const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const diaDaSemana = DIAS[achar("weekday")] ?? 0;
      const agora = Number(achar("hour")) * 60 + Number(achar("minute"));

      const emMinutos = (h: unknown) => {
        const [a, b] = String(h ?? "").split(":").map(Number);
        return (a || 0) * 60 + (b || 0);
      };
      const dias: number[] = Array.isArray(cfg.dias) ? cfg.dias : [1, 2, 3, 4, 5];
      const dentro =
        dias.includes(diaDaSemana) &&
        agora >= emMinutos(cfg.inicio ?? "04:30") &&
        agora < emMinutos(cfg.fim ?? "22:00");

      if (!dentro) await enfileirar(db, conversaId, texto);
      break;
    }
    default:
      break;
  }
}

/**
 * Anda no fluxo a partir de um passo, enfileirando o que precisar.
 * Passos de mensagem encadeiam sozinhos; para em pergunta, transferência ou fim.
 * O limite de 10 evita laço infinito se alguém montar um fluxo circular.
 */
async function caminhar(db: Db, conversaId: string, passoId: string | null) {
  let atual = passoId;
  for (let i = 0; i < 10 && atual; i++) {
    const passo = await lerPasso(db, atual);
    if (!passo) break;

    if (passo.tipo === "acao") await executarAcao(db, passo, conversaId);

    const texto = textoDoPasso(passo);
    if (texto) await enfileirar(db, conversaId, texto);

    if (passo.tipo === "pergunta") {
      // espera a resposta da pessoa
      await db.from("bot_conversas").update({ passo_atual_id: passo.id }).eq("id", conversaId);
      return;
    }
    if (passo.tipo === "transferir") {
      await db
        .from("bot_conversas")
        .update({ estado: "humano", passo_atual_id: passo.id })
        .eq("id", conversaId);
      return;
    }
    if (passo.tipo === "encerrar") {
      await db
        .from("bot_conversas")
        .update({ estado: "encerrada", encerrada_em: new Date().toISOString(), passo_atual_id: null })
        .eq("id", conversaId);
      return;
    }

    atual = passo.proximo_passo_id;
    await db.from("bot_conversas").update({ passo_atual_id: atual }).eq("id", conversaId);
  }
}

/**
 * Ponto de entrada: chamado quando chega uma mensagem do conector.
 * Devolve o que foi feito, para o log da rota.
 */
export async function processarMensagem(
  db: Db,
  opts: {
    conexao: Conexao;
    conversaId: string;
    telefone: string;
    texto: string;
    nome: string | null;
  },
): Promise<{ acao: string }> {
  const { conexao, conversaId, telefone, texto, nome } = opts;
  const limpo = (texto ?? "").trim();

  // 1. token de verificação tem prioridade sobre tudo
  if (limpo && (await tentarVerificacao(db, limpo, conversaId, telefone, conexao.id, nome))) {
    return { acao: "verificacao" };
  }

  // 2. conversa com atendente humano: o robô não interfere
  const { data: conv } = await db
    .from("bot_conversas")
    .select("id, estado, fluxo_id, passo_atual_id, tentativas_passo")
    .eq("id", conversaId)
    .maybeSingle();
  const conversa = conv as {
    estado: string;
    fluxo_id: string | null;
    passo_atual_id: string | null;
  } | null;
  if (!conversa) return { acao: "conversa nao encontrada" };

  /*
   * Conversa encerrada volta a ser atendida quando a pessoa escreve de novo.
   *
   * "Encerrada" era terminal: o robô atendia cada pessoa UMA vez na vida. Quem
   * perguntou o preço na terça e voltou na quinta para marcar a aula
   * experimental falava com o vazio — e a academia nem ficava sabendo. Pior: o
   * próprio robô encerra dizendo "digite *falar com atendente*", uma instrução
   * que ficava impossível de obedecer no instante seguinte.
   *
   * Recomeça limpo (sem fluxo, sem passo, sem tentativas) porque é uma conversa
   * nova, não a continuação de uma que já acabou. "Humano" continua intocado:
   * ali tem gente atendendo, e o robô por cima seria pior que o silêncio.
   */
  if (conversa.estado === "encerrada") {
    await db
      .from("bot_conversas")
      .update({
        estado: "bot",
        encerrada_em: null,
        fluxo_id: null,
        passo_atual_id: null,
        tentativas_passo: 0,
      })
      .eq("id", conversaId);
    conversa.estado = "bot";
    conversa.fluxo_id = null;
    conversa.passo_atual_id = null;
  }

  if (conversa.estado !== "bot") return { acao: `ignorado (estado ${conversa.estado})` };

  // 3. vira lead no funil, sozinho
  await db.rpc("bot_vincular_cartao", { _conversa_id: conversaId });
  await db.rpc("bot_registrar_no_cartao", {
    _conversa_id: conversaId,
    _texto: limpo,
    _direcao: "entrada",
  });

  /*
   * 3b. Pedir atendente funciona em QUALQUER ponto.
   *
   * Antes só existia como passo do fluxo: quem digitasse isso no meio de uma
   * pergunta caía no "não entendi" e era devolvido ao menu — exatamente quando
   * já tinha desistido do menu.
   */
  if (/\b(atendente|humano|pessoa de verdade|falar com alguem|falar com algu[ée]m)\b/i.test(limpo)) {
    await db
      .from("bot_conversas")
      .update({ estado: "humano", passo_atual_id: null, tentativas_passo: 0 })
      .eq("id", conversaId);
    await enfileirar(
      db,
      conversaId,
      "Certo! Já avisei a equipe. Assim que alguém estiver disponível, responde por aqui mesmo.",
    );
    return { acao: "pediu atendente" };
  }

  // 4. já está no meio de um fluxo? tenta casar a resposta com uma opção
  if (conversa.passo_atual_id) {
    const passo = await lerPasso(db, conversa.passo_atual_id);
    if (passo?.opcoes?.length) {
      const escolha = casarOpcao(passo.opcoes as any[], limpo);

      if (escolha) {
        await db.from("bot_conversas").update({ tentativas_passo: 0 }).eq("id", conversaId);
        await caminhar(db, conversaId, escolha.proximo_passo_id);
        return { acao: "avancou no fluxo" };
      }

      /*
       * Não entendeu. Repete UMA vez e depois solta a pessoa.
       *
       * Repetir para sempre é o que faz alguém fechar o WhatsApp achando que
       * falou com uma parede — e a academia nunca fica sabendo que existiu essa
       * conversa. Na segunda vez, oferece gente e encerra; o cartão no funil
       * já foi criado lá em cima, então o lead não se perde.
       */
      const tentativas = Number((conversa as any).tentativas_passo ?? 0) + 1;
      if (tentativas >= 2) {
        /*
         * Na segunda vez, chama gente — não pede uma senha.
         *
         * Antes o robô encerrava dizendo "digite *falar com atendente*". Duas
         * coisas erradas: pedia mais esforço justamente de quem já mostrou que
         * não está conseguindo, e encerrava a conversa no mesmo instante, o que
         * tornava a instrução impossível de obedecer. Quem chegou aqui é um lead
         * que fez duas perguntas — vale um humano, não um menu.
         */
        await enfileirar(
          db,
          conversaId,
          "Essa eu não sei responder sozinho — já chamei alguém da equipe. Respondem por aqui mesmo, é só aguardar 🙂",
        );
        await db
          .from("bot_conversas")
          .update({ estado: "humano", passo_atual_id: null, tentativas_passo: 0 })
          .eq("id", conversaId);
        return { acao: "passou para atendente por nao entender" };
      }

      await db.from("bot_conversas").update({ tentativas_passo: tentativas }).eq("id", conversaId);
      await enfileirar(db, conversaId, `Não entendi. ${textoDoPasso(passo)}`);
      return { acao: "repetiu as opcoes" };
    }
  }

  // 5. começo de conversa: escolhe o fluxo e entra nele
  const fluxo = await escolherFluxo(db, conexao, limpo);
  if (!fluxo) return { acao: "sem fluxo ativo" };

  await db.from("bot_conversas").update({ fluxo_id: fluxo.id }).eq("id", conversaId);
  await caminhar(db, conversaId, fluxo.passo_inicial_id);
  return { acao: "iniciou fluxo" };
}
