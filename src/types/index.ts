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

export interface Conexao {
  id: string;
  escopo: string;
  owner_id: string | null;
  nome: string;
  provedor: string;
  numero: string | null;
  status: "desconectado" | "aguardando_qr" | "conectado" | "erro";
  status_detalhe: string | null;
  webhook_segredo: string;
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
}

export interface Conversa {
  id: string;
  conexao_id: string;
  telefone: string;
  nome: string | null;
  fluxo_id: string | null;
  passo_atual_id: string | null;
  estado: "bot" | "humano" | "encerrada";
  cartao_id: string | null;
  ultima_mensagem_em: string | null;
  created_at: string;
  updated_at: string;
  jid: string | null;
  conexao?: Conexao;
  ultima_mensagem?: Mensagem;
}

export interface Mensagem {
  id: string;
  conversa_id: string;
  direcao: "entrada" | "saida";
  tipo: "texto" | "imagem" | "audio" | "video" | "documento";
  corpo: string | null;
  status: "pendente" | "entregue" | "enviada" | "lida" | "erro" | "recebida";
  agendado_para?: string | null;
  enviado_em?: string | null;
  erro_motivo?: string | null;
  created_at: string;
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
  status: "rascunho" | "agendado" | "em_andamento" | "concluido" | "cancelado" | "erro";
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
