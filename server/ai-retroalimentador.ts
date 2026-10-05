import { GoogleGenAI } from "@google/genai";
import { supabaseAdmin } from "./supabase";

export interface LeadAnalise {
  nome: string;
  telefone: string | null;
  data_hora?: string | null;
  status_comercial: "venda_ganha" | "perda_venda" | "em_aberto" | "iniciada_nao_finalizada";
  motivo_status: string;
  valor_estimado?: number | null;
  acao_recomendada: "follow_up" | "remarketing" | "recuperacao_perda" | "feedback_pos_venda" | "concluir_atendimento";
  urgencia: "alta" | "media" | "baixa";
  mensagem_sugerida: string;
  pontos_atencao_vendedor: string;
  resumo_conversa: string;
}

export interface RelatorioAnalise {
  data_referencia: string;
  arquivo_origem: string;
  total_conversas: number;
  vendas_fechadas: number;
  perdas_vendas: number;
  conversas_abertas: number;
  iniciadas_nao_finalizadas: number;
  resumo_executivo: string;
  pontos_melhoria: string;
  leads: LeadAnalise[];
}

/**
 * Resolve o caminho do arquivo GitHub substituindo tags dinâmicas como {ano}, {mes}, {dia}, {data}
 */
export function formatarCaminhoGit(padrao: string, dataRef?: Date): string {
  const d = dataRef || new Date();
  const ano = String(d.getFullYear());
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  const dataIso = `${ano}-${mes}-${dia}`;

  return padrao
    .replace(/\{ano\}/g, ano)
    .replace(/\{mes\}/g, mes)
    .replace(/\{dia\}/g, dia)
    .replace(/\{data\}/g, dataIso)
    .replace(/\{date\}/g, dataIso);
}

/**
 * Busca o arquivo de conversas no repositório GitHub via REST API
 */
export async function buscarArquivoGitHub(params: {
  repo: string;
  branch?: string;
  caminho: string;
  token?: string;
}): Promise<string> {
  const { repo, branch = "main", caminho, token } = params;
  const url = `https://api.github.com/repos/${repo}/contents/${caminho}?ref=${encodeURIComponent(branch)}`;

  const headers: Record<string, string> = {
    "User-Agent": "CRM-FitMind-AI-Retroalimentador",
    Accept: "application/vnd.github.v3.raw",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token.trim()}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Arquivo não encontrado no GitHub: ${caminho} (Branch: ${branch})`);
    }
    const errText = await res.text();
    throw new Error(`Falha ao acessar GitHub (${res.status}): ${errText}`);
  }

  const texto = await res.text();
  return texto;
}

/**
 * Analisa as conversas do dia usando o Google Gemini AI
 */
export async function analisarConversasComGemini(params: {
  conteudoTxt: string;
  geminiApiKey?: string;
  nomeArquivo?: string;
  dataReferencia?: string;
}): Promise<RelatorioAnalise> {
  const { conteudoTxt, geminiApiKey, nomeArquivo = "conversas.txt", dataReferencia } = params;
  const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Chave da API do Google Gemini não encontrada. Configure nas opções da Retroalimentação ou no arquivo .env (GEMINI_API_KEY)."
    );
  }

  if (!conteudoTxt || conteudoTxt.trim().length < 10) {
    throw new Error("O arquivo de conversas está vazio ou não contém texto legível.");
  }

  const dataAlvo = dataReferencia || new Date().toISOString().split("T")[0];

  const ai = new GoogleGenAI({ apiKey });

  const promptInstrucao = `
Você é o Diretor Comercial de Alta Performance e Auditor de Atendimento do CRM FitMind.
Sua missão é analisar minuciosamente o arquivo diário de conversas de WhatsApp recebido de clientes e equipe de vendas.

O arquivo pode conter conversas de múltiplos clientes, cada uma com Nome, Data, Hora e Mensagens trocadas.

SUAS TAREFAS CRÍTICAS:
1. Separar e isolar cada cliente/conversa presente no arquivo.
2. Fazer um diagnóstico comercial rigoroso de cada conversa:
   - Nome e Telefone do cliente (extraia se houver).
   - Classifique o STATUS COMERCIAL:
     * "venda_ganha": Pagamento confirmado, pedido fechado, agendamento confirmado ou contrato assinado.
     * "perda_venda": Cliente recusou, achou caro, comprou no concorrente, desistiu ou manifestou insatisfação irreversível.
     * "em_aberto": Negociação em andamento, cliente tirou dúvidas, aguarda retorno ou proposta.
     * "iniciada_nao_finalizada": Cliente iniciou o contato mas a conversa esfriou, vendedor não concluiu ou cliente parou de responder antes do fechamento.
   - Motivo do status: Explicação objetiva e precisa do que aconteceu.
   - Ação recomendada: "follow_up" | "remarketing" | "recuperacao_perda" | "feedback_pos_venda" | "concluir_atendimento".
   - Urgência: "alta" | "media" | "baixa".
   - Mensagem sugerida pronta: Crie um script de WhatsApp humanizado, educado, sem parecer robô, direcionado para que o vendedor envie com 1 clique (para follow-up, quebra de objeção ou agradecimento).
   - Pontos de melhoria do vendedor: Onde a equipe errou ou o que faltou (ex: demorou para responder, não usou gatilho de escassez, empurrou preço antes de valor, faltou simpatia).
   - Resumo da conversa: 2 a 3 frases com o contexto do diálogo.

3. Gerar um RELATÓRIO EXECUTIVO GERAL:
   - Resumo Executivo: Visão geral da performance do dia, taxa percebida de conversão e volume.
   - Pontos de Melhoria da Equipe: Críticas construtivas e planos de ação para a equipe comercial vender mais amanhã.
   - Contagem precisa de totais: total_conversas, vendas_fechadas, perdas_vendas, conversas_abertas, iniciadas_nao_finalizadas.

RETORNE ESTRITAMENTE UM OBJETO JSON VÁLIDO com a seguinte estrutura:
{
  "total_conversas": number,
  "vendas_fechadas": number,
  "perdas_vendas": number,
  "conversas_abertas": number,
  "iniciadas_nao_finalizadas": number,
  "resumo_executivo": "string com o relatório executivo geral em parágrafos",
  "pontos_melhoria": "string com dicas táticas e pontos de melhoria da equipe",
  "leads": [
    {
      "nome": "Nome do cliente",
      "telefone": "telefone limpo ou null",
      "data_hora": "ex: 14:30 ou null",
      "status_comercial": "venda_ganha" | "perda_venda" | "em_aberto" | "iniciada_nao_finalizada",
      "motivo_status": "motivo detalhado",
      "valor_estimado": 197.00 ou null,
      "acao_recomendada": "follow_up" | "remarketing" | "recuperacao_perda" | "feedback_pos_venda" | "concluir_atendimento",
      "urgencia": "alta" | "media" | "baixa",
      "mensagem_sugerida": "Texto pronto e persuasivo para mandar no zap",
      "pontos_atencao_vendedor": "O que o vendedor deve melhorar",
      "resumo_conversa": "Resumo do atendimento"
    }
  ]
}

ARQUIVO DE CONVERSAS DO DIA PARA AUDITAR:
--- INÍCIO DO ARQUIVO ---
${conteudoTxt}
--- FIM DO ARQUIVO ---
`;

  try {
    // Modelos preferidos: gemini-2.5-flash ou fallback gemini-1.5-flash
    let modelName = "gemini-2.5-flash";
    let responseText = "";

    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: promptInstrucao,
        config: {
          responseMimeType: "application/json",
        },
      });
      responseText = response.text || "";
    } catch (e1: any) {
      console.warn("Tentando fallback para gemini-1.5-flash...", e1.message);
      modelName = "gemini-1.5-flash";
      const responseFallback = await ai.models.generateContent({
        model: modelName,
        contents: promptInstrucao,
        config: {
          responseMimeType: "application/json",
        },
      });
      responseText = responseFallback.text || "";
    }

    if (!responseText) {
      throw new Error("A IA do Gemini não retornou resposta.");
    }

    // Limpa eventuais marcadores markdown de json caso ocorra
    let jsonLimpo = responseText.trim();
    if (jsonLimpo.startsWith("```json")) {
      jsonLimpo = jsonLimpo.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (jsonLimpo.startsWith("```")) {
      jsonLimpo = jsonLimpo.replace(/^```/, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(jsonLimpo);

    return {
      data_referencia: dataAlvo,
      arquivo_origem: nomeArquivo,
      total_conversas: Number(parsed.total_conversas || parsed.leads?.length || 0),
      vendas_fechadas: Number(parsed.vendas_fechadas || 0),
      perdas_vendas: Number(parsed.perdas_vendas || 0),
      conversas_abertas: Number(parsed.conversas_abertas || 0),
      iniciadas_nao_finalizadas: Number(parsed.iniciadas_nao_finalizadas || 0),
      resumo_executivo: String(parsed.resumo_executivo || "Auditoria realizada com sucesso."),
      pontos_melhoria: String(parsed.pontos_melhoria || "Sem pontos críticos identificados."),
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
    };
  } catch (err: any) {
    throw new Error(`Erro na auditoria da IA: ${err.message}`);
  }
}

/**
 * Organiza e retroalimenta o CRM:
 * 1. Procura ou cria cartões nas colunas corretas do Funil (Ganhos, Perdidos, Follow-up)
 * 2. Registra notas de auditoria na timeline do lead
 * 3. Grava o relatório diário consolidado
 */
export async function sincronizarRelatorioComCrm(params: {
  partnerId: string;
  relatorio: RelatorioAnalise;
  quadroId?: string | null;
}) {
  const { partnerId, relatorio, quadroId } = params;

  // 1. Salva o relatório diário no banco
  let relatorioId: string | null = null;
  try {
    const { data: salvo, error: errRelatorio } = await supabaseAdmin
      .from("ia_relatorios_diarios")
      .insert({
        partner_id: partnerId,
        data_referencia: relatorio.data_referencia,
        arquivo_origem: relatorio.arquivo_origem,
        total_conversas: relatorio.total_conversas,
        vendas_fechadas: relatorio.vendas_fechadas,
        perdas_vendas: relatorio.perdas_vendas,
        conversas_abertas: relatorio.conversas_abertas,
        iniciadas_nao_finalizadas: relatorio.iniciadas_nao_finalizadas,
        resumo_executivo: relatorio.resumo_executivo,
        pontos_melhoria: relatorio.pontos_melhoria,
        leads_analisados: relatorio.leads,
      })
      .select("id")
      .single();

    if (!errRelatorio && salvo) {
      relatorioId = salvo.id;
    }
  } catch (err) {
    console.warn("Aviso ao salvar ia_relatorios_diarios:", err);
  }

  // 2. Localiza quadro e colunas do CRM
  let targetQuadroId = quadroId;
  if (!targetQuadroId) {
    const { data: qd } = await supabaseAdmin
      .from("crm_quadros")
      .select("id")
      .eq("owner_id", partnerId)
      .is("arquivado_em", null)
      .limit(1)
      .maybeSingle();
    targetQuadroId = qd?.id;
  }

  if (!targetQuadroId) {
    return { ok: true, relatorioId, cartoesCriadosOuAtualizados: 0 };
  }

  const { data: colunas } = await supabaseAdmin
    .from("crm_colunas")
    .select("id, nome, tipo, posicao")
    .eq("quadro_id", targetQuadroId)
    .order("posicao", { ascending: true });

  const colunaGanho = colunas?.find((c) => c.tipo === "ganho") || colunas?.[colunas.length - 1];
  const colunaPerdido = colunas?.find((c) => c.tipo === "perdido");
  const colunaNegociacao = colunas?.find((c) => c.tipo === "normal" && c.posicao > 1) || colunas?.[0];
  const colunaPrimeira = colunas?.[0];

  let cartoesCriadosOuAtualizados = 0;

  for (const lead of relatorio.leads) {
    try {
      const telLimpo = lead.telefone ? lead.telefone.replace(/\D/g, "") : null;
      let colunaDestinoId = colunaPrimeira?.id;

      if (lead.status_comercial === "venda_ganha" && colunaGanho) {
        colunaDestinoId = colunaGanho.id;
      } else if (lead.status_comercial === "perda_venda" && colunaPerdido) {
        colunaDestinoId = colunaPerdido.id;
      } else if (colunaNegociacao) {
        colunaDestinoId = colunaNegociacao.id;
      }

      if (!colunaDestinoId) continue;

      // Verifica se já existe cartão por telefone ou nome
      let cartaoExistente: any = null;
      if (telLimpo) {
        const { data: c } = await supabaseAdmin
          .from("crm_cartoes")
          .select("id, coluna_id, titulo")
          .eq("quadro_id", targetQuadroId)
          .eq("contato_telefone", telLimpo)
          .is("arquivado_em", null)
          .limit(1)
          .maybeSingle();
        cartaoExistente = c;
      }

      if (!cartaoExistente && lead.nome) {
        const { data: c } = await supabaseAdmin
          .from("crm_cartoes")
          .select("id, coluna_id, titulo")
          .eq("quadro_id", targetQuadroId)
          .ilike("contato_nome", lead.nome.trim())
          .is("arquivado_em", null)
          .limit(1)
          .maybeSingle();
        cartaoExistente = c;
      }

      let cartaoId = cartaoExistente?.id;

      const tagStatus =
        lead.status_comercial === "venda_ganha"
          ? "🎉 Ganho"
          : lead.status_comercial === "perda_venda"
          ? "❌ Perdido"
          : lead.status_comercial === "iniciada_nao_finalizada"
          ? "⚠️ Abandonado"
          : "⏳ Em Aberto";

      const tituloLead = `[${tagStatus}] ${lead.nome || "Cliente WhatsApp"}`;

      if (cartaoExistente) {
        // Atualiza cartão existente
        await supabaseAdmin
          .from("crm_cartoes")
          .update({
            coluna_id: colunaDestinoId,
            valor: lead.valor_estimado ? lead.valor_estimado : undefined,
            prioridade: lead.urgencia === "alta" ? "alta" : lead.urgencia === "baixa" ? "baixa" : "normal",
            descricao: `Auditoria IA (${relatorio.data_referencia}):\n${lead.motivo_status}\n\nAção sugerida: ${lead.acao_recomendada}\nScript: ${lead.mensagem_sugerida}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cartaoId);
      } else {
        // Cria novo cartão no CRM
        const { data: novoCartao, error: errCartao } = await supabaseAdmin
          .from("crm_cartoes")
          .insert({
            quadro_id: targetQuadroId,
            coluna_id: colunaDestinoId,
            titulo: tituloLead,
            contato_nome: lead.nome || null,
            contato_telefone: telLimpo || null,
            valor: lead.valor_estimado || null,
            prioridade: lead.urgencia === "alta" ? "alta" : lead.urgencia === "baixa" ? "baixa" : "normal",
            origem: "whatsapp_retroalimentacao_ia",
            descricao: `Auditoria IA (${relatorio.data_referencia}):\n${lead.motivo_status}\n\nAção sugerida: ${lead.acao_recomendada}\nScript: ${lead.mensagem_sugerida}`,
          })
          .select("id")
          .single();

        if (!errCartao && novoCartao) {
          cartaoId = novoCartao.id;
        }
      }

      if (cartaoId) {
        cartoesCriadosOuAtualizados++;

        // Grava nota na timeline do cartão
        await supabaseAdmin.from("crm_atividades").insert({
          cartao_id: cartaoId,
          tipo: "nota",
          corpo: `🤖 Auditoria IA Retroalimentador (${relatorio.data_referencia})\nStatus: ${tagStatus}\nDiagnóstico: ${lead.motivo_status}\nAção Recomendada: ${lead.acao_recomendada}\nMelhoria para o Vendedor: ${lead.pontos_atencao_vendedor}\nScript Sugerido: "${lead.mensagem_sugerida}"`,
          meta: {
            status_comercial: lead.status_comercial,
            acao_recomendada: lead.acao_recomendada,
            urgencia: lead.urgencia,
            mensagem_sugerida: lead.mensagem_sugerida,
          },
        });
      }
    } catch (eLead) {
      console.warn("Erro ao sincronizar lead individual:", eLead);
    }
  }

  return {
    ok: true,
    relatorioId,
    cartoesCriadosOuAtualizados,
  };
}
