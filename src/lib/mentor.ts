// Regras da tela Mentoria: texto dos alertas, ordem "quem precisa de ajuda primeiro" e frases do dia a dia.
import type { LinhaPainelMentor } from "@/types";

export interface InfoAlerta {
  texto: string;
  /** vermelho = o mentorado está parado; ambar = vale olhar. */
  tom: "vermelho" | "ambar";
  peso: number;
}

export const ALERTAS: Record<string, InfoAlerta> = {
  conexao_sem_sinal: { texto: "WhatsApp sem sinal", tom: "vermelho", peso: 5 },
  analise_com_erro: { texto: "Análise com erro", tom: "vermelho", peso: 4 },
  analise_atrasada: { texto: "Análise atrasada", tom: "ambar", peso: 3 },
  sem_conversa_2_dias: { texto: "2 dias sem conversa", tom: "vermelho", peso: 4 },
  vendas_a_confirmar: { texto: "Vendas para confirmar", tom: "ambar", peso: 2 },
  acesso_vencendo: { texto: "Acesso vencendo", tom: "ambar", peso: 1 },
};

export const infoAlerta = (codigo: string): InfoAlerta =>
  ALERTAS[codigo] ?? { texto: codigo.replace(/_/g, " "), tom: "ambar", peso: 1 };

/** Pontos de atenção da linha: soma do peso de cada alerta. */
export function pontosDeAtencao(linha: Pick<LinhaPainelMentor, "alertas">): number {
  return (linha.alertas || []).reduce((soma, a) => soma + infoAlerta(a).peso, 0);
}

/** Quem tem mais alertas graves vem primeiro; empate: mais clientes esperando resposta, depois o nome. */
export function ordenarPorAtencao<T extends LinhaPainelMentor>(linhas: T[]): T[] {
  return [...linhas].sort(
    (a, b) =>
      pontosDeAtencao(b) - pontosDeAtencao(a) ||
      (b.numeros?.esperando_voce ?? 0) - (a.numeros?.esperando_voce ?? 0) ||
      (a.empresa || "").localeCompare(b.empresa || "", "pt-BR"),
  );
}

export type SituacaoLinha = "ajuda" | "olhar" | "ok";

export function situacaoDaLinha(linha: Pick<LinhaPainelMentor, "alertas">): SituacaoLinha {
  const alertas = linha.alertas || [];
  if (alertas.length === 0) return "ok";
  return alertas.some((a) => infoAlerta(a).tom === "vermelho") ? "ajuda" : "olhar";
}

export const TEXTO_SITUACAO: Record<SituacaoLinha, string> = {
  ajuda: "Precisa de ajuda",
  olhar: "Vale olhar",
  ok: "Tudo certo",
};

/** "visto há 12 min" para a conexão; sem sinal algum, "nunca conectou". */
export function textoSinal(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined || !Number.isFinite(Number(minutos))) return "nunca deu sinal";
  const m = Math.max(0, Math.round(Number(minutos)));
  if (m < 1) return "sinal agora";
  if (m < 60) return `sinal há ${m} min`;
  if (m < 48 * 60) return `sinal há ${Math.round(m / 60)} h`;
  return `sinal há ${Math.round(m / (24 * 60))} dias`;
}

export const resumoDeContagens = (lista: LinhaPainelMentor[]) => ({
  ajuda: lista.filter((l) => situacaoDaLinha(l) === "ajuda").length,
  olhar: lista.filter((l) => situacaoDaLinha(l) === "olhar").length,
  ok: lista.filter((l) => situacaoDaLinha(l) === "ok").length,
});
