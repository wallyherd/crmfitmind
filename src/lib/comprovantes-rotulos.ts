// Parte pura de comprovantes.ts (sem chamar a API), para testar com `node --test`.
export type TipoArquivo = "imagem" | "pdf";

/** Pelo caminho guardado na mensagem (…/waId.pdf) dá para saber o tipo antes de pedir o link. */
export function tipoDoArquivo(caminho: string | null | undefined): TipoArquivo | null {
  if (!caminho) return null;
  return /\.pdf$/i.test(caminho) ? "pdf" : "imagem";
}

export const rotuloDoArquivo = (tipo: TipoArquivo | null | undefined) => (tipo === "pdf" ? "Ver PDF" : "Ver imagem");
