// Comprovantes: imagem ou PDF que o cliente mandou (bucket privado, 90 dias). O navegador nunca vê o arquivo
// direto: pede um link assinado de 60 s ao servidor, que confere se este usuário pode ver o conteúdo.
import { apiJson } from "@/lib/api";
import type { TipoArquivo } from "@/lib/comprovantes-rotulos";

export { rotuloDoArquivo, tipoDoArquivo } from "@/lib/comprovantes-rotulos";
export type { TipoArquivo } from "@/lib/comprovantes-rotulos";

export interface LinkArquivo {
  url: string;
  expira_em: string;
  tipo: TipoArquivo;
}

export const buscarLinkArquivo = (mensagemId: string) =>
  apiJson<LinkArquivo>(`/api/mensagens/${encodeURIComponent(mensagemId)}/arquivo`);

/**
 * Abre o arquivo numa aba nova. A aba é aberta no próprio clique, antes de esperar o servidor: abrir depois do
 * `await` é bloqueado como pop-up. O link vale 60 s, então é pedido só agora.
 */
export async function abrirArquivo(mensagemId: string): Promise<void> {
  const aba = window.open("about:blank", "_blank");
  if (!aba) throw new Error("O navegador bloqueou a janela. Libere pop-ups para este site e tente de novo.");
  try {
    const { url } = await buscarLinkArquivo(mensagemId);
    aba.opener = null;
    aba.location.href = url;
  } catch (e) {
    aba.close();
    throw e;
  }
}
