// Núcleo do cliente da API, sem dependência do Supabase: testável em node:test.

export type MotivoSaida = "sessao_expirada" | "conta_inativa" | "acesso_expirado";

export const MENSAGEM_SAIDA: Record<MotivoSaida, string> = {
  sessao_expirada: "Sua sessão expirou. Entre de novo.",
  conta_inativa: "Sua conta está inativa, fale com o mentor.",
  acesso_expirado: "Seu acesso expirou, fale com o mentor.",
};

const MENSAGEM_ERRO: Record<string, string> = {
  sem_acesso: "Você não tem acesso a esta empresa.",
  sem_permissao_conteudo: "O mentorado não liberou as conversas para o mentor.",
  so_o_dono: "Só o dono da empresa pode mudar isto.",
  ia_indisponivel: "A análise automática ainda não está ligada no servidor (falta a chave da Anthropic). Avise o mentor.",
  lote_em_andamento: "Esse dia já está em análise, foi concluído ou está sendo gerado. O lote existente foi mantido.",
  lote_indisponivel: "Esse lote já foi analisado ou está sendo analisado.",
  motor_nao_e_api_batch: "A análise automática não está ligada nesta empresa.",
  consentimento_necessario: "Falta a autorização para enviar as conversas à IA.",
  analise_falhou: "A IA não conseguiu analisar este lote agora. Tente de novo em instantes.",
  dono_precisa_liberar: "A empresa já tem dono. Só dá para ligar um usuário a ela depois que o dono liberar o acesso do mentor.",
  admin_nao_entra_em_empresa: "Um admin não entra como membro de empresa de mentorado.",
  dono_nao_pode_ser_admin: "O dono da empresa tem de ser o mentorado, não um admin.",
  senha_so_pelo_proprio_usuario: "Este usuário é de uma empresa que não liberou o mentor: a senha só muda pelo próprio usuário (Esqueci a senha).",
  ...MENSAGEM_SAIDA,
};

/** Erro de /api/*: guarda o status e, no 422 do contrato da IA, a lista de detalhes. */
export class ErroApi extends Error {
  status: number;
  codigo: string | null;
  detalhes: string[];

  constructor(mensagem: string, status: number, codigo: string | null = null, detalhes: string[] = []) {
    super(mensagem);
    this.name = "ErroApi";
    this.status = status;
    this.codigo = codigo;
    this.detalhes = detalhes;
  }
}

/** Monta o ErroApi a partir do corpo {erro, detalhes?} de uma resposta não 2xx. */
export function erroDaResposta(status: number, corpo: any): ErroApi {
  const codigo = typeof corpo?.erro === "string" ? corpo.erro : null;
  const detalhes = Array.isArray(corpo?.detalhes) ? corpo.detalhes.map((d: unknown) => String(d)) : [];
  return new ErroApi((codigo && MENSAGEM_ERRO[codigo]) || codigo || `Erro ${status}`, status, codigo, detalhes);
}

export interface DependenciasApi {
  obterToken: () => Promise<string | null>;
  /** Encerra a sessão local (signOut). */
  sair: () => Promise<unknown>;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

export async function lerJson<T = any>(res: Response): Promise<T | null> {
  return res.json().catch(() => null);
}

export function comQuery(path: string, params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export function criarClienteApi(deps: DependenciasApi) {
  const buscar = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const ouvintes = new Set<(motivo: MotivoSaida) => void>();
  let saindo: Promise<void> | null = null;

  /** O App escuta aqui para voltar ao login com a mensagem certa. */
  function aoPerderAcesso(fn: (motivo: MotivoSaida) => void): () => void {
    ouvintes.add(fn);
    return () => {
      ouvintes.delete(fn);
    };
  }

  // Várias chamadas em paralelo (o polling) podem levar 401 juntas: sai uma vez só.
  function encerrarSessao(motivo: MotivoSaida): Promise<void> {
    if (!saindo) {
      saindo = Promise.resolve()
        .then(() => deps.sair())
        .catch(() => undefined)
        .then(() => ouvintes.forEach((fn) => fn(motivo)))
        .finally(() => {
          saindo = null;
        });
    }
    return saindo;
  }

  /** fetch para /api/* com o Bearer da sessão atual. */
  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await deps.obterToken();

    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (typeof init.body === "string" && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await buscar(path, { ...init, headers });

    // Sem token não havia sessão a derrubar (ex.: polling que disparou durante o logout).
    if (!token) return res;

    if (res.status === 401) {
      await encerrarSessao("sessao_expirada");
    } else if (res.status === 403) {
      const corpo = await res.clone().json().catch(() => null);
      if (corpo?.erro === "conta_inativa" || corpo?.erro === "acesso_expirado") {
        await encerrarSessao(corpo.erro);
      }
    }

    return res;
  }

  /** apiFetch + JSON; lança ErroApi com a mensagem do servidor quando a resposta não é 2xx. */
  async function apiJson<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await apiFetch(path, init);
    const corpo = await lerJson(res);
    if (!res.ok) throw erroDaResposta(res.status, corpo);
    return corpo as T;
  }

  return { apiFetch, apiJson, aoPerderAcesso };
}
