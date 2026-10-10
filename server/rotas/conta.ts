import type { Express } from "express";
import { assincrono, type Contexto } from "../contexto.js";
import { ehDonoMembro, type Autenticacao } from "../auth.js";
import type { Db } from "../supabase.js";

// Empresas que o usuário enxerga: admin vê todas, os demais só as de partner_members.
export async function partnersAcessiveis(db: Db, auth: Autenticacao, colunas = "*") {
  let consulta = db.from("partners").select(colunas).order("fantasy_name");
  if (!auth.isAdmin) {
    if (auth.partnerIds.length === 0) return [];
    consulta = consulta.in("id", auth.partnerIds);
  }
  const { data, error } = await consulta;
  if (error) throw error;
  return (data || []) as unknown as Record<string, any>[];
}

export function registrarRotasConta(app: Express, ctx: Contexto) {
  app.get(
    "/api/me",
    assincrono(async (req, res) => {
      const auth = req.auth!;
      const partners = await partnersAcessiveis(ctx.db(), auth, "id, fantasy_name");
      const { id, name, email, phone, role, status, expira_em } = auth.perfil;
      return res.json({
        profile: { id, name, email, phone, role, status, expira_em },
        isAdmin: auth.isAdmin,
        partners: partners.map((p) => ({ id: p.id, nome: p.fantasy_name })),
        // Empresas em que a conta é dona de verdade (papel owner; o admin não conta): quem vê a chave de privacidade e o botão de apagar dados (LGPD).
        donoDe: partners.filter((p) => ehDonoMembro(auth, p.id)).map((p) => p.id),
      });
    }),
  );
}
