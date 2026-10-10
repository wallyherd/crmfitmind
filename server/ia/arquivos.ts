// Arquivos do lote no bucket privado 'conversas-ia' (só a service role lê e grava) e o texto final que
// cada motor recebe: o .txt do Storage com a linha de CONTEXTO recalculada e, se houver, a reserva.
import type { Db } from "../supabase.js";

export const BUCKET_IA = "conversas-ia";

export async function subirArquivo(db: Db, caminho: string, texto: string): Promise<string | null> {
  const { error } = await db.storage.from(BUCKET_IA).upload(caminho, Buffer.from(texto, "utf8"), { contentType: "text/plain; charset=utf-8", upsert: true });
  return error ? String(error.message ?? error) : null;
}

export async function baixarArquivo(db: Db, caminho: string): Promise<string | null> {
  const { data, error } = await db.storage.from(BUCKET_IA).download(caminho);
  if (error || !data) return null;
  return data.text();
}

export async function apagarArquivos(db: Db, caminhos: string[]): Promise<string | null> {
  for (let i = 0; i < caminhos.length; i += 100) {
    const { error } = await db.storage.from(BUCKET_IA).remove(caminhos.slice(i, i + 100));
    if (error) return String(error.message ?? error);
  }
  return null;
}

export type LoteParaTexto = { id: string; arquivo_path: string; arquivo_apagado_em?: string | null };

// C1: o arquivo no Storage é a fonte; aqui só entram a reserva (#@ reserva_id) e a linha de CONTEXTO do
// parceiro, recalculada na hora para refletir o que o mentorado corrigiu depois da exportação.
export async function montarLoteTxt(db: Db, lote: LoteParaTexto, reservaId: string | null): Promise<string | null> {
  if (lote.arquivo_apagado_em) return null;
  const base = await baixarArquivo(db, lote.arquivo_path);
  if (base === null) return null;
  const { data: contexto, error } = await db.rpc("ia_montar_contexto", { _lote_id: lote.id });
  if (error) throw error;

  const linhas = base.split("\n");
  const i = linhas.indexOf("### CONTEXTO");
  if (i >= 0 && typeof contexto === "string" && contexto) linhas[i + 1] = contexto;
  if (reservaId) {
    const k = linhas.findIndex((l) => l.startsWith("#@ linhas: "));
    const n = k >= 0 ? Number(linhas[k].slice("#@ linhas: ".length)) : NaN;
    if (Number.isFinite(n)) linhas[k] = `#@ linhas: ${n + 1}`;
    const f = linhas.findIndex((l) => l.startsWith("#@ fuso: "));
    if (f >= 0) linhas.splice(f + 1, 0, `#@ reserva_id: ${reservaId}`);
  }
  return linhas.join("\n");
}
