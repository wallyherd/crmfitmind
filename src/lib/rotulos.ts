// Textos em português simples para os códigos que vêm do servidor e da IA.

/** Rótulo de um código; o que não estiver no mapa vira "Primeira letra maiúscula, sem _". */
export function rotulo(mapa: Record<string, string>, codigo: string | null | undefined): string {
  if (!codigo) return "—";
  if (mapa[codigo]) return mapa[codigo];
  const texto = codigo.replace(/_/g, " ").trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export const CATEGORIAS: Record<string, string> = {
  nao_classificado: "Não classificado",
  cliente: "Cliente",
  lead: "Interessado (lead)",
  parceiro: "Parceiro",
  fornecedor: "Fornecedor",
  grupo: "Grupo",
  pessoal: "Pessoal",
  equipe: "Equipe",
  outro: "Outro",
};

/** O que o mentorado pode escolher ao corrigir (grupo é regra do sistema, não escolha). */
export const CATEGORIAS_EDITAVEIS = ["cliente", "lead", "parceiro", "fornecedor", "pessoal", "equipe", "outro"];

export const ETAPAS: Record<string, string> = {
  novo_contato: "Novo contato",
  em_atendimento: "Em atendimento",
  proposta_enviada: "Proposta enviada",
  negociando: "Negociando",
  aguardando_pagamento: "Aguardando pagamento",
  ganho: "Ganho",
  perdido: "Perdido",
  pos_venda: "Pós-venda",
  nao_se_aplica: "Fora do funil",
};

export const STATUS_COMERCIAL: Record<string, string> = {
  venda_ganha: "Vendeu",
  perda_venda: "Perdeu a venda",
  em_aberto: "Em aberto",
  iniciada_nao_finalizada: "Começou e parou",
  sem_interesse_comercial: "Sem interesse comercial",
};

export const RISCOS: Record<string, string> = {
  esperando_voce: "Esperando você",
  cliente_sumiu: "Cliente sumiu",
  sem_resposta_nossa: "Sem resposta sua",
  followup_atrasado: "Follow-up atrasado",
  objecao_nao_tratada: "Objeção sem resposta",
  esfriando: "Esfriando",
  promessa_nao_cumprida: "Promessa não cumprida",
  // nome antigo (antes da C6), caso venha de análise velha
  vacuo: "Cliente sumiu",
};

export const MOTIVOS_PERDA: Record<string, string> = {
  preco: "Preço",
  sem_resposta: "Parou de responder",
  concorrente: "Foi para o concorrente",
  timing: "Não era a hora",
  sem_necessidade: "Não precisava",
  confianca: "Faltou confiança",
  forma_pagamento: "Forma de pagamento",
  atendimento_demorado: "Atendimento demorado",
  outro: "Outro motivo",
};

export const ACOES: Record<string, string> = {
  responder_agora: "Responder agora",
  followup: "Fazer follow-up",
  enviar_proposta: "Enviar proposta",
  cobrar_pagamento: "Cobrar pagamento",
  confirmar_pagamento: "Confirmar pagamento",
  pos_venda: "Pós-venda",
  reativar: "Reativar contato",
  nenhuma: "Nada a fazer",
};

export const PRIORIDADES: Record<string, string> = { alta: "Urgente", media: "Normal", baixa: "Pode esperar" };

export const MOTIVOS_PENDENCIA: Record<string, string> = {
  esperando_voce: "Esperando você",
  followup_vencido: "Follow-up vencido",
  cliente_sumiu: "Cliente sumiu",
};

export const FORMAS_PAGAMENTO: Record<string, string> = {
  pix: "PIX",
  cartao: "Cartão",
  boleto: "Boleto",
  dinheiro: "Dinheiro",
  transferencia: "Transferência",
  link_pagamento: "Link de pagamento",
  outro: "Outro",
  desconhecida: "Não informada",
};

/** Formas que o mentorado escolhe na venda manual. */
export const FORMAS_ESCOLHA = ["pix", "cartao", "boleto", "dinheiro", "transferencia", "link_pagamento", "outro"];

export const STATUS_VENDA: Record<string, string> = {
  pendente_confirmacao: "A confirmar",
  confirmada: "Confirmada",
  rejeitada: "Não foi venda",
  estornada: "Estornada",
};

export const FONTES_VENDA: Record<string, string> = { ia: "IA", manual: "Manual", gateway: "Pagamento online" };

/** Chaves de totais.por_origem: origem do contato ou quem lançou a venda. */
export const ORIGENS: Record<string, string> = {
  trafego_pago: "Tráfego pago",
  organico: "Orgânico",
  indicacao: "Indicação",
  base_existente: "Clientes antigos",
  desconhecido: "Sem origem",
  ...FONTES_VENDA,
};

export const FONTES_TRAFEGO: Record<string, string> = {
  ctwa: "Clique no anúncio",
  rastreio: "Mensagem do anúncio",
  resposta_lead: "O cliente contou",
};

export const STATUS_LOTE: Record<string, { texto: string; tom: "neutro" | "fila" | "ok" | "erro" }> = {
  sem_lote: { texto: "Sem lote", tom: "neutro" },
  pronto: { texto: "Na fila", tom: "fila" },
  reservado: { texto: "Na fila (em análise)", tom: "fila" },
  concluido: { texto: "Analisado", tom: "ok" },
  erro: { texto: "Erro", tom: "erro" },
};

export const MOTORES: Record<string, string> = {
  api_batch: "API automática",
  manual: "Manual no meu Claude",
  rotina_dono: "Rotina do dono (Claude Code)",
};

export const METAS: Record<string, { texto: string; unidade: "qtd" | "brl" | "min" }> = {
  novas_conversas: { texto: "Conversas novas", unidade: "qtd" },
  followups: { texto: "Follow-ups feitos", unidade: "qtd" },
  vendas_qtd: { texto: "Vendas (quantidade)", unidade: "qtd" },
  vendas_valor: { texto: "Vendas (R$)", unidade: "brl" },
  tempo_resposta_min: { texto: "Tempo de resposta (máx. em min)", unidade: "min" },
};

export const TIPOS_META = ["novas_conversas", "followups", "vendas_qtd", "vendas_valor", "tempo_resposta_min"] as const;

/** Etiqueta da IA: "objecao_preco" -> "objecao preco". */
export function etiquetaLegivel(tag: string): string {
  return tag.replace(/_/g, " ");
}
