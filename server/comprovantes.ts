// Comprovantes: imagem ou PDF que o CLIENTE manda, no bucket privado 'comprovantes' (migração 006).
// Só a service role lê e grava; o navegador recebe um link assinado de 60 s (GET /api/mensagens/:id/arquivo).
import type { Db } from "./supabase.js";

export const BUCKET_COMPROVANTES = "comprovantes";
// A Vercel recebe até ~4,5 MB por chamada: 4 MB de arquivo é o teto (o mesmo do bucket).
export const MAX_COMPROVANTE_BYTES = 4 * 1024 * 1024;
export const VALIDADE_LINK_SEG = 60;

export const MIMETYPES_COMPROVANTE = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type MimetypeComprovante = (typeof MIMETYPES_COMPROVANTE)[number];

export const mimetypePermitido = (valor: unknown): MimetypeComprovante | null => {
  const m = String(valor ?? "").split(";")[0].trim().toLowerCase();
  return (MIMETYPES_COMPROVANTE as readonly string[]).includes(m) ? (m as MimetypeComprovante) : null;
};

// O mimetype vem do remetente: confere se os primeiros bytes são mesmo do tipo dito.
export function bytesConferem(mimetype: MimetypeComprovante, b: Buffer): boolean {
  switch (mimetype) {
    case "image/jpeg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/pdf":
      return b.subarray(0, 1024).toString("latin1").includes("%PDF-");
  }
}

export async function subirComprovante(db: Db, caminho: string, corpo: Buffer, mimetype: MimetypeComprovante): Promise<string | null> {
  const { error } = await db.storage.from(BUCKET_COMPROVANTES).upload(caminho, corpo, { contentType: mimetype, upsert: true });
  return error ? String(error.message ?? error) : null;
}

// Apaga do Storage e, só se saiu, tira da fila do banco (comprovantes_apagar). Se o Storage falhar, o caminho
// continua na fila e a manutenção (/api/cron/manutencao) tenta de novo.
export async function apagarComprovantes(db: Db, caminhos: string[]): Promise<{ apagados: number; falha: string | null }> {
  const lista = [...new Set(caminhos.filter((c) => typeof c === "string" && c))];
  let apagados = 0;
  for (let i = 0; i < lista.length; i += 100) {
    const lote = lista.slice(i, i + 100);
    const { error } = await db.storage.from(BUCKET_COMPROVANTES).remove(lote);
    if (error) return { apagados, falha: String(error.message ?? error) };
    const { data, error: erroMarca } = await db.rpc("comprovantes_marcar_apagados", { _caminhos: lote });
    if (erroMarca) return { apagados, falha: String(erroMarca.message ?? erroMarca) };
    apagados += Number(data ?? 0);
  }
  return { apagados, falha: null };
}

export async function linkDoComprovante(db: Db, caminho: string): Promise<string | null> {
  const { data, error } = await db.storage.from(BUCKET_COMPROVANTES).createSignedUrl(caminho, VALIDADE_LINK_SEG);
  return error || !data?.signedUrl ? null : data.signedUrl;
}
