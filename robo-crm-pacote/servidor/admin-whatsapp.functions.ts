import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-client-middleware";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Números de WhatsApp DA PLATAFORMA (escopo `admin`, uso `plataforma`).
 *
 * É desses números que sai a confirmação de conta por WhatsApp — a função
 * `bot_escolher_conexao('admin', null, 'plataforma')` só enxerga linhas com
 * esse par. Sem nenhuma conectada, o cadastro cai para o e-mail.
 */

async function exigirAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: me } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!me || (me as { role?: string }).role !== "admin") {
    throw new Error("Apenas administradores podem gerenciar os números da plataforma.");
  }
  return supabaseAdmin;
}

export interface PlatformNumber {
  id: string;
  nome: string;
  numero: string | null;
  status: string;
  status_detalhe: string | null;
  prioridade: number;
  limite_diario: number | null;
  enviadas_hoje: number | null;
  visto_em: string | null;
  conectado_em: string | null;
  arquivado_em: string | null;
  webhook_segredo: string | null;
}

const COLUNAS =
  "id, nome, numero, status, status_detalhe, prioridade, limite_diario, enviadas_hoje, visto_em, conectado_em, arquivado_em, webhook_segredo";

export const listPlatformNumbers = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await exigirAdmin(context.userId);
    const { data } = await db
      .from("bot_conexoes")
      .select(COLUNAS)
      .eq("escopo", "admin")
      .eq("uso", "plataforma")
      .order("prioridade", { ascending: true })
      .order("created_at", { ascending: true });
    return { numeros: (data as unknown as PlatformNumber[]) || [] };
  });

export const createPlatformNumber = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        nome: z.string().min(2).max(60),
        numero: z.string().trim().max(20).optional(),
        prioridade: z.number().int().min(1).max(999).default(100),
        limiteDiario: z.number().int().min(1).max(10000).default(500),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = await exigirAdmin(context.userId);
    const { data: row, error } = await db
      .from("bot_conexoes")
      .insert({
        escopo: "admin",
        owner_id: null,
        uso: "plataforma",
        nome: data.nome.trim(),
        numero: data.numero?.replace(/\D/g, "") || null,
        provedor: "nao_oficial",
        prioridade: data.prioridade,
        limite_diario: data.limiteDiario,
      } as never)
      .select(COLUNAS)
      .single();
    if (error) throw new Error(error.message);
    return { numero: row as unknown as PlatformNumber };
  });

export const updatePlatformNumber = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        nome: z.string().min(2).max(60).optional(),
        numero: z.string().trim().max(20).nullable().optional(),
        prioridade: z.number().int().min(1).max(999).optional(),
        limiteDiario: z.number().int().min(1).max(10000).optional(),
        arquivado: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = await exigirAdmin(context.userId);
    const patch: Record<string, unknown> = {};
    if (data.nome !== undefined) patch["nome"] = data.nome.trim();
    if (data.numero !== undefined) patch["numero"] = data.numero ? data.numero.replace(/\D/g, "") : null;
    if (data.prioridade !== undefined) patch["prioridade"] = data.prioridade;
    if (data.limiteDiario !== undefined) patch["limite_diario"] = data.limiteDiario;
    if (data.arquivado !== undefined) patch["arquivado_em"] = data.arquivado ? new Date().toISOString() : null;
    const { error } = await db
      .from("bot_conexoes")
      .update(patch as never)
      .eq("id", data.id)
      .eq("escopo", "admin")
      .eq("uso", "plataforma");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Marca manualmente como conectado/desconectado. Útil quando o aplicativo
 * pareado já está de pé mas ainda não mandou o primeiro evento.
 */
export const setPlatformNumberStatus = createServerFn({ method: "POST" })
  .middleware([attachSupabaseAuth, requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(["conectado", "desconectado", "aguardando_qr"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const db = await exigirAdmin(context.userId);
    const agora = new Date().toISOString();
    const { error } = await db
      .from("bot_conexoes")
      .update({
        status: data.status,
        conectado_em: data.status === "conectado" ? agora : null,
        visto_em: data.status === "conectado" ? agora : null,
        bloqueado_em: null,
        bloqueado_motivo: null,
      } as never)
      .eq("id", data.id)
      .eq("escopo", "admin")
      .eq("uso", "plataforma");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
