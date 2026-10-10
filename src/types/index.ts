export type Escopo = "parceiro" | "admin" | "profissional";

export interface Profile {
  id: string;
  user_id?: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: "user" | "admin";
  status: "ativo" | "suspenso" | "expirado";
  expira_em: string | null;
  partner_id: string | null;
  created_at: string;
  partner?: Partner | null;
}

/** Empresa que a conta logada pode acessar (GET /api/me). */
export interface EmpresaAcesso {
  id: string;
  nome: string;
}

export interface MeResposta {
  profile: Pick<Profile, "id" | "name" | "email" | "phone" | "role" | "status" | "expira_em">;
  isAdmin: boolean;
  partners: EmpresaAcesso[];
  /** Ids das empresas em que a conta é dona; faltando (servidor antigo), ninguém é dono. */
  donoDe?: string[];
}

export interface Partner {
  id: string;
  profile_id: string;
  fantasy_name: string;
  city: string | null;
  state: string | null;
  status: string;
  business_area: string | null;
  created_at: string;
}

export type StatusConexao =
  | "conectando"
  | "conectado"
  | "desconectado"
  | "deslogado"
  | "aguardando_qr"
  | "aguardando_codigo"
  | "erro";

export type ModoConexao = "gateway" | "pc";

export interface OpcoesConexao {
  gruposPermitidos: string[];
  /** Só vale no primeiro pareamento (0 a 30, padrão 7). */
  historicoDias: number;
  botAtivo: boolean;
}

export interface GrupoWhatsApp {
  jid: string;
  nome: string | null;
  participantes: number | null;
}

export interface PareamentoConexao {
  estado: string;
  qr?: string | null;
  codigo?: string | null;
  atualizadoEm?: string | null;
}

/** Linha de bot_conexoes como vem no /api/data (sem segredos). Campos da Fase 1 podem faltar. */
export interface Conexao {
  id: string;
  escopo: string;
  owner_id: string | null;
  nome: string;
  provedor: string;
  numero: string | null;
  status: StatusConexao;
  status_detalhe: string | null;
  conectado_em: string | null;
  visto_em: string | null;
  arquivado_em: string | null;
  prioridade: number;
  limite_diario: number | null;
  enviadas_hoje: number;
  contador_dia: string | null;
  bloqueado_em: string | null;
  bloqueado_motivo: string | null;
  uso: string;
  versao: string | null;
  modo?: ModoConexao | "oficial" | null;
  bot_ativo?: boolean | null;
  opcoes?: Partial<OpcoesConexao> | null;
}

/** Item de GET /api/conexoes (tela Conectar WhatsApp). */
export interface ConexaoPainel {
  id: string;
  nome: string;
  numero: string | null;
  modo: ModoConexao;
  status: StatusConexao;
  status_detalhe: string | null;
  visto_em: string | null;
  pareamento: PareamentoConexao | null;
  opcoes: OpcoesConexao;
  grupos_disponiveis: GrupoWhatsApp[];
}

/** Dados brutos do anúncio Click-to-WhatsApp, como o gateway mandou (sem interpretação). */
export interface AnuncioWhatsApp {
  sourceType?: string;
  sourceId?: string;
  sourceUrl?: string;
  ctwaClid?: string;
  titulo?: string;
  corpo?: string;
  conversionSource?: string;
  entryPointConversionSource?: string;
  entryPointConversionApp?: string;
}

export interface MidiaWhatsApp {
  mimetype?: string;
  duracaoSeg?: number;
  ptt?: boolean;
  nomeArquivo?: string;
  tamanho?: number;
  visualizacaoUnica?: boolean;
}

export type PrivacidadeConversa = "normal" | "so_metadados" | "ignorar";

export type EstadoConversa = "bot" | "humano" | "encerrada";

export interface Conversa {
  id: string;
  conexao_id: string;
  /** null em grupo e em contato só por LID (depois da 002). */
  telefone: string | null;
  /** Nome que a pessoa usa no WhatsApp (pushName). */
  nome: string | null;
  fluxo_id: string | null;
  passo_atual_id: string | null;
  estado: EstadoConversa;
  cartao_id: string | null;
  ultima_mensagem_em: string | null;
  created_at: string;
  updated_at: string;
  jid: string | null;
  /** Pessoa (tabela contatos) desta conversa; null enquanto a IA/captura não a criou. */
  contato_id?: string | null;
  conexao?: Conexao;
  ultima_mensagem?: Mensagem;
  // Fase 1 (migração 002): podem faltar num banco ainda não migrado.
  tipo?: "individual" | "grupo" | null;
  lid?: string | null;
  telefone_confirmado?: boolean | null;
  nome_agenda?: string | null;
  grupo_nome?: string | null;
  anuncio?: AnuncioWhatsApp | null;
  privacidade?: PrivacidadeConversa | null;
  ignorar?: boolean | null;
  ultima_entrada_em?: string | null;
  ultima_saida_em?: string | null;
}

export type AutorMensagem = "cliente" | "humano" | "bot" | "crm" | "campanha" | "sistema";

export interface Mensagem {
  id: string;
  conversa_id: string;
  direcao: "entrada" | "saida";
  tipo: string;
  corpo: string | null;
  status: "pendente" | "entregue" | "enviada" | "lida" | "erro" | "recebida";
  agendado_para?: string | null;
  enviada_em?: string | null;
  erro?: string | null;
  wa_id?: string | null;
  created_at: string;
  enviada_por?: string | null;
  disparo_id?: string | null;
  // Fase 1 (migração 002): podem faltar num banco ainda não migrado.
  autor?: AutorMensagem | null;
  wa_em?: string | null;
  momento?: string | null;
  participante_jid?: string | null;
  participante_telefone?: string | null;
  participante_nome?: string | null;
  midia?: MidiaWhatsApp | null;
  citado_wa_id?: string | null;
  anuncio?: AnuncioWhatsApp | null;
  origem_evento?: string | null;
  wa_entregue_em?: string | null;
  wa_lida_em?: string | null;
  editada_em?: string | null;
  apagada_em?: string | null;
  // Migração 006: caminho do comprovante (imagem/PDF do cliente) no bucket privado; só o servidor dá o link.
  arquivo_path?: string | null;
}

export interface Fluxo {
  id: string;
  escopo: string;
  owner_id: string | null;
  nome: string;
  ativo: boolean;
  gatilho_tipo: "primeira_mensagem" | "palavra_chave" | "sempre";
  gatilho_valor: string | null;
  passo_inicial_id: string | null;
  arquivado_em: string | null;
}

export interface Passo {
  id: string;
  fluxo_id: string;
  chave: string;
  tipo: "mensagem" | "pergunta" | "acao" | "transferir" | "encerrar";
  conteudo: string | null;
  posicao: number;
  proximo_passo_id: string | null;
  opcoes?: Opcao[];
}

export interface Opcao {
  id: string;
  passo_id: string;
  rotulo: string;
  gatilho: string;
  proximo_passo_id: string | null;
  posicao: number;
}

export interface QuadroCrm {
  id: string;
  escopo: string;
  owner_id: string | null;
  nome: string;
  tipo: "funil" | "quadro";
  arquivado_em: string | null;
  colunas?: ColunaCrm[];
}

export interface ColunaCrm {
  id: string;
  quadro_id: string;
  nome: string;
  posicao: number;
  cor: string | null;
  tipo: "normal" | "ganho" | "perdido";
  limite_cartoes: number | null;
  cartoes?: CartaoCrm[];
}

export interface CartaoCrm {
  id: string;
  quadro_id: string;
  coluna_id: string;
  posicao: number;
  titulo: string;
  descricao: string | null;
  contato_nome: string | null;
  contato_telefone: string | null;
  contato_email: string | null;
  valor: number | null;
  origem: string | null;
  prioridade: "baixa" | "normal" | "alta";
  vence_em: string | null;
  arquivado_em: string | null;
  created_at: string;
  updated_at: string;
  atividades?: AtividadeCrm[];
}

export interface AtividadeCrm {
  id: string;
  cartao_id: string;
  tipo: "mudanca_coluna" | "whatsapp" | "nota" | "tarefa" | "contato";
  corpo: string | null;
  de_coluna_id: string | null;
  para_coluna_id: string | null;
  created_at: string;
}

export interface DisparoCampanha {
  id: string;
  escopo: string;
  owner_id: string | null;
  nome: string;
  mensagem: string;
  status: "rascunho" | "enfileirando" | "enviando" | "agendado" | "em_andamento" | "concluido" | "cancelado" | "erro";
  intervalo_segundos: number;
  total_alvos: number;
  total_enviados: number;
  total_erros: number;
  iniciado_em: string | null;
  concluido_em: string | null;
  created_at: string;
}

export interface DisparoAlvo {
  id: string;
  disparo_id: string;
  telefone: string;
  nome: string | null;
  status: "pendente" | "enviado" | "erro";
  enviado_em: string | null;
  erro_motivo: string | null;
}

// ---------------------------------------------------------------------------
// Fases 2 e 3: relatório do dia, vendas, pendências e configuração da IA.
// Espelham o CONTRATO DE API FASES 2/3; o servidor segue os mesmos nomes.
// ---------------------------------------------------------------------------

export type MotorIa = "api_batch" | "manual" | "rotina_dono";

export interface ConfigIa {
  motor: MotorIa;
  consentimento_ia_em: string | null;
  limiar_confianca: number;
  autoconfirmar_pix: boolean;
  teto_autoconfirmacao: number;
}

/** PUT /api/ia/config: só os campos enviados mudam. */
export interface AlteracaoConfigIa {
  motor?: MotorIa;
  consentir?: boolean;
  limiar_confianca?: number;
  autoconfirmar_pix?: boolean;
  teto_autoconfirmacao?: number;
}

export type TipoMeta = "novas_conversas" | "followups" | "vendas_qtd" | "vendas_valor" | "tempo_resposta_min";

export interface MetaDiaria {
  tipo: TipoMeta;
  meta: number;
}

export interface MetaRealizada extends MetaDiaria {
  realizado: number | null;
}

export interface MetricasDia {
  novas: number;
  novas_contato_iniciou: number;
  novas_eu_iniciei: number;
  trafego_pago: {
    total: number;
    por_fonte: Record<string, number>;
    por_campanha: Record<string, number>;
  };
  conversas_ativas: number;
  esperando_voce: number;
  cliente_sumiu: number;
  resposta: {
    mediana_min: number | null;
    p90_min: number | null;
    ate5min_pct: number | null;
    acima1h: number;
    sem_resposta: number;
  };
  followups: { vencidos: number; feitos: number; abertos: number };
  vendas: {
    confirmado_valor: number;
    confirmado_qtd: number;
    a_confirmar_valor: number;
    a_confirmar_qtd: number;
  };
  conversao: {
    coorte7d_pct: number | null;
    dia_pct: number | null;
    ganhos: number;
    perdidos: number;
  };
  metas: MetaRealizada[];
}

export type StatusLote = "sem_lote" | "pronto" | "reservado" | "concluido" | "erro";

export interface EstadoLote {
  status: StatusLote;
  partes: number;
  motor: MotorIa | string | null;
}

/** Item de foco: a IA manda {tipo, descricao, quantidade}; texto puro também é aceito. */
export type FocoSugerido = string | { tipo?: string; descricao: string; quantidade?: number | null };
export type DicaMensagem = string | { situacao?: string; mensagem: string };

export interface ResumoAnalise {
  diagnostico: string | null;
  o_que_foi_feito: string | null;
  melhor_estrategia: string | null;
  pontos_melhoria: string[];
  foco_sugerido: FocoSugerido[];
  dicas_mensagens: DicaMensagem[];
  alertas: string[];
}

export type CategoriaContato =
  | "nao_classificado"
  | "cliente"
  | "lead"
  | "parceiro"
  | "fornecedor"
  | "grupo"
  | "pessoal"
  | "equipe"
  | "outro";

export type Prioridade = "alta" | "media" | "baixa";

export interface ProximaAcao {
  tipo: string;
  em_dias: number | null;
  prioridade: Prioridade;
  mensagem_sugerida: string | null;
}

export interface ContatoAnalise {
  contato_id: string;
  nome: string | null;
  /** Resolvido pelo servidor a partir do ref; null em grupo ou número oculto. */
  telefone: string | null;
  categoria: CategoriaContato;
  confianca: number | null;
  etapa_funil: string | null;
  tags: string[];
  status_comercial: string | null;
  riscos: string[];
  motivo_perda: { codigo: string; detalhe: string | null } | null;
  proxima_acao: ProximaAcao | null;
  sugestao_id: string | null;
  produto_sugerido: string | null;
  como_abordar: string | null;
  resumo: string | null;
}

export interface RelatorioDia {
  dia: string;
  fuso: string;
  metricas: MetricasDia;
  lote: EstadoLote | null;
  analise: { resumo: ResumoAnalise | null; texto_oculto?: boolean; contatos: ContatoAnalise[] } | null;
}

export type MotivoPendencia = "esperando_voce" | "followup_vencido" | "cliente_sumiu";

export interface Pendencia {
  contato_id: string;
  nome: string | null;
  telefone: string | null;
  motivo: MotivoPendencia;
  ha_horas: number | null;
  etapa: string | null;
  mensagem_sugerida: string | null;
  sugestao_id: string | null;
}

export type StatusVenda = "pendente_confirmacao" | "confirmada" | "rejeitada" | "estornada";
export type FonteVenda = "ia" | "manual" | "gateway";
export type FormaPagamento =
  | "pix"
  | "cartao"
  | "boleto"
  | "dinheiro"
  | "transferencia"
  | "link_pagamento"
  | "outro"
  | "desconhecida";

export interface Venda {
  id: string;
  dia: string;
  valor: number | null;
  forma: FormaPagamento | null;
  produto: string | null;
  status: StatusVenda;
  fonte: FonteVenda;
  contato: { id: string; nome: string | null; telefone: string | null } | null;
  evidencia_trecho: string | null;
  alerta: string | null;
  // Mensagem do cliente com imagem/PDF (a prova, ou o último arquivo da conversa): só nas vendas a confirmar.
  comprovante_mensagem_id?: string | null;
  // Leitura da IA do comprovante (só pista, já mascarada) e alertas de conferência; só nas vendas a confirmar.
  comprovante_leitura?: { resumo: string; alertas: string[] } | null;
  criado_em: string;
}

export interface VendasResposta {
  vendas: Venda[];
  totais: {
    confirmado: number;
    a_confirmar: number;
    por_forma: Record<string, number>;
    por_origem: Record<string, number>;
  };
}

export interface NovaVendaManual {
  partnerId: string;
  contatoId?: string;
  telefone?: string;
  nome?: string;
  valor: number;
  forma: FormaPagamento;
  produto?: string;
  dia?: string;
}

export interface DecisaoVenda {
  acao: "confirmar" | "rejeitar";
  valor?: number;
  motivo?: string;
}

export interface Produto {
  id: string;
  nome: string;
  preco: number | null;
  preco_minimo: number | null;
  descricao_curta: string | null;
  ativo?: boolean;
}

export interface DadosProduto {
  nome: string;
  preco: number | null;
  preco_minimo?: number | null;
  descricao_curta?: string | null;
}

export type ModoRastreio = "exata" | "contem";

export interface MensagemRastreio {
  id: string;
  nome_campanha: string;
  mensagem_inicial: string;
  modo: ModoRastreio;
  ativo?: boolean;
}

export interface DadosRastreio {
  nome_campanha: string;
  mensagem_inicial: string;
  modo: ModoRastreio;
}

export interface CorrecaoContato {
  categoria?: CategoriaContato;
  tags?: string[];
  origem_tipo?: string;
}

export interface RespostaSugestao {
  acao: "usou" | "editou" | "descartou";
  texto_final?: string;
  motivo?: string;
}

export interface LoteIa {
  id: string;
  dia: string;
  parte: number;
  status: string;
  tokens_estimados: number | null;
}

export interface LoteGerado {
  id: string;
  parte: number;
  status: string;
}

export interface ResultadoImportacao {
  ok: boolean;
  analise_id: string;
  duplicado?: boolean;
  resultado: {
    contatos?: number;
    cartoes_novos?: number;
    cartoes_movidos?: number;
    etiquetas?: number;
    tarefas?: number;
    vendas_confirmadas?: number;
    vendas_pendentes?: number;
    rejeitados?: unknown[];
    avisos?: unknown[];
  } | null;
}

export interface TokenIa {
  id: string;
  nome: string;
  partner_ids: string[];
  criado_em: string | null;
  ultimo_uso_em: string | null;
  revogado_em: string | null;
}

// ------------------------------------------------------------------- visão do mentor
export interface ConexaoDoMentor {
  id: string;
  nome: string | null;
  modo: string | null;
  status: string;
  visto_em: string | null;
  minutos_sem_sinal: number | null;
}

/** Uma linha de GET /api/mentor/painel (função mentor_painel): só números e estados. */
export interface LinhaPainelMentor {
  partner_id: string;
  empresa: string;
  mentorado: string | null;
  expira_em: string | null;
  opt_in: boolean;
  dia: string;
  conexoes: ConexaoDoMentor[];
  numeros: {
    novas: number | null;
    trafego_pago: number | null;
    esperando_voce: number | null;
    cliente_sumiu: number | null;
    resposta_mediana_min: number | null;
    resposta_p90_min: number | null;
    followups_vencidos: number | null;
    vendas_confirmado_qtd: number | null;
    vendas_confirmado_valor: number | null;
    vendas_a_confirmar_qtd: number | null;
    vendas_a_confirmar_valor: number | null;
    conversao_dia_pct: number | null;
    conversao_coorte7d_pct: number | null;
  };
  metas: MetaRealizada[];
  vendas_a_confirmar: number;
  /** Do dia anterior ao pedido: o lote do dia D só sai depois das 04:30 de D+1. */
  relatorio: { dia: string; lote: string | null; analise: string | null; partes: number | null };
  ultima_atividade: string | null;
  alertas: string[];
}

export interface PainelMentor {
  dia: string | null;
  empresas: LinhaPainelMentor[];
}

/** GET /api/mentor/empresas/:partnerId/relatorio: contatos só vêm com opt_in. */
export interface RelatorioMentor extends RelatorioDia {
  empresa: { id: string; nome: string };
  opt_in: boolean;
}

export interface PrivacidadeEmpresa {
  mentorPodeVerConversas: boolean;
  mentorPodeVerConversasEm: string | null;
}
