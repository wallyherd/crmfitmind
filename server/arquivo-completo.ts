// Arquivo COMPLETO de conversas (.txt) que só o dono baixa: conversa exata, telefone e
// nome do WhatsApp. Nunca vai para a IA nem para o Storage; é montado na hora, em memória.
// Funções puras (sem banco) para testar o formato e o fuso sem servidor.

export const CABECALHO_ARQUIVO = "ARQUIVO COMPLETO — USO INTERNO — NÃO ENVIAR PARA IA";
export const FUSO_PADRAO = "America/Cuiaba";
const SEPARADOR = "=".repeat(64);
const LINHA = "-".repeat(64);

export type ConversaArquivo = {
  id: string;
  tipo?: string | null;
  telefone?: string | null;
  nome?: string | null;
  jid?: string | null;
  lid?: string | null;
  grupo_nome?: string | null;
  privacidade?: string | null;
  conexao_nome?: string | null;
  conexao_numero?: string | null;
  anuncio?: Record<string, unknown> | null;
  nome_celular?: string | null;
};

export type MensagemArquivo = {
  conversa_id: string;
  momento: string;
  direcao: string;
  autor?: string | null;
  tipo?: string | null;
  corpo?: string | null;
  midia?: Record<string, unknown> | null;
  participante_nome?: string | null;
  participante_telefone?: string | null;
  editada_em?: string | null;
  apagada_em?: string | null;
};

// ---------------------------------------------------------------- datas e fuso

export function fusoValido(fuso: unknown): string {
  if (typeof fuso !== "string" || !fuso) return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

export function dataValida(dia: unknown): dia is string {
  if (typeof dia !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCFullYear() === a && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function proximoDia(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10);
}

function partes(ms: number, fuso: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return { ano: +v.year, mes: +v.month, dia: +v.day, hora: +v.hour, minuto: +v.minute, segundo: +v.second };
}

// Quanto o relógio do fuso está à frente do UTC naquele instante (negativo no Brasil).
function deslocamentoMs(fuso: string, ms: number): number {
  const p = partes(ms, fuso);
  return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo) - Math.floor(ms / 1000) * 1000;
}

// Meia-noite do dia no fuso da empresa, como instante UTC (duas passadas por causa do horário de verão).
export function inicioDoDia(dia: string, fuso: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  const base = Date.UTC(a, m - 1, d);
  let t = base - deslocamentoMs(fuso, base);
  t = base - deslocamentoMs(fuso, t);
  return new Date(t);
}

const dois = (n: number) => String(n).padStart(2, "0");

/** "DD/MM HH:MM" no fuso da empresa. */
export function formatarQuando(momento: string | number | Date, fuso: string): string {
  const p = partes(new Date(momento).getTime(), fuso);
  return `${dois(p.dia)}/${dois(p.mes)} ${dois(p.hora)}:${dois(p.minuto)}`;
}

function formatarDiaCompleto(dia: string): string {
  const [a, m, d] = dia.split("-");
  return `${d}/${m}/${a}`;
}

function formatarAgora(agora: Date, fuso: string): string {
  const p = partes(agora.getTime(), fuso);
  return `${dois(p.dia)}/${dois(p.mes)}/${p.ano} ${dois(p.hora)}:${dois(p.minuto)}`;
}

// ---------------------------------------------------------------- textos

/** "5565999990000" -> "+55 65 99999-0000". Fora do Brasil, só o "+" na frente. */
export function formatarTelefone(valor: string | null | undefined): string {
  const d = (valor ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const numero = d.slice(4);
    const corte = numero.length - 4;
    return `+55 ${d.slice(2, 4)} ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  }
  return `+${d}`;
}

function formatarDuracao(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = dois(total % 60);
  return h > 0 ? `${h}:${dois(m)}:${s}` : `${m}:${s}`;
}

// Tira o que quebraria a linha do arquivo (CR, controles); quebra de linha vira linha recuada.
export function limpar(texto: string): string {
  return texto.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
}

const ROTULO_MIDIA: Record<string, string> = {
  imagem: "imagem", audio: "áudio", video: "vídeo", documento: "documento", figurinha: "figurinha",
  localizacao: "localização", contato: "contato", reacao: "reação", enquete: "enquete",
};

/** "[áudio 0:42]", "[imagem: legenda]", "[documento proposta.pdf: legenda]"... */
export function descreverMensagem(msg: Pick<MensagemArquivo, "tipo" | "corpo" | "midia">, semConteudo = false): string {
  const corpo = limpar(msg.corpo ?? "");
  const midia = (msg.midia && typeof msg.midia === "object" ? msg.midia : {}) as Record<string, any>;
  const tipo = msg.tipo || "texto";
  if (tipo === "texto") return corpo || (semConteudo ? "[texto não registrado]" : "[mensagem vazia]");
  if (tipo === "sistema") return corpo ? `[aviso do WhatsApp: ${corpo}]` : "[aviso do WhatsApp]";

  const rotulo = ROTULO_MIDIA[tipo];
  if (!rotulo) {
    if (midia.visualizacaoUnica) return corpo ? `[visualização única: ${corpo}]` : "[visualização única, conteúdo não veio]";
    return corpo ? `[mensagem: ${corpo}]` : "[mensagem sem texto]";
  }
  const extras: string[] = [];
  if ((tipo === "audio" || tipo === "video") && typeof midia.duracaoSeg === "number" && midia.duracaoSeg > 0) {
    extras.push(formatarDuracao(midia.duracaoSeg));
  }
  if (tipo === "audio" && midia.ptt === false) extras.push("(arquivo)");
  if (tipo === "documento" && typeof midia.nomeArquivo === "string") extras.push(limpar(midia.nomeArquivo));
  let cabeca = [rotulo, ...extras].join(" ");
  if (midia.visualizacaoUnica) cabeca += ", visualização única";
  return corpo ? `[${cabeca}: ${corpo}]` : `[${cabeca}]`;
}

const QUEM_SAIDA: Record<string, string> = {
  humano: "Você", crm: "Você (CRM)", bot: "Robô", campanha: "Campanha", sistema: "Sistema",
};

export function quemDisse(msg: MensagemArquivo, conversa: ConversaArquivo): string {
  if (msg.direcao === "saida") return QUEM_SAIDA[msg.autor ?? ""] ?? "Você";
  if (msg.autor === "sistema") return "Sistema";
  if (conversa.tipo === "grupo") {
    return limpar(msg.participante_nome ?? "") || formatarTelefone(msg.participante_telefone) || "Participante";
  }
  return limpar(conversa.nome ?? "") || "Cliente";
}

function linhaDaMensagem(msg: MensagemArquivo, conversa: ConversaArquivo, fuso: string): string {
  let texto = descreverMensagem(msg, conversa.privacidade !== "normal" && conversa.privacidade != null);
  if (msg.editada_em) texto += " (editada)";
  if (msg.apagada_em) texto += " (apagada para todos)";
  return `${formatarQuando(msg.momento, fuso)} ${quemDisse(msg, conversa)}: ${texto.replace(/\n/g, "\n    ")}`;
}

function origemDoAnuncio(anuncio: Record<string, unknown> | null | undefined): string {
  const a = (anuncio && typeof anuncio === "object" ? anuncio : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof a[k] === "string" && a[k] ? limpar(a[k] as string) : "");
  if (!Object.keys(a).some((k) => s(k))) return "nenhum anúncio registrado nas mensagens";
  const partesOrigem = ["anúncio (clique para o WhatsApp)"];
  if (s("titulo")) partesOrigem.push(`"${s("titulo")}"`);
  if (s("sourceUrl")) partesOrigem.push(s("sourceUrl"));
  const canal = s("entryPointConversionApp") || s("conversionSource");
  if (canal) partesOrigem.push(`via ${canal}`);
  return partesOrigem.join(" — ");
}

function blocoDaConversa(c: ConversaArquivo, msgs: MensagemArquivo[], fuso: string, n: number, total: number): string[] {
  const linhas = [SEPARADOR, `Conversa ${n} de ${total}`];
  if (c.tipo === "grupo") {
    linhas.push(`Grupo: ${limpar(c.grupo_nome ?? "") || "(sem nome)"}`);
  } else {
    linhas.push(`Nome no WhatsApp: ${limpar(c.nome ?? "") || "(não informado)"}`);
    if (c.nome_celular) linhas.push(`Nome no celular: ${limpar(c.nome_celular)}`);
    const tel = (c.telefone ?? "").replace(/\D/g, "");
    if (tel) {
      linhas.push(`Telefone: ${formatarTelefone(tel)}`, `WhatsApp: https://wa.me/${tel}`);
    } else {
      linhas.push(`Telefone: ainda não revelado pelo WhatsApp (contato só pelo LID ${c.lid ?? c.jid ?? "?"})`);
    }
    linhas.push(`Origem: ${origemDoAnuncio(c.anuncio)}`);
  }
  const numero = formatarTelefone(c.conexao_numero);
  if (c.conexao_nome || numero) linhas.push(`Número do mentorado: ${[c.conexao_nome, numero && `(${numero})`].filter(Boolean).join(" ")}`);
  if (c.privacidade === "so_metadados") linhas.push("Privacidade: só registrar que houve conversa (sem o texto)");
  linhas.push(LINHA);
  if (c.privacidade === "ignorar") {
    linhas.push("(conversa marcada como \"Não registrar\")");
  } else if (msgs.length === 0) {
    linhas.push("(nenhuma mensagem no período)");
  } else {
    for (const m of msgs) linhas.push(linhaDaMensagem(m, c, fuso));
  }
  return linhas;
}

export type DadosArquivo = {
  conversas: ConversaArquivo[];
  mensagens: MensagemArquivo[];
  cortado?: boolean;
};

export function montarArquivo(op: {
  dados: DadosArquivo;
  fuso: string;
  agora: Date;
  empresa?: string | null;
  periodo: string;
}): string {
  const { dados, fuso } = op;
  const porConversa = new Map<string, MensagemArquivo[]>();
  for (const m of dados.mensagens || []) {
    const lista = porConversa.get(m.conversa_id) ?? [];
    lista.push(m);
    porConversa.set(m.conversa_id, lista);
  }
  const conversas = dados.conversas || [];
  const linhas = [
    CABECALHO_ARQUIVO,
    "Tem telefone, nome do WhatsApp e a conversa exata. Não envie para IA nem compartilhe.",
    ...(op.empresa ? [`Empresa: ${limpar(op.empresa)}`] : []),
    `${op.periodo} (horário de ${fuso})`,
    `Gerado em: ${formatarAgora(op.agora, fuso)}`,
    `Conversas: ${conversas.length} · Mensagens: ${(dados.mensagens || []).length}`,
  ];
  if (dados.cortado) linhas.push("ATENÇÃO: arquivo cortado no limite de mensagens. Baixe um período menor para ver o resto.");
  conversas.forEach((c, i) => {
    linhas.push("", ...blocoDaConversa(c, porConversa.get(c.id) ?? [], fuso, i + 1, conversas.length));
  });
  if (conversas.length === 0) linhas.push("", "(nenhuma conversa no período)");
  return linhas.join("\n") + "\n";
}

export const periodoDoDia = (dia: string) => `Dia: ${formatarDiaCompleto(dia)}`;

export function periodoDaConversa(de?: string | null, ate?: string | null): string {
  if (de && ate) return `Período: ${formatarDiaCompleto(de)} a ${formatarDiaCompleto(ate)}`;
  if (de) return `Período: de ${formatarDiaCompleto(de)} em diante`;
  if (ate) return `Período: até ${formatarDiaCompleto(ate)}`;
  return "Período: a conversa inteira";
}

/** Content-Disposition com o nome em ASCII e em UTF-8. */
export function disposicaoAnexo(nome: string): string {
  const ascii = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}
