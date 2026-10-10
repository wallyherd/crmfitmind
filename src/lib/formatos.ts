// Formatação e contas pequenas das telas comerciais. Sem React e sem DOM: testável em node:test.

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function doisDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/** Data local no formato YYYY-MM-DD (o "hoje" de quem está olhando a tela). */
export function dataIso(data: Date): string {
  return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

export function hojeIso(agora: Date = new Date()): string {
  return dataIso(agora);
}

/** O "hoje" num fuso fixo (AAAA-MM-DD). A tela do mentor usa o das empresas, não o do navegador dele. */
export function hojeNoFuso(fuso: string, agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export const FUSO_PADRAO = "America/Cuiaba";

/** Soma dias a uma data YYYY-MM-DD sem passar por fuso (meio-dia evita pulo de horário de verão). */
export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a, m - 1, d, 12);
  data.setDate(data.getDate() + dias);
  return dataIso(data);
}

export function ontemIso(agora: Date = new Date()): string {
  return somarDias(hojeIso(agora), -1);
}

export type FiltroPeriodo = "hoje" | "7d" | "mes";

/** Intervalo fechado [de, ate] de cada filtro rápido da aba Vendas. */
export function intervaloDoFiltro(filtro: FiltroPeriodo, agora: Date = new Date()): { de: string; ate: string } {
  const hoje = hojeIso(agora);
  if (filtro === "hoje") return { de: hoje, ate: hoje };
  if (filtro === "7d") return { de: somarDias(hoje, -6), ate: hoje };
  return { de: `${hoje.slice(0, 8)}01`, ate: hoje };
}

export function ehDataIso(texto: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto);
}

/**
 * "2026-10-05" -> "05/10/2026" sem passar por Date (não muda de dia por fuso).
 * Data e hora (timestamptz) vira a data local de quem está olhando.
 */
export function dataBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (iso.length > 10 && iso.includes("T")) {
    const data = new Date(iso);
    if (!Number.isNaN(data.getTime())) return dataBr(dataIso(data));
  }
  const [a, m, d] = iso.slice(0, 10).split("-");
  if (!a || !m || !d) return iso;
  return `${d}/${m}/${a}`;
}

/** Data com dia da semana, para o título do relatório: "dom., 05/10/2026". */
export function dataComSemana(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const semana = new Date(a, m - 1, d, 12).toLocaleDateString("pt-BR", { weekday: "short" });
  return `${semana}, ${dataBr(iso)}`;
}

export function brl(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return "—";
  return BRL.format(Number(valor));
}

export function pct(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(Number(valor))) return "—";
  return `${Number(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

/** Minutos de tempo de resposta: "4 min", "1h 39min", "2 dias". */
export function duracaoMin(minutos: number | null | undefined): string {
  if (minutos === null || minutos === undefined || !Number.isFinite(Number(minutos))) return "—";
  const total = Math.round(Number(minutos));
  if (total < 60) return `${total} min`;
  if (total < 48 * 60) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m ? `${h}h ${m}min` : `${h}h`;
  }
  return `${Math.round(total / (24 * 60))} dias`;
}

/** Há quanto tempo, a partir de horas: "há 25 min", "há 3 h", "há 4 dias". */
export function haQuantoTempo(horas: number | null | undefined): string {
  if (horas === null || horas === undefined || !Number.isFinite(Number(horas))) return "";
  const h = Number(horas);
  if (h < 1) return `há ${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `há ${Math.round(h)} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/**
 * Prazo da próxima ação: a IA conta em_dias a partir do dia seguinte ao relatório
 * (vence em dia + 1 + em_dias). Fala "hoje", "amanhã", "até 12/10" ou "venceu em 03/10".
 */
export function prazoDaAcao(diaRelatorio: string, emDias: number | null | undefined, agora: Date = new Date()): string {
  if (emDias === null || emDias === undefined || !ehDataIso(diaRelatorio)) return "";
  const alvo = somarDias(diaRelatorio, 1 + Math.max(0, emDias));
  const hoje = hojeIso(agora);
  const ddmm = dataBr(alvo).slice(0, 5);
  if (alvo < hoje) return `venceu em ${ddmm}`;
  if (alvo === hoje) return "hoje";
  if (alvo === somarDias(hoje, 1)) return "amanhã";
  return `até ${ddmm}`;
}

export function soDigitos(texto: string | null | undefined): string {
  return (texto || "").replace(/\D/g, "");
}

/** Número para o wa.me: só dígitos, com 55 quando vier sem DDI. null se não der para discar. */
export function numeroWhatsApp(telefone: string | null | undefined): string | null {
  const digitos = soDigitos(telefone);
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length >= 12 && digitos.length <= 15) return digitos;
  return null;
}

export function linkWhatsApp(telefone: string | null | undefined, texto?: string | null): string | null {
  const numero = numeroWhatsApp(telefone);
  if (!numero) return null;
  const msg = (texto || "").trim();
  return msg ? `https://wa.me/${numero}?text=${encodeURIComponent(msg)}` : `https://wa.me/${numero}`;
}

/** "5565999990002" -> "(65) 99999-0002"; o que não reconhece volta como veio. */
export function telefoneLegivel(telefone: string | null | undefined): string {
  const d = soDigitos(telefone);
  const local = d.length >= 12 && d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return telefone || "";
}

/** Valor digitado em reais ("1.234,50", "497", "97.5") -> número; null se não for valor válido. */
export function lerValor(texto: string | number | null | undefined): number | null {
  if (typeof texto === "number") return Number.isFinite(texto) && texto >= 0 ? texto : null;
  let s = (texto || "").replace(/[R$\s]/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * Tira o JSON do que o mentorado colou do Claude: aceita bloco ```json ... ``` e texto
 * antes ou depois. Devolve o trecho do primeiro "{" ao último "}", ou null.
 */
export function extrairJson(colado: string): string | null {
  const texto = (colado || "").trim();
  const bloco = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const miolo = (bloco ? bloco[1] : texto).trim();
  const ini = miolo.indexOf("{");
  const fim = miolo.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  return miolo.slice(ini, fim + 1);
}

/** Valor de um mapa de totais: aceita número ou {valor}. */
export function valorDoTotal(item: unknown): number {
  if (typeof item === "number") return item;
  if (item && typeof item === "object" && "valor" in item) return Number((item as { valor: unknown }).valor) || 0;
  return Number(item) || 0;
}

/** Pares de um mapa {chave: valor}, do maior para o menor, sem zeros. */
export function paresOrdenados(mapa: Record<string, unknown> | null | undefined): Array<[string, number]> {
  return Object.entries(mapa || {})
    .map(([k, v]) => [k, valorDoTotal(v)] as [string, number])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => b[1] - a[1]);
}

/** Meta de tempo de resposta é "quanto menor, melhor"; as outras, "quanto maior, melhor". */
export function metaBatida(tipo: string, meta: number, realizado: number | null | undefined): boolean {
  if (realizado === null || realizado === undefined) return false;
  return tipo === "tempo_resposta_min" ? realizado <= meta : realizado >= meta;
}

/** Progresso 0–100 da barra da meta. */
export function progressoMeta(tipo: string, meta: number, realizado: number | null | undefined): number {
  if (realizado === null || realizado === undefined || !meta) return 0;
  if (tipo === "tempo_resposta_min") return realizado <= meta ? 100 : Math.max(5, Math.round((meta / realizado) * 100));
  return Math.min(100, Math.round((realizado / meta) * 100));
}
