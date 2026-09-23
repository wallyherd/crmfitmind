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
  return { supabaseAdmin, profileId: profile.id };
}

/** Um funil ou quadro pertencente a alguém. */
export type CrmQuadro = {
  id: string;
  nome: string;
  tipo: "funil" | "quadro";
  arquivadoEm: string | null;
  cartoes: number;
};

export type CrmTarget = {
  id: string;
  nome: string;
  subtitulo: string | null;
  escopo: "parceiro" | "profissional";
  quadros: CrmQuadro[];
};

export const listCrmTargets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);

    const [parceirosRes, profissionaisRes, quadrosRes, cartoesRes] = await Promise.all([
      supabaseAdmin
        .from("partners")
        .select("id, fantasy_name, city, state, status, business_area")
        .order("fantasy_name"),
      supabaseAdmin
        .from("coaches")
        .select(
          "id, profile_id, specialty_key, approved_at, profiles:profiles!coaches_profile_id_fkey(id, name, email, city, state)",
        )
        .eq("is_professional", true),
      supabaseAdmin
        .from("crm_quadros" as never)
        .select("id, nome, tipo, owner_id, escopo, arquivado_em"),
      supabaseAdmin.from("crm_cartoes" as never).select("quadro_id").is("arquivado_em" as never, null),
    ]);

    if (parceirosRes.error) throw new Error(parceirosRes.error.message);
    if (profissionaisRes.error) throw new Error(profissionaisRes.error.message);
    if (quadrosRes.error) throw new Error(quadrosRes.error.message);

    const quadros = (quadrosRes.data ?? []) as unknown as Array<{
      id: string;
      nome: string;
      tipo: string | null;
      owner_id: string | null;
      escopo: string;
      arquivado_em: string | null;
    }>;

    // quantos cartões cada quadro tem, para a lista mostrar volume
    const contagem = new Map<string, number>();
    for (const c of (cartoesRes.data ?? []) as unknown as Array<{ quadro_id: string }>) {
      contagem.set(c.quadro_id, (contagem.get(c.quadro_id) ?? 0) + 1);
    }

    const quadrosDe = (escopo: string, ownerId: string): CrmQuadro[] =>
      quadros
        .filter((q) => q.escopo === escopo && q.owner_id === ownerId)
        .map((q) => ({
          id: q.id,
          nome: q.nome,
          tipo: (q.tipo === "quadro" ? "quadro" : "funil") as "funil" | "quadro",
          arquivadoEm: q.arquivado_em,
          cartoes: contagem.get(q.id) ?? 0,
        }))
        .sort((a, b) => a.nome.localeCompare(b.nome));

    const parceiros: CrmTarget[] = (parceirosRes.data ?? []).map((p) => ({
      id: p.id,
      nome: p.fantasy_name ?? "Sem nome",
      subtitulo:
        [[p.city, p.state].filter(Boolean).join(" · ") || null, p.business_area, p.status]
          .filter(Boolean)
          .join(" · ") || null,
      escopo: "parceiro" as const,
      quadros: quadrosDe("parceiro", p.id),
    }));

    const profissionais: CrmTarget[] = (profissionaisRes.data ?? [])
      .map((c) => {
        const prof = (
          c as unknown as {
            profiles: { id: string; name: string | null; email: string | null; city: string | null; state: string | null } | null;
          }
        ).profiles;
        if (!prof) return null;
        return {
          id: prof.id,
          nome: prof.name || prof.email || "Profissional",
          subtitulo:
            [
              [prof.city, prof.state].filter(Boolean).join(" · ") || null,
              (c as { specialty_key: string | null }).specialty_key,
              (c as { approved_at: string | null }).approved_at ? "aprovado" : "pendente",
            ]
              .filter(Boolean)
              .join(" · ") || null,
          escopo: "profissional" as const,
          quadros: quadrosDe("profissional", prof.id),
        };
      })
      .filter(Boolean) as CrmTarget[];

    profissionais.sort((a, b) => a.nome.localeCompare(b.nome));

    return { parceiros, profissionais };
  });

/**
 * Cria um funil ou um quadro. Usa a função do banco, que cria o quadro e as
 * etapas na mesma transação — assim nunca sobra quadro sem etapa se algo falhar.
 */
export const criarQuadroCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        escopo: z.enum(["parceiro", "profissional"]),
        ownerId: z.string().uuid(),
        nome: z.string().min(1).max(120),
        tipo: z.enum(["funil", "quadro"]).default("funil"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const { data: id, error } = await supabaseAdmin.rpc("crm_criar_quadro" as never, {
      _escopo: data.escopo,
      _owner_id: data.ownerId,
      _nome: data.nome,
      _tipo: data.tipo,
    } as never);
    if (error) throw new Error(error.message);
    return { quadroId: id as unknown as string };
  });

export const alternarCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ quadroId: z.string().uuid(), ativar: z.boolean() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const arquivado_em = data.ativar ? null : new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("crm_quadros" as never)
      .update({ arquivado_em } as never)
      .eq("id" as never, data.quadroId as never);
    if (error) throw new Error(error.message);
    return { arquivadoEm: arquivado_em };
  });

export const renomearQuadroCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ quadroId: z.string().uuid(), nome: z.string().min(1).max(120) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabaseAdmin }: Admin = await getAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("crm_quadros" as never)
      .update({ nome: data.nome } as never)
      .eq("id" as never, data.quadroId as never);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Todos os funis e quadros ativos de um dono (usado pelos painéis do próprio dono).
 *
 * Lê com o cliente de quem chamou, não com a service role. O `ownerId` vem do
 * navegador: com a service role, qualquer pessoa logada listava nome e id dos
 * funis de qualquer parceiro só trocando esse id. Pela RLS de `crm_quadros`
 * (`crm_acesso_quadro`) volta apenas o que a pessoa já pode abrir — o mesmo
 * que o CrmBoard, que também lê pela RLS, conseguiria mostrar.
 */
export const meusQuadrosCrm = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ escopo: z.enum(["parceiro", "profissional"]), ownerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: linhas, error } = await context.supabase
      .from("crm_quadros" as never)
      .select("id, nome, tipo, arquivado_em")
      .eq("escopo" as never, data.escopo as never)
      .eq("owner_id" as never, data.ownerId as never)
      .is("arquivado_em" as never, null);
    if (error) throw new Error(error.message);
    const rows = (linhas ?? []) as unknown as Array<{ id: string; nome: string; tipo: string | null }>;
    return {
      quadros: rows.map((q) => ({
        id: q.id,
        nome: q.nome,
        tipo: (q.tipo === "quadro" ? "quadro" : "funil") as "funil" | "quadro",
      })),
    };
  });
