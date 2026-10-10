// Regras da tela "Apagar todos os dados desta pessoa (LGPD)". Sem React, para testar com node:test.

export const PALAVRA_DE_SEGURANCA = "APAGAR";

/** Resposta de DELETE /api/contatos/:id (server/rotas/ia.ts). */
export interface RespostaApagarContato {
  ok: boolean;
  apagado: boolean;
  /** Caminhos do Storage que o banco já desvinculou mas o servidor não conseguiu remover; ficam pendentes e a manutenção tenta de novo. */
  arquivos_com_falha?: string[];
}

export interface DesfechoApagar {
  tipo: "sucesso" | "aviso" | "info";
  mensagem: string;
}

/** O que some quando a pessoa é apagada: mostrado antes da confirmação. */
export const O_QUE_SOME = [
  "as conversas e as mensagens dela",
  "o cartão no funil e as tarefas de acompanhamento",
  "as vendas ligadas a ela (ficam só como número, sem identificar a pessoa)",
  "as análises e sugestões da IA sobre ela",
  "os arquivos de conversa enviados à IA que a citavam",
];

export function frasePronta(digitado: string): boolean {
  return digitado.trim() === PALAVRA_DE_SEGURANCA;
}

/** Só o dono da empresa vê o botão (o servidor confere de novo). */
export function podeApagarDados(donoDe: string[] | undefined, empresaId: string | null | undefined, contatoId: string | null | undefined): boolean {
  return !!empresaId && !!contatoId && !!donoDe && donoDe.includes(empresaId);
}

export function desfechoDaResposta(r: RespostaApagarContato | null | undefined): DesfechoApagar {
  if (!r || r.apagado !== true) {
    return { tipo: "info", mensagem: "Esta pessoa já não estava mais no CRM." };
  }
  if (r.arquivos_com_falha && r.arquivos_com_falha.length > 0) {
    const n = r.arquivos_com_falha.length;
    return {
      tipo: "aviso",
      mensagem: `Pessoa apagada do CRM, mas ${n === 1 ? "1 arquivo" : `${n} arquivos`} de conversa não pôde ser removido do armazenamento agora. A limpeza ficou agendada e o sistema tenta de novo sozinho (a próxima manutenção).`,
    };
  }
  return { tipo: "sucesso", mensagem: "Todos os dados desta pessoa foram apagados." };
}

/** 403 so_o_dono, 404 e o resto, em linguagem de gente. */
export function mensagemDeErroApagar(erro: unknown): string {
  const e = erro as { status?: number; codigo?: string | null; message?: string } | null;
  // O código vem antes do status: um 403 sem_permissao_conteudo não é "só o dono".
  if (e?.codigo === "sem_permissao_conteudo") return "O mentorado não liberou as conversas, então não dá para apagar daqui.";
  if (e?.codigo === "so_o_dono" || (e?.status === 403 && !e?.codigo)) return "Só o dono da empresa pode apagar os dados de uma pessoa.";
  if (e?.status === 404 || e?.codigo === "nao_encontrado") return "Esta pessoa não foi encontrada (talvez já tenha sido apagada).";
  return e?.message || "Não foi possível apagar agora. Tente de novo.";
}
