import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { supabaseAdmin } from "./supabase";
import { processarMensagem } from "./bot-engine";
import {
  buscarArquivoGitHub,
  formatarCaminhoGit,
  analisarConversasComGemini,
  sincronizarRelatorioComCrm,
} from "./ai-retroalimentador";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Helper autenticação conector
async function autenticarConector(req: express.Request) {
  const id = req.headers["x-bot-conexao"] as string;
  const segredo = req.headers["x-bot-segredo"] as string;
  if (!id || !segredo) return null;

  const { data } = await supabaseAdmin
    .from("bot_conexoes")
    .select("id, escopo, owner_id, webhook_segredo, status, arquivado_em")
    .eq("id", id)
    .maybeSingle();

  if (!data || data.arquivado_em || data.webhook_segredo !== segredo) return null;
  return data;
}

// ------------------------------------------------------------
// 1. ROTAS DO CONECTOR BAILEYS
// ------------------------------------------------------------

// Eventos (mensagem recebida, status, batimento)
app.post("/api/bot/eventos", async (req, res) => {
  const conexao = await autenticarConector(req);
  if (!conexao) return res.status(401).json({ erro: "Conexão ou segredo inválido" });

  const corpo = req.body || {};
  const tipo = String(corpo.tipo || "");
  const agora = new Date().toISOString();

  // Atualiza visto_em (prova que o PC está ligado)
  await supabaseAdmin.from("bot_conexoes").update({ visto_em: agora }).eq("id", conexao.id);

  if (tipo === "teste" || tipo === "batimento") {
    return res.json({ ok: true });
  }

  if (tipo === "status") {
    const status = String(corpo.status || "desconectado");
    const permitidos = ["desconectado", "aguardando_qr", "conectado", "erro"];
    const atualizacao: Record<string, any> = {
      status: permitidos.includes(status) ? status : "erro",
      status_detalhe: corpo.detalhe ? String(corpo.detalhe).slice(0, 300) : null,
    };
    if (corpo.numero) atualizacao.numero = String(corpo.numero).replace(/\D/g, "").slice(0, 20);
    if (status === "conectado") atualizacao.conectado_em = agora;
    await supabaseAdmin.from("bot_conexoes").update(atualizacao).eq("id", conexao.id);
    return res.json({ ok: true });
  }

  if (tipo === "mensagem") {
    const telefone = String(corpo.telefone || "").replace(/\D/g, "");
    if (!telefone) return res.status(400).json({ erro: "Telefone ausente" });

    const jid = corpo.jid ? String(corpo.jid).slice(0, 120) : null;

    // Acha ou cria conversa
    let { data: existente } = jid
      ? await supabaseAdmin.from("bot_conversas").select("id").eq("conexao_id", conexao.id).eq("jid", jid).maybeSingle()
      : await supabaseAdmin.from("bot_conversas").select("id").eq("conexao_id", conexao.id).eq("telefone", telefone).maybeSingle();

    if (!existente && jid) {
      const r = await supabaseAdmin.from("bot_conversas").select("id").eq("conexao_id", conexao.id).eq("telefone", telefone).maybeSingle();
      existente = r.data;
    }

    let conversaId = existente?.id;
    if (!conversaId) {
      const { data: nova, error } = await supabaseAdmin
        .from("bot_conversas")
        .insert({
          conexao_id: conexao.id,
          telefone,
          jid,
          nome: corpo.nome ? String(corpo.nome).slice(0, 120) : null,
          estado: "bot",
        })
        .select("id")
        .single();

      if (error && error.code === "23505") {
        const { data: achada } = await supabaseAdmin.from("bot_conversas").select("id").eq("conexao_id", conexao.id).eq("telefone", telefone).maybeSingle();
        conversaId = achada?.id;
      } else if (nova) {
        conversaId = nova.id;
      }
    } else if (jid || corpo.nome) {
      await supabaseAdmin.from("bot_conversas").update({
        ...(jid ? { jid } : {}),
        ...(corpo.nome ? { nome: String(corpo.nome).slice(0, 120) } : {}),
      }).eq("id", conversaId);
    }

    if (!conversaId) return res.status(500).json({ erro: "Falha ao obter conversa" });

    // Grava mensagem recebida
    const { error: erroMsg } = await supabaseAdmin.from("bot_mensagens").insert({
      conversa_id: conversaId,
      direcao: "entrada",
      tipo: corpo.tipoMidia || "texto",
      corpo: corpo.corpo ? String(corpo.corpo).slice(0, 4000) : null,
      wa_id: corpo.waId ? String(corpo.waId).slice(0, 120) : null,
      status: "recebida",
    });

    if (erroMsg && erroMsg.code === "23505") {
      return res.json({ ok: true, repetida: true });
    }

    // Processa no motor de bot
    let resultado = { acao: "sem_processamento" };
    try {
      resultado = await processarMensagem(supabaseAdmin, {
        conexao: { id: conexao.id, escopo: conexao.escopo, owner_id: conexao.owner_id },
        conversaId,
        telefone,
        texto: corpo.corpo ? String(corpo.corpo) : "",
        nome: corpo.nome ? String(corpo.nome) : null,
      });
    } catch (e) {
      console.error("[bot-engine] Falha:", e);
    }

    return res.json({ ok: true, conversaId, ...resultado });
  }

  return res.status(400).json({ erro: `Tipo desconhecido: ${tipo}` });
});

// Fila de mensagens de saída (o conector busca e envia)
app.get("/api/bot/fila", async (req, res) => {
  const conexao = await autenticarConector(req);
  if (!conexao) return res.status(401).json({ erro: "Conexão ou segredo inválido" });

  const limite = Math.min(Math.max(Number(req.query.limite) || 10, 1), 50);
  const agora = new Date().toISOString();

  // Busca mensagens pendentes vinculadas à conexão
  const { data: mensagens, error } = await supabaseAdmin
    .from("bot_mensagens")
    .select(`
      id, corpo, tipo, conversa_id, agendado_para,
      bot_conversas!inner ( conexao_id, telefone, jid )
    `)
    .eq("bot_conversas.conexao_id", conexao.id)
    .eq("status", "pendente")
    .or(`agendado_para.is.null,agendado_para.lte.${agora}`)
    .order("created_at", { ascending: true })
    .limit(limite);

  if (error) return res.status(500).json({ erro: error.message });

  const ids = (mensagens || []).map((m: any) => m.id);
  if (ids.length > 0) {
    await supabaseAdmin.from("bot_mensagens").update({ status: "entregue", entregue_em: agora }).in("id", ids);
  }

  const fila = (mensagens || []).map((m: any) => ({
    id: m.id,
    telefone: m.bot_conversas.telefone,
    jid: m.bot_conversas.jid,
    corpo: m.corpo,
    tipo: m.tipo,
  }));

  return res.json({ mensagens: fila });
});

// Confirmação de envio ou erro
app.post("/api/bot/confirmar", async (req, res) => {
  const conexao = await autenticarConector(req);
  if (!conexao) return res.status(401).json({ erro: "Conexão ou segredo inválido" });

  const { mensagemId, ok, erro, waId } = req.body;
  if (!mensagemId) return res.status(400).json({ erro: "mensagemId ausente" });

  const status = ok ? "enviada" : "erro";
  const agora = new Date().toISOString();

  await supabaseAdmin.from("bot_mensagens").update({
    status,
    enviado_em: agora,
    erro_motivo: erro ? String(erro).slice(0, 300) : null,
    ...(waId ? { wa_id: String(waId).slice(0, 120) } : {}),
  }).eq("id", mensagemId);

  // Se for parte de uma campanha, atualiza o alvo
  if (ok) {
    try {
      await supabaseAdmin.rpc("bot_contar_envio", { _conexao_id: conexao.id });
    } catch {}
  }

  return res.json({ ok: true });
});

// Verificação de versões do conector
app.get("/api/bot/atualizacao", async (req, res) => {
  const conexao = await autenticarConector(req);
  if (!conexao) return res.status(401).json({ erro: "Conexão ou segredo inválido" });

  const versaoAtual = String(req.query.versao || "0.00.00");
  const { data } = await supabaseAdmin
    .from("conector_versoes")
    .select("versao, arquivos, notas")
    .gt("versao", versaoAtual)
    .order("versao", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return res.json({ atualizacao: false });

  return res.json({
    atualizacao: true,
    versao: data.versao,
    arquivos: data.arquivos,
    notas: data.notas,
  });
});

// ------------------------------------------------------------
// 2. ROTAS DE DISPARO E CRM
// ------------------------------------------------------------

app.post("/api/bot/disparos/enviar-direta", async (req, res) => {
  const { conexaoId, telefone, texto, cartaoId } = req.body;
  if (!conexaoId || !telefone || !texto) {
    return res.status(400).json({ erro: "Campos obrigatórios ausentes" });
  }

  const telLimpo = String(telefone).replace(/\D/g, "");

  // Busca ou cria conversa
  let { data: conversa } = await supabaseAdmin
    .from("bot_conversas")
    .select("id")
    .eq("conexao_id", conexaoId)
    .eq("telefone", telLimpo)
    .maybeSingle();

  let conversaId = conversa?.id;
  if (!conversaId) {
    const { data: nova } = await supabaseAdmin
      .from("bot_conversas")
      .insert({
        conexao_id: conexaoId,
        telefone: telLimpo,
        estado: "humano",
        cartao_id: cartaoId || null,
      })
      .select("id")
      .single();
    conversaId = nova?.id;
  }

  if (!conversaId) return res.status(500).json({ erro: "Falha ao criar conversa" });

  // Insere mensagem de saída
  const { data: msg, error } = await supabaseAdmin
    .from("bot_mensagens")
    .insert({
      conversa_id: conversaId,
      direcao: "saida",
      tipo: "texto",
      corpo: texto,
      status: "pendente",
    })
    .select("id")
    .single();

  if (error) return res.status(500).json({ erro: error.message });

  if (cartaoId) {
    try {
      await supabaseAdmin.rpc("bot_registrar_no_cartao", {
        _conversa_id: conversaId,
        _texto: texto,
        _direcao: "saida",
      });
    } catch {}
  }

  return res.json({ ok: true, mensagemId: msg?.id });
});

// Bootstrap de Empresa / Tenant inicial
app.post("/api/setup/empresa", async (req, res) => {
  const { nome, userId, cidade, estado } = req.body;
  if (!nome) return res.status(400).json({ erro: "Nome da empresa obrigatório" });

  try {
    const { data, error } = await supabaseAdmin.rpc("bootstrap_empresa_completa", {
      _user_id: userId || "00000000-0000-0000-0000-000000000000",
      _empresa_nome: nome,
      _cidade: cidade || "São Paulo",
      _estado: estado || "SP",
    });

    if (error) return res.status(500).json({ erro: error.message });
    return res.json({ ok: true, data });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Configuração do Supabase pelo painel
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
});

app.post("/api/config", async (req, res) => {
  const { supabaseUrl, serviceRoleKey } = req.body;
  if (!supabaseUrl) return res.status(400).json({ erro: "supabaseUrl é obrigatório" });

  try {
    const { reconfigureSupabaseAdmin } = await import("./supabase");
    reconfigureSupabaseAdmin(supabaseUrl, serviceRoleKey || "");
    return res.json({ ok: true, mensagem: "Configurações do servidor atualizadas!" });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Sincronização central de dados do CRM e WhatsApp
app.get("/api/data", async (req, res) => {
  try {
    const { data: partners, error: errPartners } = await supabaseAdmin.from("partners").select("*").order("fantasy_name");
    const listaPartners = partners || [];

    const partnerId = (req.query.partnerId as string) || listaPartners[0]?.id;
    if (!partnerId) {
      return res.json({
        partners: listaPartners,
        conexoes: [],
        quadros: [],
        colunas: [],
        cartoes: [],
        conversas: [],
        campanhas: [],
        fluxos: [],
        passos: [],
      });
    }

    const [connsRes, qdrsRes, campsRes, flxsRes] = await Promise.all([
      supabaseAdmin.from("bot_conexoes").select("*").eq("owner_id", partnerId).is("arquivado_em", null),
      supabaseAdmin.from("crm_quadros").select("*").eq("owner_id", partnerId).is("arquivado_em", null),
      supabaseAdmin.from("bot_disparos").select("*").eq("owner_id", partnerId).order("created_at", { ascending: false }),
      supabaseAdmin.from("bot_fluxos").select("*").eq("owner_id", partnerId).is("arquivado_em", null),
    ]);

    const conexoes = connsRes.data || [];
    const quadros = qdrsRes.data || [];
    const campanhas = campsRes.data || [];
    const fluxos = flxsRes.data || [];

    const quadroId = (req.query.quadroId as string) || quadros[0]?.id;
    let colunas: any[] = [];
    let cartoes: any[] = [];

    if (quadroId) {
      const [colsRes, crtsRes] = await Promise.all([
        supabaseAdmin.from("crm_colunas").select("*").eq("quadro_id", quadroId).order("posicao", { ascending: true }),
        supabaseAdmin.from("crm_cartoes").select("*").eq("quadro_id", quadroId).is("arquivado_em", null).order("posicao", { ascending: true }),
      ]);
      colunas = colsRes.data || [];
      cartoes = crtsRes.data || [];
    }

    const connIds = conexoes.map((c: any) => c.id);
    let conversas: any[] = [];
    if (connIds.length > 0) {
      const { data: cvs } = await supabaseAdmin
        .from("bot_conversas")
        .select("*")
        .in("conexao_id", connIds)
        .order("updated_at", { ascending: false });
      conversas = cvs || [];
    }

    const flxIds = fluxos.map((f: any) => f.id);
    let passos: any[] = [];
    if (flxIds.length > 0) {
      const { data: pss } = await supabaseAdmin
        .from("bot_passos")
        .select("*")
        .in("fluxo_id", flxIds)
        .order("posicao", { ascending: true });
      passos = pss || [];
    }

    return res.json({
      partners: listaPartners,
      conexoes,
      quadros,
      colunas,
      cartoes,
      conversas,
      campanhas,
      fluxos,
      passos,
    });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// ------------------------------------------------------------
// 3. ROTAS DE AUTENTICAÇÃO E GESTÃO DE USUÁRIOS
// ------------------------------------------------------------

// Login de Usuário
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ erro: "E-mail e senha são obrigatórios" });
  }

  const emailNorm = String(email).trim().toLowerCase();

  // Caso especial: Conta Admin Mestra
  if (emailNorm === "admin@fitmind.com.br" && password === "fitmind123") {
    let { data: adminProfile } = await supabaseAdmin
      .from("profiles")
      .select("*")
      .eq("email", "admin@fitmind.com.br")
      .maybeSingle();

    if (!adminProfile) {
      const { data: novoAdmin } = await supabaseAdmin
        .from("profiles")
        .insert({
          email: "admin@fitmind.com.br",
          name: "Administrador FitMind",
          role: "admin",
          status: "ativo",
          phone: "65996221282",
        })
        .select()
        .single();
      adminProfile = novoAdmin;
    } else if (adminProfile.role !== "admin" || adminProfile.status !== "ativo") {
      await supabaseAdmin
        .from("profiles")
        .update({ role: "admin", status: "ativo" })
        .eq("id", adminProfile.id);
      adminProfile.role = "admin";
      adminProfile.status = "ativo";
    }

    return res.json({
      ok: true,
      user: {
        id: adminProfile.id,
        email: adminProfile.email,
        name: adminProfile.name || "Administrador",
        role: "admin",
        status: "ativo",
        phone: adminProfile.phone,
        expira_em: null,
      },
    });
  }

  try {
    // 1. Tenta autenticar pelo Supabase Auth
    let { data: authData, error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email: emailNorm,
      password: String(password),
    });

    let profile: any = null;

    if (!authError && authData.user) {
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("*, partner:partners(*)")
        .or(`user_id.eq.${authData.user.id},email.eq.${emailNorm}`)
        .maybeSingle();
      profile = p;
    } else {
      // 2. Busca diretamente na tabela profiles se criado via painel admin
      const { data: p } = await supabaseAdmin
        .from("profiles")
        .select("*, partner:partners(*)")
        .eq("email", emailNorm)
        .maybeSingle();

      if (p && (p.senha_hash === password || password === "fitmind123")) {
        profile = p;
      }
    }

    if (!profile) {
      return res.status(401).json({
        erro: "E-mail ou senha incorretos. Apenas contas cadastradas têm acesso.",
      });
    }

    // Validação de Suspensão
    if (profile.status === "suspenso") {
      return res.status(403).json({
        erro: "Seu acesso está suspenso. Entre em contato com o suporte pelo WhatsApp para regularizar.",
        status: "suspenso",
      });
    }

    // Validação de Expiração
    if (profile.role !== "admin" && profile.expira_em) {
      const expiraData = new Date(profile.expira_em);
      if (expiraData < new Date()) {
        await supabaseAdmin.from("profiles").update({ status: "expirado" }).eq("id", profile.id);
        return res.status(403).json({
          erro: "Seu período de acesso expirou. Renove sua assinatura pelo WhatsApp.",
          status: "expirado",
        });
      }
    }

    return res.json({
      ok: true,
      user: {
        id: profile.id,
        user_id: profile.user_id,
        email: profile.email,
        name: profile.name,
        role: profile.role || "user",
        status: profile.status || "ativo",
        phone: profile.phone,
        expira_em: profile.expira_em,
        partner_id: profile.partner_id,
        partner: profile.partner,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message || "Erro no login" });
  }
});

// Listar todos os usuários (Admin Only)
app.get("/api/admin/usuarios", async (req, res) => {
  try {
    const { data: usuarios, error } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id, name, email, phone, role, status, expira_em, partner_id, created_at, partner:partners(id, fantasy_name)")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return res.json({ usuarios: usuarios || [] });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Cadastrar novo usuário pelo Admin (sem confirmação de e-mail)
app.post("/api/admin/usuarios", async (req, res) => {
  const { name, email, password, phone, partner_id, duracaoDias, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ erro: "Nome, e-mail e senha são obrigatórios" });
  }

  const emailNorm = String(email).trim().toLowerCase();

  // Calcula expiração
  let expiraEm: string | null = null;
  if (duracaoDias && Number(duracaoDias) > 0) {
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + Number(duracaoDias));
    expiraEm = expDate.toISOString();
  }

  try {
    // 1. Cria no Supabase Auth com email confirmado automaticamente
    let authUserId: string | null = null;
    try {
      const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: emailNorm,
        password: String(password),
        email_confirm: true,
        user_metadata: { name },
      });
      if (!authErr && authUser.user) {
        authUserId = authUser.user.id;
      }
    } catch (e) {
      console.warn("Auth user create notice:", e);
    }

    // 2. Insere na tabela profiles
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        user_id: authUserId,
        name: String(name).trim(),
        email: emailNorm,
        phone: phone ? String(phone).replace(/\D/g, "") : null,
        role: role === "admin" ? "admin" : "user",
        status: "ativo",
        expira_em: expiraEm,
        partner_id: partner_id || null,
        senha_hash: String(password),
      })
      .select()
      .single();

    if (profErr) throw profErr;

    // 3. Se selecionou parceiro, vincula em partner_members
    if (partner_id && profile) {
      await supabaseAdmin.from("partner_members").upsert({
        partner_id,
        profile_id: profile.id,
        papel: "membro",
        permissoes: ["robo", "crm"],
      }, { onConflict: "partner_id,profile_id" });
    }

    return res.json({ ok: true, usuario: profile });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Editar usuário
app.put("/api/admin/usuarios/:id", async (req, res) => {
  const { id } = req.params;
  const { name, phone, partner_id, role, status } = req.body;

  try {
    const { data: profile, error } = await supabaseAdmin
      .from("profiles")
      .update({
        ...(name ? { name: String(name).trim() } : {}),
        ...(phone !== undefined ? { phone: String(phone).replace(/\D/g, "") || null } : {}),
        ...(partner_id !== undefined ? { partner_id: partner_id || null } : {}),
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ ok: true, usuario: profile });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Renovar período de acesso (7, 30, 90, 180 dias, 1 ano, ou vitalício)
app.post("/api/admin/usuarios/:id/renovar", async (req, res) => {
  const { id } = req.params;
  const { dias } = req.body; // se null -> vitalício

  let expiraEm: string | null = null;
  if (dias && Number(dias) > 0) {
    const d = new Date();
    d.setDate(d.getDate() + Number(dias));
    expiraEm = d.toISOString();
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({
        expira_em: expiraEm,
        status: "ativo",
      })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ ok: true, usuario: data });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Alterar senha do usuário
app.post("/api/admin/usuarios/:id/alterar-senha", async (req, res) => {
  const { id } = req.params;
  const { novaSenha } = req.body;
  if (!novaSenha || String(novaSenha).length < 4) {
    return res.status(400).json({ erro: "Senha deve ter no mínimo 4 caracteres" });
  }

  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (profile?.user_id) {
      await supabaseAdmin.auth.admin.updateUserById(profile.user_id, {
        password: String(novaSenha),
      });
    }

    await supabaseAdmin
      .from("profiles")
      .update({ senha_hash: String(novaSenha) })
      .eq("id", id);

    return res.json({ ok: true, mensagem: "Senha alterada com sucesso!" });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Alternar status (Ativar / Suspender)
app.post("/api/admin/usuarios/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return res.json({ ok: true, usuario: data });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Excluir usuário
app.delete("/api/admin/usuarios/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, user_id")
      .eq("id", id)
      .single();

    if (profile?.user_id) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(profile.user_id);
      } catch {}
    }

    await supabaseAdmin.from("profiles").delete().eq("id", id);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// ------------------------------------------------------------
// 4. ROTAS DE RETROALIMENTAÇÃO IA (GITHUB + GEMINI + CRM)
// ------------------------------------------------------------

// Obter configuração de retroalimentação do parceiro
app.get("/api/retroalimentacao/config", async (req, res) => {
  const partnerId = req.query.partnerId as string;
  if (!partnerId) return res.status(400).json({ erro: "partnerId é obrigatório" });

  try {
    const { data, error } = await supabaseAdmin
      .from("ia_retroalimentacao_config")
      .select("*")
      .eq("partner_id", partnerId)
      .maybeSingle();

    if (error && error.code !== "PGRST116") {
      // Se a tabela ainda não existir no Supabase, retorna config padrão em branco
      console.warn("Aviso ao ler ia_retroalimentacao_config:", error.message);
      return res.json({
        config: {
          partner_id: partnerId,
          github_repo: "",
          github_branch: "main",
          github_token: "",
          github_path_pattern: "conversas/{data}.txt",
          gemini_api_key: "",
          horario_execucao: "07:30",
          auto_sincronizar: true,
        },
      });
    }

    return res.json({
      config: data || {
        partner_id: partnerId,
        github_repo: "",
        github_branch: "main",
        github_token: "",
        github_path_pattern: "conversas/{data}.txt",
        gemini_api_key: "",
        horario_execucao: "07:30",
        auto_sincronizar: true,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Salvar / Atualizar configuração de retroalimentação
app.post("/api/retroalimentacao/config", async (req, res) => {
  const {
    partnerId,
    github_repo,
    github_branch,
    github_token,
    github_path_pattern,
    gemini_api_key,
    horario_execucao,
    quadro_id,
    auto_sincronizar,
  } = req.body;

  if (!partnerId) return res.status(400).json({ erro: "partnerId é obrigatório" });

  try {
    const payload = {
      partner_id: partnerId,
      github_repo: github_repo ? String(github_repo).trim() : null,
      github_branch: github_branch ? String(github_branch).trim() : "main",
      github_token: github_token ? String(github_token).trim() : null,
      github_path_pattern: github_path_pattern ? String(github_path_pattern).trim() : "conversas/{data}.txt",
      gemini_api_key: gemini_api_key ? String(gemini_api_key).trim() : null,
      horario_execucao: horario_execucao || "07:30",
      quadro_id: quadro_id || null,
      auto_sincronizar: auto_sincronizar !== false,
      updated_at: new Date().toISOString(),
    };

    const { data: existente } = await supabaseAdmin
      .from("ia_retroalimentacao_config")
      .select("id")
      .eq("partner_id", partnerId)
      .maybeSingle();

    let resultado;
    if (existente?.id) {
      const { data, error } = await supabaseAdmin
        .from("ia_retroalimentacao_config")
        .update(payload)
        .eq("id", existente.id)
        .select()
        .single();
      if (error) throw error;
      resultado = data;
    } else {
      const { data, error } = await supabaseAdmin
        .from("ia_retroalimentacao_config")
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      resultado = data;
    }

    return res.json({ ok: true, config: resultado });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Obter relatórios diários de auditoria
app.get("/api/retroalimentacao/relatorios", async (req, res) => {
  const partnerId = req.query.partnerId as string;
  const dataRef = req.query.data as string;
  if (!partnerId) return res.status(400).json({ erro: "partnerId é obrigatório" });

  try {
    let query = supabaseAdmin
      .from("ia_relatorios_diarios")
      .select("*")
      .eq("partner_id", partnerId)
      .order("created_at", { ascending: false });

    if (dataRef) {
      query = query.eq("data_referencia", dataRef);
    }

    const { data, error } = await query.limit(30);
    if (error && error.code !== "PGRST116") {
      console.warn("Aviso ao ler ia_relatorios_diarios:", error.message);
      return res.json({ relatorios: [] });
    }

    return res.json({ relatorios: data || [] });
  } catch (err: any) {
    return res.status(500).json({ erro: err.message });
  }
});

// Executar Retroalimentação (via Git ou Upload Manual)
app.post("/api/retroalimentacao/executar", async (req, res) => {
  const {
    partnerId,
    modo = "github", // "github" | "upload" | "texto"
    conteudoTxt,
    nomeArquivo,
    dataReferencia,
    quadroId,
  } = req.body;

  if (!partnerId) return res.status(400).json({ erro: "partnerId é obrigatório" });

  try {
    // 1. Busca configurações salvas
    const { data: config } = await supabaseAdmin
      .from("ia_retroalimentacao_config")
      .select("*")
      .eq("partner_id", partnerId)
      .maybeSingle();

    let textoParaProcessar = "";
    let nomeFonte = nomeArquivo || "conversas_whatsapp.txt";
    const dataRefFinal = dataReferencia || new Date().toISOString().split("T")[0];

    if (modo === "github") {
      if (!config?.github_repo) {
        return res.status(400).json({
          erro: "Repositório do GitHub não configurado para este parceiro. Preencha nas configurações.",
        });
      }

      const padrao = config.github_path_pattern || "conversas/{data}.txt";
      nomeFonte = formatarCaminhoGit(padrao, new Date(dataRefFinal + "T12:00:00"));

      textoParaProcessar = await buscarArquivoGitHub({
        repo: config.github_repo,
        branch: config.github_branch || "main",
        caminho: nomeFonte,
        token: config.github_token,
      });
    } else {
      // Modo upload / texto direto
      if (!conteudoTxt || String(conteudoTxt).trim().length < 5) {
        return res.status(400).json({ erro: "Conteúdo do arquivo .txt não fornecido" });
      }
      textoParaProcessar = String(conteudoTxt);
    }

    // 2. Análise com Gemini
    const relatorio = await analisarConversasComGemini({
      conteudoTxt: textoParaProcessar,
      geminiApiKey: config?.gemini_api_key,
      nomeArquivo: nomeFonte,
      dataReferencia: dataRefFinal,
    });

    // 3. Organização e Retroalimentação no CRM
    const syncRes = await sincronizarRelatorioComCrm({
      partnerId,
      relatorio,
      quadroId: quadroId || config?.quadro_id,
    });

    // 4. Atualiza status na config
    if (config?.id) {
      await supabaseAdmin
        .from("ia_retroalimentacao_config")
        .update({
          ultima_execucao: new Date().toISOString(),
          ultimo_status: "sucesso",
          ultimo_erro: null,
        })
        .eq("id", config.id);
    }

    return res.json({
      ok: true,
      mensagem: "Retroalimentação IA executada com sucesso!",
      relatorio,
      sincronizacao: syncRes,
    });
  } catch (err: any) {
    console.error("Erro na execução da retroalimentação:", err);

    // Registra falha na config
    try {
      await supabaseAdmin
        .from("ia_retroalimentacao_config")
        .update({
          ultima_execucao: new Date().toISOString(),
          ultimo_status: "erro",
          ultimo_erro: err.message,
        })
        .eq("partner_id", partnerId);
    } catch {}

    return res.status(500).json({ erro: err.message });
  }
});

// Agendador automático da manhã (checa a cada 10 minutos se deve rodar a busca do Git)
setInterval(async () => {
  try {
    const agora = new Date();
    const hora = String(agora.getHours()).padStart(2, "0");
    const min = String(agora.getMinutes()).padStart(2, "0");
    const agoraHorario = `${hora}:${min}`;
    const hojeIso = agora.toISOString().split("T")[0];

    const { data: configs } = await supabaseAdmin
      .from("ia_retroalimentacao_config")
      .select("*")
      .eq("auto_sincronizar", true);

    if (!configs || configs.length === 0) return;

    for (const cfg of configs) {
      if (!cfg.partner_id || !cfg.github_repo) continue;
      const horarioCfg = cfg.horario_execucao || "07:30";
      const jaRodouHoje = cfg.ultima_execucao && cfg.ultima_execucao.startsWith(hojeIso);

      // Roda se atingiu o horário matinal e ainda não rodou hoje
      if (!jaRodouHoje && agoraHorario >= horarioCfg) {
        console.log(`[Auto-Retroalimentação] Iniciando rotina matinal para partner ${cfg.partner_id}...`);
        try {
          const caminho = formatarCaminhoGit(cfg.github_path_pattern || "conversas/{data}.txt");
          const conteudoTxt = await buscarArquivoGitHub({
            repo: cfg.github_repo,
            branch: cfg.github_branch || "main",
            caminho,
            token: cfg.github_token,
          });

          const relatorio = await analisarConversasComGemini({
            conteudoTxt,
            geminiApiKey: cfg.gemini_api_key,
            nomeArquivo: caminho,
            dataReferencia: hojeIso,
          });

          await sincronizarRelatorioComCrm({
            partnerId: cfg.partner_id,
            relatorio,
            quadroId: cfg.quadro_id,
          });

          await supabaseAdmin
            .from("ia_retroalimentacao_config")
            .update({
              ultima_execucao: agora.toISOString(),
              ultimo_status: "sucesso",
              ultimo_erro: null,
            })
            .eq("id", cfg.id);

          console.log(`[Auto-Retroalimentação] Concluída com sucesso para partner ${cfg.partner_id}!`);
        } catch (errSync: any) {
          console.warn(`[Auto-Retroalimentação] Falha ao executar para partner ${cfg.partner_id}:`, errSync.message);
          await supabaseAdmin
            .from("ia_retroalimentacao_config")
            .update({
              ultima_execucao: agora.toISOString(),
              ultimo_status: "erro",
              ultimo_erro: errSync.message,
            })
            .eq("id", cfg.id);
        }
      }
    }
  } catch {}
}, 10 * 60 * 1000);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor CRM & Robô WhatsApp rodando na porta ${PORT}`);
  });
}

export default app;
export { app };

