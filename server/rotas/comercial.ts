// Vendas, catálogo de produtos, rastreamento do tráfego pago e metas do dia (Fases 2 e 3).
// O navegador só lê; quem grava é o servidor, depois de conferir a empresa pelo JWT.
import type { Express, Request, Response } from "express";
import { fusoValido } from "../arquivo-completo.js";
import { ERRO_SEM_CONTEUDO, exigirConteudo, podeNaEmpresa, podeVerConteudo } from "../auth.js";
import { assincrono, ehUuid, texto, type Contexto } from "../contexto.js";
import { comprovanteParaVenda, type ComprovanteNaVenda } from "../comprovante-leitura.js";
import { diaValido, exigirCrm, hojeNoFuso, partnerDoPedido } from "../ia/acesso.js";
import type { Db } from "../supabase.js";
import { telefoneDoPareamento } from "./conexoes.js";

const FORMAS = ["pix", "cartao", "boleto", "dinheiro", "transferencia", "link_pagamento", "outro", "desconhecida"];
const TIPOS_META = ["novas_conversas", "followups", "vendas_qtd", "vendas_valor", "tempo_resposta_min"];
const arredondar = (n: number) => Math.round(n * 100) / 100;

async function fusoDaEmpresa(db: Db, partnerId: string): Promise<string> {
  const { data } = await db.from("partner_acesso_config").select("timezone").eq("partner_id", partnerId).maybeSingle();
  return fusoValido(data?.timezone);
}

function numeroOuNulo(v: unknown, max: number): number | null | "invalido" {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= max ? arredondar(n) : "invalido";
}

// Rotas com :id no caminho: o partner vem da linha, nunca do pedido. Com conteudo:true (vendas), o admin
// que não é da empresa só passa com o opt-in do dono.
async function linhaDoMeuParceiro(db: Db, tabela: string, req: Request, res: Response, colunas = "*", conteudo = false): Promise<any | null> {
  const id = req.params.id;
  if (!ehUuid(id)) {
    res.status(400).json({ erro: "id inválido" });
    return null;
  }
  const { data, error } = await db.from(tabela).select(colunas).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || !podeNaEmpresa(req.auth, (data as any).partner_id, "crm")) {
    res.status(404).json({ erro: "nao_encontrado" });
    return null;
  }
  if (conteudo && !(await podeVerConteudo(db, req.auth, (data as any).partner_id, "crm"))) {
    res.status(403).json({ erro: ERRO_SEM_CONTEUDO });
    return null;
  }
  return data;
}

function vendaParaTela(v: any, contato: any, comprovanteMensagemId: string | null = null, leitura: ComprovanteNaVenda | null = null) {
  return {
    id: v.id,
    dia: String(v.dia).slice(0, 10),
    valor: v.valor === null || v.valor === undefined ? null : Number(v.valor),
    forma: v.forma ?? null,
    produto: v.produto ?? null,
    status: v.status,
    fonte: v.fonte,
    contato: contato ? { id: contato.id, nome: contato.nome ?? null, telefone: contato.telefone ?? null } : null,
    evidencia_trecho: v.evidencia_trecho ?? null,
    alerta: v.alerta ?? null,
    // Mensagem do cliente com imagem/PDF (a prova da venda, ou o último arquivo da conversa): só nas a confirmar.
    comprovante_mensagem_id: comprovanteMensagemId,
    // Leitura da IA (só pista, já mascarada) e os alertas de conferência; nunca muda o status da venda.
    comprovante_leitura: leitura,
    criado_em: v.created_at,
  };
}

// Para cada venda a confirmar, a mensagem com comprovante: a própria prova, se tiver arquivo, senão o arquivo mais novo
// da conversa. O arquivo é auxiliar (nunca confirma venda): se a coluna ainda não existe, a lista segue sem ele.
async function comprovantesDasVendas(db: Db, vendas: any[]): Promise<Map<string, string>> {
  const porVenda = new Map<string, string>();
  const pendentes = vendas.filter((v) => v.status === "pendente_confirmacao" && ehUuid(v.conversa_id));
  if (!pendentes.length) return porVenda;
  const conversas = [...new Set(pendentes.map((v) => v.conversa_id as string))];
  const porConversa = new Map<string, string[]>(); // do arquivo mais novo para o mais velho
  for (let i = 0; i < conversas.length; i += 100) {
    const { data, error } = await db
      .from("bot_mensagens")
      .select("id, conversa_id")
      .in("conversa_id", conversas.slice(i, i + 100))
      .not("arquivo_path", "is", null)
      .order("arquivo_em", { ascending: false })
      .limit(1000);
    if (error) {
      console.error("[vendas] comprovantes indisponíveis:", error.message ?? error);
      return porVenda;
    }
    for (const m of (data || []) as Array<{ id: string; conversa_id: string }>) {
      porConversa.set(m.conversa_id, [...(porConversa.get(m.conversa_id) ?? []), m.id]);
    }
  }
  for (const v of pendentes) {
    const ids = porConversa.get(v.conversa_id) ?? [];
    if (!ids.length) continue;
    porVenda.set(v.id, ids.includes(v.evidencia_mensagem_id) ? v.evidencia_mensagem_id : ids[0]);
  }
  return porVenda;
}

// A leitura da IA de cada comprovante apontado, já comparada com o valor da venda e com o dia da mensagem (no fuso da
// empresa). Também é auxiliar: sem a coluna (migração 006 antiga) ou com erro, a lista segue sem a leitura.
async function leiturasDasVendas(db: Db, vendas: any[], comprovantes: Map<string, string>, fuso: string): Promise<Map<string, ComprovanteNaVenda>> {
  const porVenda = new Map<string, ComprovanteNaVenda>();
  const ids = [...new Set(comprovantes.values())];
  if (!ids.length) return porVenda;
  const mensagens = new Map<string, { wa_em: string | null; comprovante_leitura: any }>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from("bot_mensagens").select("id, wa_em, comprovante_leitura").in("id", ids.slice(i, i + 100));
    if (error) {
      console.error("[vendas] leitura de comprovantes indisponível:", error.message ?? error);
      return porVenda;
    }
    for (const m of (data || []) as any[]) mensagens.set(m.id, m);
  }
  for (const v of vendas) {
    const m = mensagens.get(comprovantes.get(v.id) ?? "");
    if (!m?.comprovante_leitura) continue;
    const dia = m.wa_em ? hojeNoFuso(new Date(m.wa_em), fuso) : null;
    const leitura = comprovanteParaVenda(m.comprovante_leitura, v.valor === null || v.valor === undefined ? null : Number(v.valor), dia);
    if (leitura) porVenda.set(v.id, leitura);
  }
  return porVenda;
}

export function registrarRotasComercial(app: Express, ctx: Contexto) {
  // ------------------------------------------------------------------ vendas
  app.get(
    "/api/vendas",
    exigirConteudo(ctx, "crm"),
    assincrono(async (req, res) => {
      const partnerId = partnerDoPedido(req);
      const db = ctx.db();
      const ate = req.query.ate === undefined ? hojeNoFuso(ctx.agora(), await fusoDaEmpresa(db, partnerId)) : req.query.ate;
      const de = req.query.de === undefined ? new Date(new Date(`${ate}T00:00:00Z`).getTime() - 30 * 864e5).toISOString().slice(0, 10) : req.query.de;
      if (!diaValido(de) || !diaValido(ate)) return res.status(400).json({ erro: "período inválido (use AAAA-MM-DD)" });

      const { data, error } = await db.from("vendas").select("*").eq("partner_id", partnerId).gte("dia", de).lte("dia", ate).order("dia", { ascending: false }).limit(1000);
      if (error) throw error;
      const linhas = (data || []) as any[];
      const ids = [...new Set(linhas.map((v) => v.contato_id).filter(Boolean))];
      const contatos = new Map<string, any>();
      if (ids.length) {
        const { data: cs, error: e2 } = await db.from("contatos").select("id, nome, telefone, origem_tipo").eq("partner_id", partnerId).in("id", ids);
        if (e2) throw e2;
        for (const c of cs || []) contatos.set(c.id, c);
      }

      const totais = { confirmado: 0, a_confirmar: 0, por_forma: {} as Record<string, number>, por_origem: {} as Record<string, number> };
      for (const v of linhas) {
        const valor = Number(v.valor ?? 0);
        if (v.status === "pendente_confirmacao") totais.a_confirmar += valor;
        if (v.status !== "confirmada") continue;
        totais.confirmado += valor;
        const forma = v.forma ?? "desconhecida";
        const origem = contatos.get(v.contato_id)?.origem_tipo ?? "desconhecido";
        totais.por_forma[forma] = arredondar((totais.por_forma[forma] ?? 0) + valor);
        totais.por_origem[origem] = arredondar((totais.por_origem[origem] ?? 0) + valor);
      }
      totais.confirmado = arredondar(totais.confirmado);
      totais.a_confirmar = arredondar(totais.a_confirmar);
      const comprovantes = await comprovantesDasVendas(db, linhas);
      const leituras = await leiturasDasVendas(db, linhas, comprovantes, await fusoDaEmpresa(db, partnerId));
      return res.json({ vendas: linhas.map((v) => vendaParaTela(v, contatos.get(v.contato_id), comprovantes.get(v.id) ?? null, leituras.get(v.id) ?? null)), totais });
    }),
  );

  // Venda lançada à mão: já nasce confirmada (quem lança é o dono do dinheiro).
  app.post(
    "/api/vendas",
    exigirConteudo(ctx, "crm"),
    assincrono(async (req, res) => {
      const partnerId = partnerDoPedido(req);
      const corpo = req.body ?? {};
      const db = ctx.db();
      const valor = Number(corpo.valor);
      if (!Number.isFinite(valor) || valor <= 0 || valor > 10_000_000) return res.status(400).json({ erro: "valor inválido" });
      if (!FORMAS.includes(corpo.forma)) return res.status(400).json({ erro: "forma de pagamento inválida" });
      const produto = texto(corpo.produto).slice(0, 80) || null;
      const dia = corpo.dia === undefined || corpo.dia === null || corpo.dia === "" ? hojeNoFuso(ctx.agora(), await fusoDaEmpresa(db, partnerId)) : corpo.dia;
      if (!diaValido(dia)) return res.status(400).json({ erro: "dia inválido (use AAAA-MM-DD)" });

      let contato: any = null;
      if (corpo.contatoId) {
        if (!ehUuid(corpo.contatoId)) return res.status(400).json({ erro: "contatoId inválido" });
        const { data, error } = await db.from("contatos").select("id, nome, telefone").eq("id", corpo.contatoId).eq("partner_id", partnerId).maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ erro: "contato_nao_encontrado" });
        contato = data;
      } else if (corpo.telefone) {
        const telefone = telefoneDoPareamento(corpo.telefone);
        if (!telefone) return res.status(400).json({ erro: "telefone inválido" });
        const { data: achado, error } = await db.from("contatos").select("id, nome, telefone").eq("partner_id", partnerId).eq("telefone", telefone).maybeSingle();
        if (error) throw error;
        contato = achado;
        if (!contato) {
          const { data: novo, error: e2 } = await db.from("contatos").insert({ partner_id: partnerId, telefone, nome: texto(corpo.nome).slice(0, 80) || null }).select("id, nome, telefone").single();
          if (e2) throw e2;
          contato = novo;
        }
      } else if (texto(corpo.nome)) {
        // Só o nome: procura na empresa. Sem contato a venda não aparece no cartão e a IA a proporia de novo (C17 compara pelo contato).
        const nome = texto(corpo.nome).slice(0, 80);
        const { data: achados, error } = await db.from("contatos").select("id, nome, telefone").eq("partner_id", partnerId).ilike("nome", nome.replace(/[%\\]/g, "")).limit(6);
        if (error) throw error;
        if ((achados || []).length === 0) return res.status(404).json({ erro: "contato_nao_encontrado" });
        if ((achados || []).length > 1) return res.status(409).json({ erro: "nome_ambiguo", candidatos: (achados || []).map((c: any) => ({ id: c.id, nome: c.nome })) });
        contato = achados![0];
      }

      const { data, error } = await db
        .from("vendas")
        .insert({
          partner_id: partnerId,
          contato_id: contato?.id ?? null,
          dia,
          valor: arredondar(valor),
          forma: corpo.forma,
          produto,
          status: "confirmada",
          fonte: "manual",
          confirmada_por: req.auth!.profileId,
          confirmada_em: ctx.agora().toISOString(),
        })
        .select("*")
        .single();
      if (error) throw error;
      return res.status(201).json(vendaParaTela(data, contato));
    }),
  );

  app.post(
    "/api/vendas/:id/decidir",
    assincrono(async (req, res) => {
      const db = ctx.db();
      const venda = await linhaDoMeuParceiro(db, "vendas", req, res, "id, partner_id", true);
      if (!venda) return;
      const { acao, valor, motivo } = req.body ?? {};
      if (acao !== "confirmar" && acao !== "rejeitar") return res.status(400).json({ erro: "acao deve ser confirmar ou rejeitar" });
      const novoValor = acao === "confirmar" ? numeroOuNulo(valor, 10_000_000) : null;
      if (novoValor === "invalido") return res.status(400).json({ erro: "valor inválido" });
      const { data, error } = await db.rpc("ia_decidir_venda", {
        _venda_id: venda.id,
        _acao: acao,
        _valor: novoValor,
        _motivo: texto(motivo).slice(0, 200) || null,
        _profile_id: req.auth!.profileId,
      });
      if (error) {
        const m = String(error.message ?? "");
        if (/ja decidida/.test(m)) return res.status(409).json({ erro: "venda_ja_decidida" });
        if (/informe o valor/.test(m)) return res.status(422).json({ erro: "informe_o_valor" });
        throw error;
      }
      return res.json(data);
    }),
  );

  // ---------------------------------------------------------------- produtos
  const lerProduto = (corpo: any, parcial: boolean) => {
    const dados: Record<string, unknown> = {};
    if (!parcial || corpo.nome !== undefined) {
      const nome = texto(corpo.nome);
      if (nome.length < 1 || nome.length > 80) return { erro: "nome deve ter de 1 a 80 caracteres" };
      dados.nome = nome;
    }
    for (const campo of ["preco", "preco_minimo"] as const) {
      if (corpo[campo] === undefined) continue;
      const n = numeroOuNulo(corpo[campo], 10_000_000);
      if (n === "invalido") return { erro: `${campo} inválido` };
      dados[campo] = n;
    }
    if (corpo.descricao_curta !== undefined) {
      const d = texto(corpo.descricao_curta);
      if (d.length > 200) return { erro: "descricao_curta passa de 200 caracteres" };
      dados.descricao_curta = d || null;
    }
    if (corpo.ativo !== undefined) dados.ativo = corpo.ativo === true;
    return { dados };
  };

  app.get(
    "/api/produtos",
    exigirCrm,
    assincrono(async (req, res) => {
      const { data, error } = await ctx.db().from("produtos").select("id, nome, preco, preco_minimo, descricao_curta, ativo").eq("partner_id", partnerDoPedido(req)).order("ordem", { ascending: true }).order("nome", { ascending: true });
      if (error) throw error;
      return res.json(data || []);
    }),
  );
  app.post(
    "/api/produtos",
    exigirCrm,
    assincrono(async (req, res) => {
      const r = lerProduto(req.body ?? {}, false);
      if (r.erro) return res.status(400).json({ erro: r.erro });
      const { data, error } = await ctx.db().from("produtos").insert({ partner_id: partnerDoPedido(req), ...r.dados }).select("id, nome, preco, preco_minimo, descricao_curta, ativo").single();
      if (error) throw error;
      return res.status(201).json(data);
    }),
  );
  app.patch(
    "/api/produtos/:id",
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!(await linhaDoMeuParceiro(db, "produtos", req, res, "id, partner_id"))) return;
      const r = lerProduto(req.body ?? {}, true);
      if (r.erro) return res.status(400).json({ erro: r.erro });
      const { data, error } = await db.from("produtos").update({ ...r.dados, updated_at: ctx.agora().toISOString() }).eq("id", req.params.id).select("id, nome, preco, preco_minimo, descricao_curta, ativo").single();
      if (error) throw error;
      return res.json(data);
    }),
  );
  app.delete(
    "/api/produtos/:id",
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!(await linhaDoMeuParceiro(db, "produtos", req, res, "id, partner_id"))) return;
      // A venda guarda o nome do produto e perde só o vínculo (ON DELETE SET NULL): o histórico fica inteiro.
      const { error } = await db.from("produtos").delete().eq("id", req.params.id);
      if (error) throw error;
      return res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------ rastreamento
  const COLUNAS_RASTREIO = "id, nome_campanha, mensagem_inicial, modo, ativo";
  const lerRastreio = (corpo: any, parcial: boolean) => {
    const dados: Record<string, unknown> = {};
    if (!parcial || corpo.nome_campanha !== undefined) {
      const nome = texto(corpo.nome_campanha);
      if (nome.length < 2 || nome.length > 60) return { erro: "nome_campanha deve ter de 2 a 60 caracteres" };
      dados.nome_campanha = nome;
    }
    if (!parcial || corpo.mensagem_inicial !== undefined) {
      const m = texto(corpo.mensagem_inicial);
      if (m.length < 3 || m.length > 500) return { erro: "mensagem_inicial deve ter de 3 a 500 caracteres" };
      dados.mensagem_inicial = m;
    }
    // Sem regex (V2): só texto igual ou que contém.
    if (!parcial || corpo.modo !== undefined) {
      if (corpo.modo !== "exata" && corpo.modo !== "contem") return { erro: "modo deve ser exata ou contem" };
      dados.modo = corpo.modo;
    }
    if (corpo.ativo !== undefined) dados.ativo = corpo.ativo === true;
    return { dados };
  };

  app.get(
    "/api/rastreamento",
    exigirCrm,
    assincrono(async (req, res) => {
      const { data, error } = await ctx.db().from("rastreamento_config").select(COLUNAS_RASTREIO).eq("partner_id", partnerDoPedido(req)).eq("tipo", "mensagem_inicial").order("created_at", { ascending: true });
      if (error) throw error;
      return res.json(data || []);
    }),
  );
  app.post(
    "/api/rastreamento",
    exigirCrm,
    assincrono(async (req, res) => {
      const r = lerRastreio(req.body ?? {}, false);
      if (r.erro) return res.status(400).json({ erro: r.erro });
      const { data, error } = await ctx.db().from("rastreamento_config").insert({ partner_id: partnerDoPedido(req), tipo: "mensagem_inicial", ...r.dados }).select(COLUNAS_RASTREIO).single();
      if (error) throw error;
      return res.status(201).json(data);
    }),
  );
  app.patch(
    "/api/rastreamento/:id",
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!(await linhaDoMeuParceiro(db, "rastreamento_config", req, res, "id, partner_id"))) return;
      const r = lerRastreio(req.body ?? {}, true);
      if (r.erro) return res.status(400).json({ erro: r.erro });
      const { data, error } = await db.from("rastreamento_config").update({ ...r.dados, updated_at: ctx.agora().toISOString() }).eq("id", req.params.id).select(COLUNAS_RASTREIO).single();
      if (error) throw error;
      return res.json(data);
    }),
  );
  app.delete(
    "/api/rastreamento/:id",
    assincrono(async (req, res) => {
      const db = ctx.db();
      if (!(await linhaDoMeuParceiro(db, "rastreamento_config", req, res, "id, partner_id"))) return;
      const { error } = await db.from("rastreamento_config").delete().eq("id", req.params.id);
      if (error) throw error;
      return res.json({ ok: true });
    }),
  );

  // ------------------------------------------------------------------- metas
  // A meta vale a partir de hoje (vigente_desde); meta 0 quer dizer "sem meta" (o SQL ignora).
  const metasVigentes = async (db: Db, partnerId: string) => {
    const { data, error } = await db.from("metas_diarias").select("tipo, meta, vigente_desde").eq("partner_id", partnerId).order("vigente_desde", { ascending: false });
    if (error) throw error;
    const vistos = new Map<string, number>();
    for (const m of (data || []) as any[]) if (!vistos.has(m.tipo)) vistos.set(m.tipo, Number(m.meta));
    return TIPOS_META.filter((t) => (vistos.get(t) ?? 0) > 0).map((tipo) => ({ tipo, meta: vistos.get(tipo)! }));
  };

  app.get(
    "/api/metas",
    exigirCrm,
    assincrono(async (req, res) => res.json(await metasVigentes(ctx.db(), partnerDoPedido(req)))),
  );
  app.put(
    "/api/metas",
    exigirCrm,
    assincrono(async (req, res) => {
      const partnerId = partnerDoPedido(req);
      const lista = req.body?.metas;
      if (!Array.isArray(lista) || lista.length > TIPOS_META.length) return res.status(400).json({ erro: "metas deve ser uma lista" });
      const novas = new Map<string, number>();
      for (const m of lista) {
        const n = numeroOuNulo(m?.meta, 1_000_000_000);
        if (!TIPOS_META.includes(m?.tipo) || n === "invalido" || n === null) return res.status(400).json({ erro: `meta inválida (${m?.tipo ?? "?"})` });
        novas.set(m.tipo, n);
      }
      const db = ctx.db();
      const atuais = await metasVigentes(db, partnerId);
      for (const a of atuais) if (!novas.has(a.tipo)) novas.set(a.tipo, 0);
      const hoje = hojeNoFuso(ctx.agora(), await fusoDaEmpresa(db, partnerId));
      const linhas = [...novas].map(([tipo, meta]) => ({ partner_id: partnerId, tipo, meta, vigente_desde: hoje, criado_por: req.auth!.profileId }));
      if (linhas.length) {
        const { error } = await db.from("metas_diarias").upsert(linhas, { onConflict: "partner_id,tipo,vigente_desde" });
        if (error) throw error;
      }
      return res.json(await metasVigentes(db, partnerId));
    }),
  );
}
