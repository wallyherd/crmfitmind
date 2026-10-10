import type { Express } from "express";
import { exigirAdmin, podeVerConteudo } from "../auth.js";
import { assincrono, ehUuid, soDigitos, texto, type Contexto } from "../contexto.js";

const PAPEIS = ["user", "admin"];
const STATUS = ["ativo", "suspenso", "expirado"];
const SENHA_MINIMA = 8;
const COLUNAS_USUARIO = "id, user_id, name, email, phone, role, status, expira_em, partner_id, created_at";

// O front antigo manda `dias`; o contrato usa `duracaoDias`. null/0 = sem vencimento.
function expiracao(corpo: Record<string, unknown>, agora: Date): string | null | undefined {
  const bruto = corpo.duracaoDias ?? corpo.dias;
  if (bruto === undefined) return undefined;
  const dias = Number(bruto);
  if (!bruto || !Number.isFinite(dias) || dias <= 0) return null;
  return new Date(agora.getTime() + Math.round(dias) * 86_400_000).toISOString();
}

function partnerDoCorpo(corpo: Record<string, unknown>): unknown {
  return corpo.partnerId !== undefined ? corpo.partnerId : corpo.partner_id;
}

type Bloqueio = { status: number; corpo: Record<string, unknown> };

export function registrarRotasAdmin(app: Express, ctx: Contexto) {
  // Dono de verdade: papel owner num perfil com login. O perfil sem login que a tela de empresa cria é só um marcador.
  async function empresaTemDono(partnerId: string): Promise<boolean> {
    const db = ctx.db();
    const { data: donos, error } = await db.from("partner_members").select("profile_id").eq("partner_id", partnerId).eq("papel", "owner");
    if (error) throw error;
    const ids = (donos || []).map((d: { profile_id: string }) => d.profile_id);
    if (ids.length === 0) return false;
    const { data: perfis, error: e2 } = await db.from("profiles").select("id").in("id", ids).not("user_id", "is", null);
    if (e2) throw e2;
    return (perfis || []).length > 0;
  }

  // Ligar um usuário a uma empresa que já tem dono dá a ele o conteúdo da empresa. Quem pode fazer isso sem aviso é
  // quem já veria o conteúdo (opt-in do dono); sem ele, o dono é quem chama o membro. Admin nunca entra como membro.
  async function podeLigarNaEmpresa(partnerId: string, perfilAdmin: boolean): Promise<Bloqueio | null> {
    if (perfilAdmin) return { status: 400, corpo: { erro: "admin_nao_entra_em_empresa" } };
    if (!(await empresaTemDono(partnerId))) return null;
    const { data, error } = await ctx.db().from("partner_acesso_config").select("mentor_pode_ver_conversas").eq("partner_id", partnerId).maybeSingle();
    if (error) throw error;
    return data?.mentor_pode_ver_conversas === true ? null : { status: 403, corpo: { erro: "dono_precisa_liberar" } };
  }

  // Primeiro usuário ligado a uma empresa sem dono vira o dono (e o marcador sem login sai); os demais entram como membro.
  async function ligarNaEmpresa(partnerId: string, profileId: string) {
    const db = ctx.db();
    const semDono = !(await empresaTemDono(partnerId));
    const { error } = await db
      .from("partner_members")
      .upsert({ partner_id: partnerId, profile_id: profileId, papel: semDono ? "owner" : "membro", permissoes: ["robo", "crm"] }, { onConflict: "partner_id,profile_id" });
    if (error) throw error;
    if (!semDono) return;
    const { data: donos } = await db.from("partner_members").select("profile_id").eq("partner_id", partnerId).eq("papel", "owner").neq("profile_id", profileId);
    const ids = (donos || []).map((d: { profile_id: string }) => d.profile_id);
    if (ids.length === 0) return;
    const { data: marcadores } = await db.from("profiles").select("id").in("id", ids).is("user_id", null);
    const sobra = (marcadores || []).map((m: { id: string }) => m.id);
    if (sobra.length) await db.from("partner_members").delete().eq("partner_id", partnerId).in("profile_id", sobra);
  }

  app.get(
    "/api/admin/usuarios",
    assincrono(async (_req, res) => {
      const { data, error } = await ctx
        .db()
        .from("profiles")
        .select(`${COLUNAS_USUARIO}, partner:partners!profiles_partner_id_fkey(id, fantasy_name)`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return res.json({ usuarios: data || [] });
    }),
  );

  // Cria no Supabase Auth; o gatilho de auth.users cria o profile, que aqui só é completado.
  app.post(
    "/api/admin/usuarios",
    assincrono(async (req, res) => {
      const db = ctx.db();
      const corpo = req.body || {};
      const name = texto(corpo.name);
      const email = texto(corpo.email).toLowerCase();
      const password = typeof corpo.password === "string" ? corpo.password : "";
      const role = corpo.role === "admin" ? "admin" : "user";
      const partnerId = partnerDoCorpo(corpo);

      if (!name || !email || !password) return res.status(400).json({ erro: "Nome, e-mail e senha são obrigatórios" });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ erro: "E-mail inválido" });
      if (password.length < SENHA_MINIMA) return res.status(400).json({ erro: `Senha deve ter no mínimo ${SENHA_MINIMA} caracteres` });
      if (partnerId != null && partnerId !== "" && !ehUuid(partnerId)) return res.status(400).json({ erro: "partnerId inválido" });

      if (partnerId) {
        const { data: partner } = await db.from("partners").select("id").eq("id", partnerId).maybeSingle();
        if (!partner) return res.status(400).json({ erro: "Empresa não encontrada" });
        const bloqueio = await podeLigarNaEmpresa(partnerId as string, role === "admin");
        if (bloqueio) return res.status(bloqueio.status).json(bloqueio.corpo);
      }

      const { data: criado, error: erroAuth } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (erroAuth || !criado?.user) {
        const status = (erroAuth as { status?: number } | null)?.status;
        return res.status(status === 422 || status === 409 ? 409 : 400).json({ erro: erroAuth?.message || "Falha ao criar usuário" });
      }
      const userId = criado.user.id;

      const dadosPerfil = {
        name,
        email,
        phone: soDigitos(corpo.phone) || null,
        role,
        status: "ativo",
        expira_em: expiracao(corpo, ctx.agora()) ?? null,
        partner_id: partnerId || null,
      };

      try {
        const { data: atualizado, error: erroPerfil } = await db
          .from("profiles")
          .update(dadosPerfil)
          .eq("user_id", userId)
          .select(COLUNAS_USUARIO)
          .maybeSingle();
        if (erroPerfil) throw erroPerfil;

        let perfil = atualizado as Record<string, any> | null;
        if (!perfil) {
          // Banco sem o gatilho de auth.users: ainda não existe profile para este usuário.
          const { data: inserido, error: erroInsert } = await db
            .from("profiles")
            .insert({ user_id: userId, ...dadosPerfil })
            .select(COLUNAS_USUARIO)
            .single();
          if (erroInsert) throw erroInsert;
          perfil = inserido as Record<string, any>;
        }

        if (partnerId) await ligarNaEmpresa(partnerId as string, perfil.id);
        return res.json({ ok: true, usuario: perfil });
      } catch (e) {
        // Sem profile utilizável o login não serve para nada: desfaz o usuário do Auth.
        await db.auth.admin.deleteUser(userId).catch(() => undefined);
        throw e;
      }
    }),
  );

  app.put(
    "/api/admin/usuarios/:id",
    assincrono(async (req, res) => {
      const db = ctx.db();
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });
      const corpo = req.body || {};
      const mudancas: Record<string, unknown> = {};

      if (corpo.name !== undefined) {
        const name = texto(corpo.name);
        if (!name) return res.status(400).json({ erro: "Nome não pode ficar vazio" });
        mudancas.name = name;
      }
      if (corpo.phone !== undefined) mudancas.phone = soDigitos(corpo.phone) || null;
      if (corpo.role !== undefined) {
        if (!PAPEIS.includes(corpo.role)) return res.status(400).json({ erro: "Papel inválido" });
        mudancas.role = corpo.role;
      }
      if (corpo.status !== undefined) {
        if (!STATUS.includes(corpo.status)) return res.status(400).json({ erro: "Status inválido" });
        mudancas.status = corpo.status;
      }
      const partnerId = partnerDoCorpo(corpo);
      if (partnerId !== undefined) {
        if (partnerId !== null && partnerId !== "" && !ehUuid(partnerId)) return res.status(400).json({ erro: "partnerId inválido" });
        mudancas.partner_id = partnerId || null;
      }
      if (Object.keys(mudancas).length === 0) return res.status(400).json({ erro: "Nada para alterar" });
      if (id === req.auth!.profileId && ((mudancas.role && mudancas.role !== "admin") || (mudancas.status && mudancas.status !== "ativo"))) {
        return res.status(400).json({ erro: "Você não pode tirar o próprio acesso de admin" });
      }

      const { data: anterior } = await db.from("profiles").select("id, partner_id, role").eq("id", id).maybeSingle();
      if (!anterior) return res.status(404).json({ erro: "Usuário não encontrado" });
      const seraAdmin = (mudancas.role ?? anterior.role) === "admin";
      if (partnerId && (partnerId || null) !== anterior.partner_id) {
        const bloqueio = await podeLigarNaEmpresa(partnerId as string, seraAdmin);
        if (bloqueio) return res.status(bloqueio.status).json(bloqueio.corpo);
      }
      // Virar admin com empresa ligada daria ao mentor o papel de membro nela.
      if (mudancas.role === "admin" && anterior.role !== "admin" && anterior.partner_id && partnerId === undefined) {
        return res.status(400).json({ erro: "admin_nao_entra_em_empresa" });
      }

      const { data: perfil, error } = await db.from("profiles").update(mudancas).eq("id", id).select(COLUNAS_USUARIO).single();
      if (error) throw error;

      // A empresa do profile é a que dá acesso (partner_members): troca o vínculo junto.
      if (partnerId !== undefined && (partnerId || null) !== anterior.partner_id) {
        if (anterior.partner_id) {
          await db.from("partner_members").delete().eq("partner_id", anterior.partner_id).eq("profile_id", id).eq("papel", "membro");
        }
        if (partnerId) await ligarNaEmpresa(partnerId as string, id);
      }
      return res.json({ ok: true, usuario: perfil });
    }),
  );

  app.post(
    "/api/admin/usuarios/:id/renovar",
    assincrono(async (req, res) => {
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });
      const expiraEm = expiracao(req.body || {}, ctx.agora()) ?? null;
      const { data, error } = await ctx
        .db()
        .from("profiles")
        .update({ expira_em: expiraEm, status: "ativo" })
        .eq("id", id)
        .select(COLUNAS_USUARIO)
        .maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ erro: "Usuário não encontrado" });
      return res.json({ ok: true, usuario: data });
    }),
  );

  // A senha vive só no Supabase Auth (hash dele); nada é gravado em profiles.
  app.post(
    "/api/admin/usuarios/:id/alterar-senha",
    assincrono(async (req, res) => {
      const db = ctx.db();
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });
      const novaSenha = req.body?.novaSenha ?? req.body?.password;
      if (typeof novaSenha !== "string" || novaSenha.length < SENHA_MINIMA) {
        return res.status(400).json({ erro: `Senha deve ter no mínimo ${SENHA_MINIMA} caracteres` });
      }
      const { data: perfil } = await db.from("profiles").select("id, user_id").eq("id", id).maybeSingle();
      if (!perfil) return res.status(404).json({ erro: "Usuário não encontrado" });
      if (!perfil.user_id) return res.status(400).json({ erro: "Este perfil não tem login no Supabase Auth" });
      // Quem sabe a senha entra como a pessoa. Com conteúdo de empresa que o admin não pode ver, a senha só muda pelo próprio usuário.
      const { data: vinculos, error: erroVinculos } = await db.from("partner_members").select("partner_id").eq("profile_id", perfil.id);
      if (erroVinculos) throw erroVinculos;
      for (const v of (vinculos || []) as Array<{ partner_id: string }>) {
        if (!(await podeVerConteudo(db, req.auth, v.partner_id, "crm"))) return res.status(403).json({ erro: "senha_so_pelo_proprio_usuario" });
      }

      const { error } = await db.auth.admin.updateUserById(perfil.user_id, { password: novaSenha });
      if (error) return res.status(400).json({ erro: error.message });
      console.warn(`[admin] senha de ${perfil.id} alterada por ${req.auth!.profileId}`);
      return res.json({ ok: true, mensagem: "Senha alterada com sucesso!" });
    }),
  );

  app.post(
    "/api/admin/usuarios/:id/status",
    assincrono(async (req, res) => {
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });
      const status = req.body?.status;
      if (!STATUS.includes(status)) return res.status(400).json({ erro: "Status inválido" });
      if (id === req.auth!.profileId && status !== "ativo") return res.status(400).json({ erro: "Você não pode suspender a própria conta" });

      const { data, error } = await ctx.db().from("profiles").update({ status }).eq("id", id).select(COLUNAS_USUARIO).maybeSingle();
      if (error) throw error;
      if (!data) return res.status(404).json({ erro: "Usuário não encontrado" });
      return res.json({ ok: true, usuario: data });
    }),
  );

  app.delete(
    "/api/admin/usuarios/:id",
    assincrono(async (req, res) => {
      const db = ctx.db();
      const { id } = req.params;
      if (!ehUuid(id)) return res.status(400).json({ erro: "id inválido" });
      if (id === req.auth!.profileId) return res.status(400).json({ erro: "Você não pode excluir a própria conta" });

      const { data: perfil } = await db.from("profiles").select("id, user_id").eq("id", id).maybeSingle();
      if (!perfil) return res.status(404).json({ erro: "Usuário não encontrado" });

      if (perfil.user_id) {
        const { error } = await db.auth.admin.deleteUser(perfil.user_id);
        if (error) return res.status(400).json({ erro: error.message });
      }
      // Com usuário no Auth o profile já cai em cascata; sem ele, apaga direto.
      const { error } = await db.from("profiles").delete().eq("id", id);
      if (error) return res.status(400).json({ erro: error.message });
      return res.json({ ok: true });
    }),
  );

  // Cria empresa com funil e fluxo padrão. O dono é o usuário indicado (nunca um admin) ou, sem indicação, um marcador
  // sem login que o primeiro usuário ligado à empresa substitui. O admin que cria a empresa não vira dono dela:
  // dono dá o conteúdo sem opt-in e o controle da chave de privacidade do mentorado.
  app.post(
    "/api/setup/empresa",
    exigirAdmin,
    assincrono(async (req, res) => {
      const db = ctx.db();
      const corpo = req.body || {};
      const nome = texto(corpo.nome);
      if (!nome) return res.status(400).json({ erro: "Nome da empresa obrigatório" });
      const semDono = corpo.userId == null || corpo.userId === "";
      if (!semDono && !ehUuid(corpo.userId)) return res.status(400).json({ erro: "userId inválido" });

      if (!semDono) {
        const { data: perfilDono, error: erroDono } = await db.from("profiles").select("role").eq("user_id", corpo.userId).maybeSingle();
        if (erroDono) throw erroDono;
        if (perfilDono?.role === "admin") return res.status(400).json({ erro: "dono_nao_pode_ser_admin" });
      }

      const { data, error } = await db.rpc("bootstrap_empresa_completa", {
        _user_id: semDono ? null : corpo.userId,
        _empresa_nome: nome.slice(0, 120),
        _cidade: texto(corpo.cidade).slice(0, 80) || null,
        _estado: texto(corpo.estado).slice(0, 2).toUpperCase() || null,
      });
      if (error) return res.status(500).json({ erro: error.message });
      if (semDono && data?.profile_id) {
        await db.from("profiles").update({ name: `Dono pendente — ${nome}`.slice(0, 120) }).eq("id", data.profile_id);
      }
      return res.json({ ok: true, data });
    }),
  );
}
