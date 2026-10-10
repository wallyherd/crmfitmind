import { apiFetch, comQuery, lerJson } from "@/lib/api";
import { mensagemErroDownload, nomeDoArquivo } from "@/lib/whatsapp";

/**
 * Baixa um arquivo de /api/* com o Bearer da sessão: um <a href> direto não levaria o Authorization.
 * O conteúdo só passa pela memória do navegador; nada é guardado no servidor.
 */
export async function baixarArquivoDaApi(caminho: string, nomePadrao: string): Promise<void> {
  const res = await apiFetch(caminho);
  if (!res.ok) {
    const corpo = await lerJson(res);
    throw new Error(mensagemErroDownload(res.status, corpo?.erro));
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeDoArquivo(res.headers.get("Content-Disposition"), nomePadrao);
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Alguns navegadores leem o blob depois do click: libera um pouco mais tarde.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function baixarDiaCompleto(partnerId: string, dia: string) {
  return baixarArquivoDaApi(
    comQuery("/api/conversas/dia-completo.txt", { partnerId, dia }),
    `conversas-completas-${dia}.txt`
  );
}

export function baixarConversaCompleta(conversaId: string, periodo: { de?: string; ate?: string } = {}) {
  return baixarArquivoDaApi(
    comQuery(`/api/conversas/${encodeURIComponent(conversaId)}/completa.txt`, { de: periodo.de, ate: periodo.ate }),
    `conversa-completa-${conversaId.slice(0, 8)}.txt`
  );
}
