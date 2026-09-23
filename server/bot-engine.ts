import { Db } from "./supabase";

export type Conexao = {
  id: string;
  escopo: string;
  owner_id: string | null;
};

const normalizar = (s: string) =>
  (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const escaparRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const contemFrase = (texto: string, frase: string) =>
  !!frase && new RegExp(`(^| )${escaparRe(frase)}( |$)`).test(texto);

const soNumeros = (s: string) => /^\d+( \d+)*$/.test(s);

type OpcaoCasavel = { rotulo: string; gatilho: string; sinonimos?: string[] | null };

export function casarOpcao<T extends OpcaoCasavel>(opcoes: T[], resposta: string): T | null {
  const t = normalizar(resposta);
  if (!t) return null;
  const palavras = t.split(" ").length;

  const exata = opcoes.find((o) => normalizar(o.gatilho) === t);
  if (exata) return exata;

  const porSinonimo = opcoes.find((o) =>
    (o.sinonimos ?? []).some((s) => {
      const n = normalizar(s);
      if (soNumeros(n) && palavras > 3) return false;
      return contemFrase(t, n);
    }),
  );
  if (porSinonimo) return porSinonimo;

  const porRotulo = opcoes.find((o) => contemFrase(t, normalizar(o.rotulo)));
  if (porRotulo) return porRotulo;

  if (palavras <= 3) {
    const porGatilho = opcoes.find((o) => contemFrase(t, normalizar(o.gatilho)));
    if (porGatilho) return porGatilho;
  }

  return null;
}

export async function enfileirar(db: Db, conversaId: string, corpo: string) {
  if (!corpo?.trim()) return null;
  const { data, error } = await db
    .from("bot_mensagens")
    .insert({
      conversa_id: conversaId,
      direcao: "saida",
      tipo: "texto",
      corpo,
      status: "pendente",
    })
    .select("id")
    .single();

  if (error) return null;

  try {
    await db.rpc("bot_registrar_no_cartao", {
      _conversa_id: conversaId,
      _texto: corpo,
      _direcao: "saida",
    });
  } catch (err) {
    // Ignora se não houver cartão vinculado
  }

  return (data as { id: string } | null)?.id ?? null;
}

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

async function lerPasso(db: Db, passoId: string) {
  const { data: passo } = await db
    .from("bot_passos")
    .select("id, fluxo_id, chave, tipo, conteudo, proximo_passo_id")
    .eq("id", passoId)
    .maybeSingle();

  if (!passo) return null;

  const { data: opcoes } = await db
    .from("bot_opcoes")
    .select("id, rotulo, gatilho, proximo_passo_id, posicao")
    .eq("passo_id", passoId)
    .order("posicao");

  return {
    ...passo,
    opcoes: (opcoes ?? []) as Array<{ rotulo: string; gatilho: string; proximo_passo_id: string | null }>,
  };
}

function textoDoPasso(passo: any): string {
  const base = (passo.conteudo ?? "").trim();
  if (passo.tipo !== "pergunta" || !passo.opcoes?.length) return base;
  const lista = passo.opcoes.map((o: any) => `${o.gatilho} - ${o.rotulo}`).join("\n");
  return base ? `${base}\n\n${lista}` : lista;
}

export async function processarMensagem(
  db: Db,
  entrada: {
    conexao: Conexao;
    conversaId: string;
    telefone: string;
    texto: string;
    nome: string | null;
  },
) {
  const { conexao, conversaId, telefone, texto, nome } = entrada;

  // 1. Busca conversa atual
  const { data: conversa } = await db
    .from("bot_conversas")
    .select("id, estado, fluxo_id, passo_atual_id, cartao_id, tentativas_passo")
    .eq("id", conversaId)
    .single();

  if (!conversa) return { acao: "conversa_nao_encontrada" };

  // Se já está com atendente humano, não interfere
  if (conversa.estado === "humano") {
    try {
      await db.rpc("bot_registrar_no_cartao", {
        _conversa_id: conversaId,
        _texto: texto,
        _direcao: "entrada",
      });
    } catch {}
    return { acao: "humano_ativo" };
  }

  // 2. Vincula ao CRM se ainda não vinculado
  if (!conversa.cartao_id) {
    try {
      await db.rpc("bot_vincular_cartao", { _conversa_id: conversaId });
    } catch (e) {
      console.warn("Erro ao vincular cartão no CRM:", e);
    }
  }

  try {
    await db.rpc("bot_registrar_no_cartao", {
      _conversa_id: conversaId,
      _texto: texto,
      _direcao: "entrada",
    });
  } catch {}

  // 3. Falar com atendente em qualquer ponto
  const tNorm = normalizar(texto);
  if (
    contemFrase(tNorm, "falar com atendente") ||
    contemFrase(tNorm, "humano") ||
    contemFrase(tNorm, "atendente") ||
    contemFrase(tNorm, "falar com alguem")
  ) {
    await db.from("bot_conversas").update({ estado: "humano" }).eq("id", conversaId);
    await enfileirar(db, conversaId, "Certo! Já chamei um atendente da nossa equipe. Aguarde um momento que em breve responderemos aqui.");
    return { acao: "transferido_humano" };
  }

  // 4. Execução do Fluxo
  let fluxoId = conversa.fluxo_id;
  let passoId = conversa.passo_atual_id;

  if (!fluxoId || !passoId) {
    const fluxo = await escolherFluxo(db, conexao, texto);
    if (!fluxo || !fluxo.passo_inicial_id) {
      return { acao: "sem_fluxo" };
    }
    fluxoId = fluxo.id;
    passoId = fluxo.passo_inicial_id;

    await db.from("bot_conversas").update({
      fluxo_id: fluxoId,
      passo_atual_id: passoId,
      tentativas_passo: 0,
    }).eq("id", conversaId);

    const passo = await lerPasso(db, passoId);
    if (passo) {
      await enfileirar(db, conversaId, textoDoPasso(passo));
      return { acao: "fluxo_iniciado", passoId };
    }
  }

  // Processa resposta para o passo atual
  const passoAtual = await lerPasso(db, passoId);
  if (!passoAtual) return { acao: "passo_invalido" };

  if (passoAtual.tipo === "pergunta" && passoAtual.opcoes?.length) {
    const opcaoEscolhida = casarOpcao(passoAtual.opcoes, texto);

    if (opcaoEscolhida && opcaoEscolhida.proximo_passo_id) {
      const proximo = await lerPasso(db, opcaoEscolhida.proximo_passo_id);
      if (proximo) {
        if (proximo.tipo === "transferir") {
          await db.from("bot_conversas").update({ estado: "humano", passo_atual_id: proximo.id }).eq("id", conversaId);
          await enfileirar(db, conversaId, proximo.conteudo || "Aguarde um momento, transferindo para nosso atendente...");
          return { acao: "transferido_humano" };
        }

        await db.from("bot_conversas").update({
          passo_atual_id: proximo.id,
          tentativas_passo: 0,
        }).eq("id", conversaId);

        await enfileirar(db, conversaId, textoDoPasso(proximo));
        return { acao: "avancou", proximoPassoId: proximo.id };
      }
    } else {
      // Não entendeu
      const tentativas = (conversa.tentativas_passo || 0) + 1;
      if (tentativas >= 2) {
        await db.from("bot_conversas").update({ estado: "humano", tentativas_passo: 0 }).eq("id", conversaId);
        await enfileirar(db, conversaId, "Não consegui identificar sua resposta. Vou transferir seu contato para nossa equipe continuar com você aqui.");
        return { acao: "transferido_tentativas" };
      } else {
        await db.from("bot_conversas").update({ tentativas_passo: tentativas }).eq("id", conversaId);
        await enfileirar(db, conversaId, `Não compreendi a opção escolhida. Por favor, selecione uma das opções abaixo:\n\n${textoDoPasso(passoAtual)}`);
        return { acao: "repetiu_opcoes" };
      }
    }
  }

  return { acao: "processado" };
}
