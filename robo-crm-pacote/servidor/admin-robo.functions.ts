import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Admin = Awaited<ReturnType<typeof getAdmin>>;

async function getAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile || profile.role !== "admin") throw new Error("Acesso restrito ao admin");
  return { supabaseAdmin: supabaseAdmin as unknown as { from: (t: string) => any }, profileId: profile.id };
}

export type BotConexao = {
  id: string;
  nome: string;
  numero: string | null;
  status: "desconectado" | "aguardando_qr" | "conectado" | "erro";
  statusDetalhe: string | null;
  vistoEm: string | null;
  arquivadoEm: string | null;
  conversas: number;
  naFila: number;
};

export type BotAlvo = {
  id: string;
  nome: string;
  subtitulo: string | null;
  escopo: "parceiro" | "profissional";
  conexoes: BotConexao[];
};

const STATUS = ["desconectado", "aguardando_qr", "conectado", "erro"] as const;

export const listBotAlvos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);

    const [parceirosRes, conexoesRes, conversasRes, filaRes] = await Promise.all([
      supabaseAdmin.from("partners").select("id, fantasy_name, city, state, business_area").order("fantasy_name"),
      supabaseAdmin
        .from("bot_conexoes")
        .select("id, nome, numero, status, status_detalhe, visto_em, arquivado_em, escopo, owner_id"),
      supabaseAdmin.from("bot_conversas").select("id, conexao_id"),
      supabaseAdmin.from("bot_mensagens").select("id, conversa_id").eq("status", "pendente"),
    ]);

    if (parceirosRes.error) throw new Error(parceirosRes.error.message);
    if (conexoesRes.error) throw new Error(conexoesRes.error.message);

    const conversas = (conversasRes.data ?? []) as Array<{ id: string; conexao_id: string }>;
    const porConexao = new Map<string, number>();
    const conexaoDaConversa = new Map<string, string>();
    for (const c of conversas) {
      porConexao.set(c.conexao_id, (porConexao.get(c.conexao_id) ?? 0) + 1);
      conexaoDaConversa.set(c.id, c.conexao_id);
    }

    const fila = new Map<string, number>();
    for (const m of (filaRes.data ?? []) as Array<{ conversa_id: string }>) {
      const cx = conexaoDaConversa.get(m.conversa_id);
      if (cx) fila.set(cx, (fila.get(cx) ?? 0) + 1);
    }

    const conexoes = (conexoesRes.data ?? []) as Array<{
      id: string; nome: string; numero: string | null; status: string;
      status_detalhe: string | null; visto_em: string | null; arquivado_em: string | null;
      escopo: string; owner_id: string | null;
    }>;

    const conexoesDe = (escopo: string, ownerId: string): BotConexao[] =>
      conexoes
        .filter((c) => c.escopo === escopo && c.owner_id === ownerId)
        .map((c) => ({
          id: c.id,
          nome: c.nome,
          numero: c.numero,
          status: (STATUS.includes(c.status as never) ? c.status : "erro") as BotConexao["status"],
          statusDetalhe: c.status_detalhe,
          vistoEm: c.visto_em,
          arquivadoEm: c.arquivado_em,
          conversas: porConexao.get(c.id) ?? 0,
          naFila: fila.get(c.id) ?? 0,
        }));

    const parceiros: BotAlvo[] = ((parceirosRes.data ?? []) as any[]).map((p: any) => ({
      id: p.id,
      nome: p.fantasy_name ?? "Sem nome",
      subtitulo: [[p.city, p.state].filter(Boolean).join(" · ") || null, p.business_area].filter(Boolean).join(" · ") || null,
      escopo: "parceiro" as const,
      conexoes: conexoesDe("parceiro", p.id),
    }));

    return { parceiros };
  });

/** Cria a conexão e devolve o segredo UMA vez, para colar no conector. */
export const criarBotConexao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      escopo: z.enum(["parceiro", "profissional"]),
      ownerId: z.string().uuid(),
      nome: z.string().min(1).max(120),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin, profileId }: Admin = await getAdmin(context.userId);
    const { data: nova, error } = await supabaseAdmin
      .from("bot_conexoes")
      .insert({ escopo: data.escopo, owner_id: data.ownerId, nome: data.nome, criado_por: profileId })
      .select("id, webhook_segredo")
      .single();
    if (error) throw new Error(error.message);
    const linha = nova as { id: string; webhook_segredo: string };
    return { conexaoId: linha.id, segredo: linha.webhook_segredo };
  });

/** Mostra o segredo de novo (o admin pode ter perdido). */
export const verSegredoConexao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conexaoId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const { data: c, error } = await supabaseAdmin
      .from("bot_conexoes").select("webhook_segredo").eq("id", data.conexaoId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!c) throw new Error("Conexão não encontrada");
    return { segredo: (c as { webhook_segredo: string }).webhook_segredo };
  });

export const alternarBotConexao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conexaoId: z.string().uuid(), ativar: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("bot_conexoes")
      .update({ arquivado_em: data.ativar ? null : new Date().toISOString() })
      .eq("id", data.conexaoId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Enfileira uma mensagem de teste. O conector busca e envia pelo WhatsApp.
 * É com este botão que o Erick confirma que a ponta a ponta funciona.
 */
export const enviarTesteBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      conexaoId: z.string().uuid(),
      telefone: z.string().min(8).max(20),
      corpo: z.string().min(1).max(1000),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const telefone = data.telefone.replace(/\D/g, "");

    const { data: existente } = await supabaseAdmin
      .from("bot_conversas").select("id")
      .eq("conexao_id", data.conexaoId).eq("telefone", telefone).maybeSingle();

    let conversaId = (existente as { id: string } | null)?.id;
    if (!conversaId) {
      const { data: nova, error } = await supabaseAdmin
        .from("bot_conversas")
        .insert({ conexao_id: data.conexaoId, telefone, nome: "Teste", estado: "humano" })
        .select("id").single();
      if (error) throw new Error(error.message);
      conversaId = (nova as { id: string }).id;
    }

    const { error: erroMsg } = await supabaseAdmin.from("bot_mensagens").insert({
      conversa_id: conversaId, direcao: "saida", tipo: "texto", corpo: data.corpo, status: "pendente",
    });
    if (erroMsg) throw new Error(erroMsg.message);
    return { ok: true, conversaId };
  });

/** Últimas conversas de uma conexão, para a caixa de entrada. */
export const listarConversasBot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conexaoId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const { data: convs } = await supabaseAdmin
      .from("bot_conversas")
      .select("id, telefone, nome, estado, ultima_mensagem_em")
      .eq("conexao_id", data.conexaoId)
      .order("ultima_mensagem_em", { ascending: false, nullsFirst: false })
      .limit(30);

    const lista = (convs ?? []) as Array<{
      id: string; telefone: string; nome: string | null; estado: string; ultima_mensagem_em: string | null;
    }>;
    if (!lista.length) return { conversas: [] };

    const { data: msgs } = await supabaseAdmin
      .from("bot_mensagens")
      .select("conversa_id, direcao, corpo, status, created_at")
      .in("conversa_id", lista.map((c) => c.id))
      .order("created_at", { ascending: false })
      .limit(200);

    const ultima = new Map<string, { corpo: string | null; direcao: string; status: string }>();
    for (const m of (msgs ?? []) as Array<{ conversa_id: string; direcao: string; corpo: string | null; status: string }>) {
      if (!ultima.has(m.conversa_id)) ultima.set(m.conversa_id, { corpo: m.corpo, direcao: m.direcao, status: m.status });
    }

    return {
      conversas: lista.map((c) => ({
        ...c,
        ultimaMensagem: ultima.get(c.id)?.corpo ?? null,
        ultimaDirecao: ultima.get(c.id)?.direcao ?? null,
        ultimoStatus: ultima.get(c.id)?.status ?? null,
      })),
    };
  });
