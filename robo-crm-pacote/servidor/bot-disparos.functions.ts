import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Disparos — avisar muita gente sem queimar o número.
 *
 * O envio não usa agendador. Cada mensagem nasce com uma hora própria
 * (`agendado_para`), espaçadas pelo intervalo da campanha, e o endpoint da fila
 * só entrega o que já venceu. O conector busca de tempos em tempos e vai
 * mandando no ritmo — sem rajada, que é o que bloqueia chip.
 */

type Db = { from: (t: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

/**
 * Quantos valores mandar num `.in()` por vez.
 *
 * O supabase-js põe a lista na URL do GET, e o gateway do Supabase corta em
 * ~16 KB (medido em 11/09: 380 uuids passam, 400 não). Telefone ocupa ~16
 * caracteres na URL, uuid ~39; 200 de qualquer um cabe com folga.
 */
const LOTE_DO_IN = 200;

async function contexto(userId: string, disparoId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;

  const { data: d } = await db.from("bot_disparos").select("*").eq("id", disparoId).maybeSingle();
  const disparo = d as {
    id: string; escopo: string; owner_id: string | null; nome: string; mensagem: string;
    uso: string; status: string; intervalo_segundos: number;
  } | null;
  if (!disparo) throw new Error("Campanha não encontrada");

  // confere que quem chamou pode mexer nesta campanha
  const { data: perfil } = await db.from("profiles").select("id, role").eq("user_id", userId).maybeSingle();
  const p = perfil as { id: string; role: string } | null;
  if (!p) throw new Error("Perfil não encontrado");

  if (p.role !== "admin") {
    if (disparo.escopo !== "parceiro" || !disparo.owner_id) throw new Error("Sem permissão");
    const { data: membro } = await db
      .from("partner_members").select("papel, permissoes")
      .eq("partner_id", disparo.owner_id).eq("profile_id", p.id).maybeSingle();
    const m = membro as { papel: string; permissoes: string[] | null } | null;
    const pode = m && (m.papel === "owner" || (m.permissoes ?? []).includes("robo"));
    if (!pode) throw new Error("Sem permissão para esta campanha");
  }

  return { db, disparo, profileId: p.id };
}

const soDigitos = (s: string) => (s || "").replace(/\D/g, "");

/**
 * Confere que quem chamou pode mandar mensagem por esta academia.
 *
 * Mesma regra do `contexto` das campanhas, mas ancorada no parceiro em vez da
 * campanha: aqui não existe campanha nenhuma, é uma mensagem só.
 */
async function contextoParceiro(userId: string, partnerId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;

  const { data: perfil } = await db.from("profiles").select("id, role").eq("user_id", userId).maybeSingle();
  const p = perfil as { id: string; role: string } | null;
  if (!p) throw new Error("Perfil não encontrado");

  if (p.role !== "admin") {
    const { data: membro } = await db
      .from("partner_members").select("papel, permissoes")
      .eq("partner_id", partnerId).eq("profile_id", p.id).maybeSingle();
    const m = membro as { papel: string; permissoes: string[] | null } | null;
    const pode = m && (m.papel === "owner" || (m.permissoes ?? []).includes("robo"));
    if (!pode) throw new Error("Sem permissão para mandar mensagem por esta academia");
  }

  return { db, profileId: p.id };
}

/**
 * O quadro pertence a este dono?
 *
 * Ids de quadro e de cartão chegam do navegador e são lidos com a service role.
 * Sem esta conferência, quem monta campanha numa academia puxava nome e
 * telefone dos leads do funil de outra só trocando o id — e a lista de alvos,
 * com esses dados, aparece no painel de quem puxou.
 */
async function quadroEhDoDono(db: Db, quadroId: string, escopo: string, ownerId: string | null) {
  const { data } = await db.from("crm_quadros").select("escopo, owner_id").eq("id", quadroId).maybeSingle();
  const quadro = data as { escopo: string; owner_id: string | null } | null;
  return !!quadro && quadro.escopo === escopo && quadro.owner_id === ownerId;
}

async function cartaoEhDoParceiro(db: Db, cartaoId: string, partnerId: string) {
  const { data } = await db.from("crm_cartoes").select("quadro_id").eq("id", cartaoId).maybeSingle();
  const quadroId = (data as { quadro_id: string } | null)?.quadro_id;
  return !!quadroId && quadroEhDoDono(db, quadroId, "parceiro", partnerId);
}

/**
 * Uma mensagem para uma pessoa só, direto do cartão do CRM.
 *
 * Existe para tirar o `wa.me` do caminho. Abrir o WhatsApp Web para responder
 * um lead que já está na tela significa sair do sistema, procurar a conversa
 * de novo, e voltar — e o que foi dito ali não fica registrado em lugar nenhum.
 * Por aqui a mensagem entra na mesma fila do resto, com o mesmo "digitando", e
 * a conversa fica ligada ao cartão.
 *
 * NÃO passa por `bot_escolher_conexao` de propósito. Aquela função recusa o
 * número quando o limite diário do chip acabou — regra certa para campanha,
 * errada aqui: depois de um disparo grande a recepção ficaria impedida de
 * responder um cliente que acabou de escrever. Limite existe para rajada, não
 * para conversa.
 */
export const enviarMensagemDireta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      partnerId: z.string().uuid(),
      telefone: z.string().min(8),
      nome: z.string().optional(),
      cartaoId: z.string().uuid().optional(),
      texto: z.string().trim().min(1).max(4000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { db } = await contextoParceiro(context.userId, data.partnerId);
    // O cartão vira o dono do histórico desta conversa (bot_registrar_no_cartao):
    // cartão de outra academia receberia as mensagens desta.
    if (data.cartaoId && !(await cartaoEhDoParceiro(db, data.cartaoId, data.partnerId))) {
      throw new Error("Este cartão não é desta academia.");
    }

    const telefone = soDigitos(data.telefone);
    if (telefone.length < 10) throw new Error("Telefone incompleto — falta o DDD.");

    const { data: cx } = await db
      .from("bot_conexoes")
      .select("id, status")
      .eq("escopo", "parceiro").eq("owner_id", data.partnerId)
      .is("arquivado_em", null).is("bloqueado_em", null)
      .eq("status", "conectado")
      .order("prioridade")
      .limit(1).maybeSingle();

    const conexao = cx as { id: string } | null;
    if (!conexao) {
      throw new Error("O WhatsApp da academia não está conectado. Abra o conector no computador da recepção.");
    }

    // Reaproveita a conversa que já existe com este número: duas conversas para
    // a mesma pessoa dividem o histórico em dois e ninguém acha nada depois.
    const { data: existente } = await db
      .from("bot_conversas")
      .select("id")
      .eq("conexao_id", conexao.id).eq("telefone", telefone)
      .maybeSingle();

    let conversaId = (existente as { id: string } | null)?.id ?? null;

    if (!conversaId) {
      const { data: nova, error } = await db.from("bot_conversas").insert({
        conexao_id: conexao.id,
        telefone,
        nome: data.nome?.trim() || null,
        cartao_id: data.cartaoId ?? null,
        // Quem escreveu foi gente, então o robô não entra por cima.
        estado: "humano",
      }).select("id").single();
      if (error) throw new Error(error.message);
      conversaId = (nova as { id: string }).id;
    } else {
      await db.from("bot_conversas")
        .update({ estado: "humano", ...(data.cartaoId ? { cartao_id: data.cartaoId } : {}) })
        .eq("id", conversaId);
    }

    const { error: erroMsg } = await db.from("bot_mensagens").insert({
      conversa_id: conversaId,
      direcao: "saida",
      tipo: "texto",
      corpo: data.texto.trim(),
      status: "pendente",
    });
    if (erroMsg) throw new Error(erroMsg.message);

    return { ok: true, conversaId };
  });

/** Puxa os telefones do funil do CRM para dentro da campanha. */
export const alvosDoFunil = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      disparoId: z.string().uuid(),
      quadroId: z.string().uuid(),
      colunaId: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { db, disparo } = await contexto(context.userId, data.disparoId);
    if (disparo.status !== "rascunho") throw new Error("A campanha já foi disparada");
    if (!(await quadroEhDoDono(db, data.quadroId, disparo.escopo, disparo.owner_id))) {
      throw new Error("Este funil não é da mesma academia da campanha.");
    }

    let q = db.from("crm_cartoes")
      .select("id, titulo, contato_nome, contato_telefone")
      .eq("quadro_id", data.quadroId)
      .is("arquivado_em", null)
      .not("contato_telefone", "is", null);
    if (data.colunaId) q = q.eq("coluna_id", data.colunaId);

    const { data: cartoes, error } = await q;
    if (error) throw new Error(error.message);

    const linhas = ((cartoes ?? []) as Array<{ id: string; titulo: string; contato_nome: string | null; contato_telefone: string | null }>)
      .map((c) => ({
        disparo_id: data.disparoId,
        telefone: soDigitos(c.contato_telefone ?? ""),
        nome: c.contato_nome || c.titulo,
        cartao_id: c.id,
      }))
      .filter((l) => l.telefone.length >= 10);

    if (!linhas.length) return { adicionados: 0, repetidos: 0 };

    // o índice único (disparo_id, telefone) impede repetido; ignora em silêncio
    const { data: inseridos } = await db
      .from("bot_disparo_alvos").upsert(linhas, { onConflict: "disparo_id,telefone", ignoreDuplicates: true })
      .select("id");
    const adicionados = (inseridos ?? []).length;
    return { adicionados, repetidos: linhas.length - adicionados };
  });

/**
 * Puxa gente da academia: quem está em dia, quem parou, ou todo mundo.
 *
 * É a terceira fonte de alvos, ao lado do funil do CRM e da lista colada. Ela
 * existe porque aluno de academia não é usuário da plataforma nem cartão de
 * funil — o telefone dele mora na credencial do leitor. Quem decide quem entra
 * é `academia_publico`, no banco, para não haver duas versões dessa regra.
 */
export const alvosDaAcademia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      disparoId: z.string().uuid(),
      publico: z.enum(["ativos", "inativos", "todos"]),
      // só para "inativos": faixa de quantos dias sem acesso
      diasMin: z.number().int().min(0).max(3650).default(0),
      diasMax: z.number().int().min(1).max(3650).default(365),
      // teto por leva: mandar para 400 pessoas de uma vez queima o chip
      limite: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { db, disparo } = await contexto(context.userId, data.disparoId);
    if (disparo.status !== "rascunho") throw new Error("A campanha já foi disparada");
    if (disparo.escopo !== "parceiro" || !disparo.owner_id) {
      throw new Error("Só campanha de parceiro puxa gente da academia");
    }

    const { data: pessoas, error } = await db.rpc("academia_publico", {
      p_partner_id: disparo.owner_id,
      p_publico: data.publico,
      p_dias_min: data.diasMin,
      p_dias_max: data.diasMax,
      p_limite: data.limite,
    });
    if (error) throw new Error(error.message);

    const linhas = ((pessoas ?? []) as Array<{ nome: string | null; telefone: string | null }>)
      .map((p) => ({
        disparo_id: data.disparoId,
        telefone: soDigitos(p.telefone ?? ""),
        nome: p.nome,
      }))
      .filter((l) => l.telefone.length >= 10);

    if (!linhas.length) return { adicionados: 0, repetidos: 0 };

    const { data: inseridos } = await db
      .from("bot_disparo_alvos").upsert(linhas, { onConflict: "disparo_id,telefone", ignoreDuplicates: true })
      .select("id");
    const adicionados = (inseridos ?? []).length;
    return { adicionados, repetidos: linhas.length - adicionados };
  });

/** Quantas pessoas cada público alcançaria, para olhar antes de montar. */
export const previaDaAcademia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ partnerId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    // Sem isto, qualquer pessoa logada via quantos alunos ativos e parados
    // qualquer academia tem. Não há tela chamando hoje, mas a rota existe.
    const { db } = await contextoParceiro(context.userId, data.partnerId);
    const { data: faixas, error } = await db.rpc("academia_reativacao_previa", {
      p_partner_id: data.partnerId,
    });
    if (error) throw new Error(error.message);
    return { faixas: (faixas ?? []) as Array<{ faixa: string; pessoas: number; com_telefone: number }> };
  });

/** Adiciona telefones colados na mão. */
export const alvosColados = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ disparoId: z.string().uuid(), texto: z.string().max(50000) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { db, disparo } = await contexto(context.userId, data.disparoId);
    if (disparo.status !== "rascunho") throw new Error("A campanha já foi disparada");

    const linhas = data.texto
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((linha) => {
        const partes = linha.split(/[;\t,]/).map((p) => p.trim());
        const tel = soDigitos(partes.find((p) => soDigitos(p).length >= 10) ?? "");
        const nome = partes.find((p) => p && soDigitos(p).length < 10) ?? null;
        return { disparo_id: data.disparoId, telefone: tel, nome };
      })
      .filter((l) => l.telefone.length >= 10);

    if (!linhas.length) return { adicionados: 0, repetidos: 0 };

    const { data: inseridos } = await db
      .from("bot_disparo_alvos").upsert(linhas, { onConflict: "disparo_id,telefone", ignoreDuplicates: true })
      .select("id");
    const adicionados = (inseridos ?? []).length;
    return { adicionados, repetidos: linhas.length - adicionados };
  });

/** Quantos alvos, e em que estado. */
export const resumoDisparo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ disparoId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db } = await contexto(context.userId, data.disparoId);
    const { data: alvos } = await db
      .from("bot_disparo_alvos").select("status").eq("disparo_id", data.disparoId);
    const lista = (alvos ?? []) as Array<{ status: string }>;
    const conta = (s: string) => lista.filter((a) => a.status === s).length;
    return {
      total: lista.length,
      pendente: conta("pendente"),
      enfileirado: conta("enfileirado"),
      enviado: conta("enviado"),
      erro: conta("erro"),
      ignorado: conta("ignorado"),
    };
  });

/**
 * Dispara a campanha.
 *
 * Cuidados embutidos, todos com motivo:
 *   - escolhe o número saudável pela rotação (não manda por chip bloqueado)
 *   - respeita o limite diário do chip: o que passar fica para amanhã
 *   - espaça as mensagens pelo intervalo da campanha
 *   - reaproveita a conversa se a pessoa já falou com a academia antes
 *   - não deixa disparar duas vezes a mesma campanha
 */
type Disparo = {
  id: string; escopo: string; owner_id: string | null; nome: string;
  mensagem: string; uso: string; status: string; intervalo_segundos: number;
  /** A maquina montou esta campanha. So essas conferem pagamento e marcam aviso. */
  automatico?: boolean;
};

/**
 * O disparo em si, sem nada sobre quem mandou disparar.
 *
 * Separado do `createServerFn` porque agora existem DOIS chamadores: a pessoa
 * apertando o botão e o gancho horário que solta os avisos sozinho. Se cada um
 * tivesse a sua cópia, uma proteção corrigida num lado continuaria faltando no
 * outro — e o lado sem a proteção é justamente o que roda sem ninguém olhando.
 */
export async function executarDisparo(db: Db, disparo: Disparo) {
  // 1. qual número está de plantão
    const { data: conexaoId } = await db.rpc("bot_escolher_conexao", {
      _escopo: disparo.escopo,
      _owner_id: disparo.owner_id,
      _uso: disparo.uso,
    });
    if (!conexaoId) {
      throw new Error(
        "Nenhum número disponível: precisa estar conectado, sem bloqueio e dentro do limite diário.",
      );
    }

    const { data: cx } = await db
      .from("bot_conexoes").select("id, limite_diario, enviadas_hoje, contador_dia")
      .eq("id", conexaoId).maybeSingle();
    const conexao = cx as {
      id: string; limite_diario: number | null; enviadas_hoje: number; contador_dia: string | null;
    };

    /*
     * 2. quanto ainda cabe hoje neste chip
     *
     * "Hoje" sai do banco, pelo fuso da academia — nunca de `new Date()` aqui.
     * Com a data em UTC, às 21h de Cuiabá esta conta já estaria no dia seguinte
     * enquanto `contador_dia` ainda marcava o dia de hoje: os envios da noite
     * pareceriam zero e a campanha soltaria o limite inteiro de novo, no mesmo
     * dia, no horário em que o WhatsApp mais repara. Quem conta o envio e quem
     * decide se cabe precisam concordar sobre que dia é.
     */
    const { data: hojeDaAcademia } = await db.rpc("bot_dia_da_conexao", { _conexao_id: conexao.id });
    const hoje = String(hojeDaAcademia ?? "").slice(0, 10);
    const usadasHoje = conexao.contador_dia === hoje ? conexao.enviadas_hoje : 0;
    const cabeHoje = conexao.limite_diario == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, conexao.limite_diario - usadasHoje);
    if (cabeHoje === 0) {
      throw new Error("Este número já bateu o limite de hoje. Tente amanhã ou conecte outro.");
    }

    // 3. alvos pendentes
    const { data: alvosData } = await db
      .from("bot_disparo_alvos").select("id, telefone, nome")
      .eq("disparo_id", disparo.id).eq("status", "pendente");
    let alvos = (alvosData ?? []) as Array<{ id: string; telefone: string; nome: string | null }>;
    if (!alvos.length) throw new Error("Nenhum contato na campanha. Adicione antes de disparar.");

    /*
     * Aviso de vencimento: quem pagou entre a montagem e agora sai da lista.
     *
     * A campanha é montada às 8h e sai às 9h. Nessa hora cabe uma renovação no
     * balcão — e "seu plano expira hoje" chegando para quem acabou de pagar não
     * é um detalhe de texto: é o cliente deixando de acreditar no que o sistema
     * diz. Quem já pagou é dispensado, não some: fica registrado por quê.
     */
    if (disparo.automatico) {
      const { data: devidosData } = await db.rpc("academia_avisos_devidos", {
        p_disparo_id: disparo.id,
      });
      const devidos = new Set(
        ((devidosData ?? []) as Array<{ telefone: string }>).map((d) => d.telefone),
      );
      const jaPagaram = alvos.filter((a) => !devidos.has(a.telefone));
      if (jaPagaram.length) {
        // 'ignorado' e nao um status novo: bot_disparo_alvos_status_check so
        // aceita pendente/enfileirado/enviado/erro/ignorado. O motivo fica no
        // campo `erro`, que e onde a tela ja procura.
        const { error } = await db.from("bot_disparo_alvos")
          .update({ status: "ignorado", erro: "renovou antes do envio" })
          .in("id", jaPagaram.map((a) => a.id));
        if (error) throw new Error(`nao consegui dispensar quem ja pagou: ${error.message}`);
        alvos = alvos.filter((a) => devidos.has(a.telefone));
      }
      if (!alvos.length) {
        await db.from("bot_disparos")
          .update({ status: "concluido", concluido_em: new Date().toISOString() })
          .eq("id", disparo.id);
        return {
          enfileirados: 0, falhas: 0, ficamParaDepois: 0,
          minutosEstimados: 0, conexaoId: conexao.id, dispensados: jaPagaram.length,
        };
      }
    }

    const vaoAgora = alvos.slice(0, cabeHoje === Number.POSITIVE_INFINITY ? alvos.length : cabeHoje);
    const ficamParaDepois = alvos.length - vaoAgora.length;

    await db.from("bot_disparos")
      .update({ status: "enfileirando", iniciado_em: new Date().toISOString() })
      .eq("id", disparo.id);

    // 4. conversas que já existem neste número, para não duplicar. Em lotes:
    // sem limite diário no chip, os alvos do dia passam de mil telefones, e a
    // lista inteira num `.in()` não cabe na URL.
    const telefones = vaoAgora.map((a) => a.telefone);
    const porTelefone = new Map<string, string>();
    for (let i = 0; i < telefones.length; i += LOTE_DO_IN) {
      const { data: existentes } = await db
        .from("bot_conversas").select("id, telefone")
        .eq("conexao_id", conexao.id).in("telefone", telefones.slice(i, i + LOTE_DO_IN));
      for (const c of (existentes ?? []) as Array<{ id: string; telefone: string }>) {
        porTelefone.set(c.telefone, c.id);
      }
    }

    const intervalo = Math.max(5, disparo.intervalo_segundos) * 1000;

    /*
     * Começa depois do que JÁ está agendado neste número, não "daqui a 5s".
     *
     * O espaçamento de 20s protege o chip dentro de uma campanha, mas não
     * dizia nada entre campanhas. Duas disparadas no mesmo minuto — o gancho
     * automático solta "Vence hoje" e "Faltam 3 dias" em sequência, ou duas
     * pessoas apertam o botão juntas — agendavam a primeira mensagem de cada
     * uma no MESMO instante. Para o WhatsApp isso é rajada, que é exatamente o
     * que o intervalo existe para evitar.
     *
     * Olhando a fila do número, a segunda campanha entra na fila da primeira.
     */
    const { data: ultima } = await db
      .from("bot_mensagens")
      .select("agendado_para, conversa_id, bot_conversas!inner(conexao_id)")
      .eq("bot_conversas.conexao_id", conexao.id)
      .eq("status", "pendente")
      .order("agendado_para", { ascending: false })
      .limit(1)
      .maybeSingle();

    const fimDaFila = (ultima as { agendado_para: string | null } | null)?.agendado_para;
    const inicio = Math.max(
      Date.now() + 5000, // 5s de folga para o conector buscar
      fimDaFila ? new Date(fimDaFila).getTime() + intervalo : 0,
    );
    let enfileirados = 0;
    // Quem realmente entrou na fila — e so esses viram "avisado" no fim.
    const enviados: string[] = [];
    let falhas = 0;

    for (let i = 0; i < vaoAgora.length; i++) {
      const alvo = vaoAgora[i];
      try {
        let conversaId = porTelefone.get(alvo.telefone);
        if (!conversaId) {
          const { data: nova, error } = await db
            .from("bot_conversas")
            .insert({
              conexao_id: conexao.id,
              telefone: alvo.telefone,
              nome: alvo.nome,
              // campanha não é atendimento: deixa fora do fluxo do robô
              estado: "humano",
            })
            .select("id").single();
          if (error) throw new Error(error.message);
          conversaId = (nova as { id: string }).id;
        }

        // {nome} vira o primeiro nome da pessoa
        const primeiro = (alvo.nome ?? "").trim().split(/\s+/)[0] ?? "";
        const texto = disparo.mensagem.replace(/\{nome\}/gi, primeiro);

        const { data: msg, error: erroMsg } = await db.from("bot_mensagens").insert({
          conversa_id: conversaId,
          direcao: "saida",
          tipo: "texto",
          corpo: texto,
          status: "pendente",
          disparo_id: disparo.id,
          agendado_para: new Date(inicio + i * intervalo).toISOString(),
        }).select("id").single();
        if (erroMsg) throw new Error(erroMsg.message);

        await db.from("bot_disparo_alvos")
          .update({ status: "enfileirado", mensagem_id: (msg as { id: string }).id, erro: null })
          .eq("id", alvo.id);
        enfileirados++;
        enviados.push(alvo.telefone);

        /*
         * Conta ESTE envio agora, não todos no fim.
         *
         * A contagem ficava depois do laço inteiro. Uma queda no meio deixava
         * cinquenta mensagens na fila e o contador do chip em zero — e a
         * próxima campanha achava que o dia estava inteiro disponível. O limite
         * diário existe justamente para o WhatsApp não bloquear o número, e ele
         * não seria respeitado exatamente no dia em que algo deu errado.
         */
        await db.rpc("bot_contar_envio", { _conexao_id: conexao.id });
      } catch (e) {
        falhas++;
        await db.from("bot_disparo_alvos")
          .update({ status: "erro", erro: e instanceof Error ? e.message.slice(0, 300) : "falhou" })
          .eq("id", alvo.id);
      }
    }

    /*
     * Marca como avisado só agora, e só quem entrou na fila.
     *
     * A marcação ficava na MONTAGEM da campanha. Campanha que não disparava
     * deixava as pessoas registradas como avisadas sem terem recebido nada — e
     * elas só voltavam a entrar se ainda casassem com um marco ativo no dia
     * seguinte, o que com d1 e d2 desligados quase nunca acontecia.
     */
    if (disparo.automatico && enviados.length) {
      await db.rpc("academia_avisos_marcar_enviados", {
        p_disparo_id: disparo.id,
        p_telefones: enviados,
      });
    }

    await db.from("bot_disparos")
      .update({
        status: ficamParaDepois > 0 ? "enviando" : "concluido",
        concluido_em: ficamParaDepois > 0 ? null : new Date().toISOString(),
      })
      .eq("id", disparo.id);

    const minutos = Math.ceil((enfileirados * intervalo) / 60000);
  return { enfileirados, falhas, ficamParaDepois, minutosEstimados: minutos, conexaoId: conexao.id };
}

export const dispararCampanha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ disparoId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db, disparo } = await contexto(context.userId, data.disparoId);
    if (disparo.status !== "rascunho") throw new Error("Esta campanha já foi disparada");
    return executarDisparo(db, disparo as Disparo);
  });

/** Cancela uma campanha e tira da fila o que ainda não saiu. */
export const cancelarCampanha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ disparoId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { db } = await contexto(context.userId, data.disparoId);

    /*
     * Só as que ainda não foram enviadas — pelo filtro da campanha, não por uma
     * lista de ids. A lista ia num `.in()` na URL: numa campanha de 500 ela
     * passava do limite do gateway, o UPDATE falhava calado, a campanha
     * aparecia "cancelada" e as mensagens saíam do mesmo jeito.
     */
    const { data: canceladas } = await db
      .from("bot_mensagens")
      .update({ status: "erro", erro: "campanha cancelada" })
      .eq("disparo_id", data.disparoId).eq("status", "pendente")
      .select("id");
    await db.from("bot_disparo_alvos")
      .update({ status: "ignorado" }).eq("disparo_id", data.disparoId).eq("status", "enfileirado");
    await db.from("bot_disparos")
      .update({ status: "cancelado", concluido_em: new Date().toISOString() }).eq("id", data.disparoId);

    return { canceladas: (canceladas ?? []).length };
  });
