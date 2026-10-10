// Como o que vem do WhatsApp aparece na tela. Sem React nem Supabase: testável em node:test.
// Os campos da Fase 1 (migração 002) podem faltar num banco antigo; tudo aqui aceita ausência.
import type {
  AnuncioWhatsApp,
  Conexao,
  ConexaoPainel,
  Conversa,
  GrupoWhatsApp,
  Mensagem,
  OpcoesConexao,
  PareamentoConexao,
  PrivacidadeConversa,
  StatusConexao,
} from "../types";

export const HISTORICO_PADRAO_DIAS = 7;
export const HISTORICO_MAXIMO_DIAS = 30;

export function soDigitos(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "");
}

/** "5565999990000" -> "+55 65 99999-0000". Fora do Brasil, só o "+" na frente. */
export function formatarTelefone(valor: string | null | undefined): string {
  const d = soDigitos(valor);
  if (!d) return "";
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) {
    const ddd = d.slice(2, 4);
    const numero = d.slice(4);
    const corte = numero.length - 4;
    return `+55 ${ddd} ${numero.slice(0, corte)}-${numero.slice(corte)}`;
  }
  return `+${d}`;
}

export function linkWhatsApp(valor: string | null | undefined): string | null {
  const d = soDigitos(valor);
  return d ? `https://wa.me/${d}` : null;
}

export function ehGrupo(conversa: Pick<Conversa, "tipo" | "jid">): boolean {
  return conversa.tipo === "grupo" || (conversa.jid ?? "").endsWith("@g.us");
}

/** Telefone real da conversa, ou null em grupo e em contato só por LID (o número ainda não apareceu). */
export function telefoneDaConversa(conversa: Pick<Conversa, "tipo" | "jid" | "telefone" | "telefone_confirmado">): string | null {
  if (ehGrupo(conversa)) return null;
  // Linha anterior à 002 não tem a coluna: o telefone gravado era sempre o real.
  if (conversa.telefone_confirmado === false) return null;
  return soDigitos(conversa.telefone) || null;
}

export function tituloDaConversa(conversa: Conversa): string {
  if (ehGrupo(conversa)) return conversa.grupo_nome || "Grupo sem nome";
  return (
    conversa.nome ||
    conversa.nome_agenda ||
    formatarTelefone(telefoneDaConversa(conversa)) ||
    "Contato sem número"
  );
}

export function iniciaisDe(texto: string): string {
  const limpo = texto.replace(/[^\p{L}\p{N} ]/gu, "").trim();
  if (!limpo) return "?";
  const partes = limpo.split(/\s+/);
  const letras = partes.length > 1 ? partes[0][0] + partes[1][0] : limpo.slice(0, 2);
  return letras.toUpperCase();
}

export function privacidadeDaConversa(conversa: Pick<Conversa, "privacidade" | "ignorar">): PrivacidadeConversa {
  const p = conversa.privacidade;
  if (p === "normal" || p === "so_metadados" || p === "ignorar") return p;
  return conversa.ignorar ? "ignorar" : "normal";
}

export const ROTULO_PRIVACIDADE: Record<PrivacidadeConversa, string> = {
  normal: "Normal",
  so_metadados: "Só registrar que houve conversa",
  ignorar: "Não registrar",
};

// ---------------------------------------------------------------- anúncio

export function temAnuncio(anuncio: AnuncioWhatsApp | null | undefined): anuncio is AnuncioWhatsApp {
  if (!anuncio || typeof anuncio !== "object") return false;
  return Object.values(anuncio).some((v) => v !== null && v !== undefined && v !== "");
}

/** Texto do tooltip do selo "Anúncio". Não decide se foi tráfego pago: só mostra o que veio. */
export function resumoAnuncio(anuncio: AnuncioWhatsApp | null | undefined): string {
  if (!temAnuncio(anuncio)) return "";
  const partes = [anuncio.titulo, anuncio.corpo, anuncio.sourceUrl].filter((p): p is string => Boolean(p));
  const canal = anuncio.entryPointConversionApp || anuncio.conversionSource;
  if (canal) partes.push(`via ${canal}`);
  return partes.length ? partes.join(" — ") : "Veio de um anúncio";
}

// ---------------------------------------------------------------- mensagens

export function formatarDuracao(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const ROTULO_MIDIA: Record<string, string> = {
  imagem: "imagem",
  audio: "áudio",
  video: "vídeo",
  documento: "documento",
  figurinha: "figurinha",
  localizacao: "localização",
  contato: "contato",
  reacao: "reação",
  enquete: "enquete",
};

/** Texto da mensagem como aparece no chat: "[áudio 0:42]", "[imagem: legenda]"... */
export function descreverMensagem(msg: Pick<Mensagem, "tipo" | "corpo" | "midia">): string {
  const corpo = (msg.corpo ?? "").trim();
  const midia = msg.midia && typeof msg.midia === "object" ? msg.midia : {};
  const tipo = msg.tipo || "texto";

  if (tipo === "texto") return corpo || "[texto não registrado]";
  if (tipo === "sistema") return corpo || "[aviso do WhatsApp]";

  const rotulo = ROTULO_MIDIA[tipo];
  if (!rotulo) {
    if (midia.visualizacaoUnica) return corpo ? `[visualização única: ${corpo}]` : "[visualização única]";
    return corpo ? `[mensagem: ${corpo}]` : "[mensagem sem texto]";
  }

  const extras: string[] = [];
  if ((tipo === "audio" || tipo === "video") && typeof midia.duracaoSeg === "number" && midia.duracaoSeg > 0) {
    extras.push(formatarDuracao(midia.duracaoSeg));
  }
  if (tipo === "documento" && midia.nomeArquivo) extras.push(midia.nomeArquivo);
  let cabeca = [rotulo, ...extras].join(" ");
  if (midia.visualizacaoUnica) cabeca += ", visualização única";
  return corpo ? `[${cabeca}: ${corpo}]` : `[${cabeca}]`;
}

type AutorResolvido = NonNullable<Mensagem["autor"]>;

export function autorDaMensagem(msg: Pick<Mensagem, "autor" | "direcao" | "enviada_por" | "disparo_id">): AutorResolvido {
  if (msg.autor) return msg.autor;
  // Mensagem gravada antes da 002 não tem autor: deduz como a própria migração faz.
  if (msg.direcao === "entrada") return "cliente";
  if (msg.enviada_por) return "crm";
  if (msg.disparo_id) return "campanha";
  return "bot";
}

/** Você / Robô / CRM / Cliente; em grupo, quem mandou. */
export function rotuloAutor(msg: Mensagem, emGrupo: boolean): string {
  switch (autorDaMensagem(msg)) {
    case "humano":
      return "Você";
    case "bot":
      return "Robô";
    case "crm":
      return "CRM";
    case "campanha":
      return "Campanha";
    case "sistema":
      return "WhatsApp";
    default:
      if (!emGrupo) return "Cliente";
      return msg.participante_nome || formatarTelefone(msg.participante_telefone) || "Participante";
  }
}

/** Hora do WhatsApp quando existe; senão, a hora em que o CRM gravou. */
export function momentoDaMensagem(msg: Pick<Mensagem, "wa_em" | "momento" | "created_at">): string {
  return msg.wa_em || msg.momento || msg.created_at;
}

export function ordenarMensagens<T extends Mensagem>(lista: T[]): T[] {
  const chave = (m: T) => Date.parse(momentoDaMensagem(m)) || 0;
  return [...lista].sort((a, b) => chave(a) - chave(b) || a.created_at.localeCompare(b.created_at));
}

// ---------------------------------------------------------------- datas

type PartesData = { ano: string; mes: string; dia: string; hora: string; minuto: string };

const formatadores = new Map<string, Intl.DateTimeFormat>();

function partesDaData(data: Date, fuso?: string): PartesData {
  const chave = fuso || "";
  let fmt = formatadores.get(chave);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("pt-BR", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatadores.set(chave, fmt);
  }
  const p: Record<string, string> = {};
  for (const parte of fmt.formatToParts(data)) p[parte.type] = parte.value;
  return { ano: p.year, mes: p.month, dia: p.day, hora: p.hour, minuto: p.minute };
}

/** "YYYY-MM-DD" do dia local (do navegador, ou do fuso pedido). */
export function diaLocal(data: Date, fuso?: string): string {
  const p = partesDaData(data, fuso);
  return `${p.ano}-${p.mes}-${p.dia}`;
}

export function diaAnterior(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d - 1)).toISOString().slice(0, 10);
}

export function ontem(agora: Date = new Date(), fuso?: string): string {
  return diaAnterior(diaLocal(agora, fuso));
}

/** "14:05" se for hoje; "03/10 14:05" no mesmo ano; "03/10/2025 14:05" antes disso. */
export function formatarMomento(iso: string | null | undefined, agora: Date = new Date(), fuso?: string): string {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";
  const p = partesDaData(data, fuso);
  const hoje = partesDaData(agora, fuso);
  const hora = `${p.hora}:${p.minuto}`;
  if (p.ano === hoje.ano && p.mes === hoje.mes && p.dia === hoje.dia) return hora;
  if (p.ano === hoje.ano) return `${p.dia}/${p.mes} ${hora}`;
  return `${p.dia}/${p.mes}/${p.ano} ${hora}`;
}

export function vistoHa(iso: string | null | undefined, agora: Date = new Date()): string {
  if (!iso) return "nunca visto";
  const ms = agora.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return "nunca visto";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "visto agora";
  if (min < 60) return `visto há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `visto há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "visto há 1 dia" : `visto há ${d} dias`;
}

// ---------------------------------------------------------------- conexões

const STATUS_VALIDOS: StatusConexao[] = [
  "conectando",
  "conectado",
  "desconectado",
  "deslogado",
  "aguardando_qr",
  "aguardando_codigo",
  "erro",
];

export const ROTULO_STATUS: Record<StatusConexao, string> = {
  conectando: "Conectando…",
  conectado: "Conectado",
  desconectado: "Desconectado",
  deslogado: "Saiu do celular",
  aguardando_qr: "Esperando ler o QR",
  aguardando_codigo: "Esperando o código",
  erro: "Erro",
};

export type TomStatus = "ok" | "espera" | "parado" | "erro";

export function tomDoStatus(status: string | null | undefined): TomStatus {
  if (status === "conectado") return "ok";
  if (status === "conectando" || status === "aguardando_qr" || status === "aguardando_codigo") return "espera";
  if (status === "erro" || status === "deslogado") return "erro";
  return "parado";
}

export function rotuloStatus(status: string | null | undefined): string {
  return (status && ROTULO_STATUS[status as StatusConexao]) || "Desconectado";
}

/** Texto do status_detalhe que o gateway manda, em português de gente. */
export function explicarDetalheStatus(detalhe: string | null | undefined): string | null {
  const d = (detalhe ?? "").trim();
  if (!d) return null;
  if (d.startsWith("pareamento_expirou")) return "O tempo para parear acabou. Gere um novo QR ou código.";
  if (d.startsWith("pareamento_interrompido")) return "O pareamento foi interrompido. Tente de novo.";
  if (d === "sem_sessao") return "Este número ainda não foi pareado.";
  if (d === "parada") return "Sessão pausada pelo servidor.";
  return d;
}

const PAREAMENTO_ACABOU = /^pareamento_(expirou|interrompido)/;

export function limitarHistoricoDias(valor: unknown): number {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return HISTORICO_PADRAO_DIAS;
  return Math.min(HISTORICO_MAXIMO_DIAS, Math.max(0, n));
}

export function normalizarOpcoes(bruto: any): OpcoesConexao {
  const o = bruto && typeof bruto === "object" ? bruto : {};
  const grupos = Array.isArray(o.gruposPermitidos) ? o.gruposPermitidos : Array.isArray(o.gruposMarcados) ? o.gruposMarcados : [];
  return {
    gruposPermitidos: grupos.filter((g: unknown): g is string => typeof g === "string" && g.endsWith("@g.us")),
    historicoDias: o.historicoDias === undefined || o.historicoDias === null ? HISTORICO_PADRAO_DIAS : limitarHistoricoDias(o.historicoDias),
    botAtivo: o.botAtivo === true,
  };
}

function normalizarGrupos(bruto: unknown): GrupoWhatsApp[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .filter((g) => g && typeof g === "object" && typeof g.jid === "string")
    .map((g) => ({
      jid: g.jid,
      nome: typeof g.nome === "string" && g.nome ? g.nome : null,
      participantes: typeof g.participantes === "number" ? g.participantes : null,
    }));
}

function normalizarPareamento(bruto: any): PareamentoConexao | null {
  if (!bruto || typeof bruto !== "object") return null;
  return {
    estado: typeof bruto.estado === "string" ? bruto.estado : "",
    qr: typeof bruto.qr === "string" && bruto.qr ? bruto.qr : null,
    codigo: typeof bruto.codigo === "string" && bruto.codigo ? bruto.codigo : null,
    atualizadoEm: typeof bruto.atualizadoEm === "string" ? bruto.atualizadoEm : null,
  };
}

/** Item de GET /api/conexoes com padrões para o que faltar. */
export function normalizarConexaoPainel(bruto: any): ConexaoPainel {
  const status = STATUS_VALIDOS.includes(bruto?.status) ? (bruto.status as StatusConexao) : "desconectado";
  return {
    id: String(bruto?.id ?? ""),
    nome: typeof bruto?.nome === "string" && bruto.nome ? bruto.nome : "WhatsApp",
    numero: typeof bruto?.numero === "string" && bruto.numero ? bruto.numero : null,
    modo: bruto?.modo === "pc" ? "pc" : "gateway",
    status,
    status_detalhe: typeof bruto?.status_detalhe === "string" ? bruto.status_detalhe : null,
    visto_em: typeof bruto?.visto_em === "string" ? bruto.visto_em : null,
    pareamento: normalizarPareamento(bruto?.pareamento),
    opcoes: normalizarOpcoes(bruto?.opcoes),
    grupos_disponiveis: normalizarGrupos(bruto?.grupos_disponiveis),
  };
}

export function listaDeConexoes(resposta: unknown): ConexaoPainel[] {
  const lista = Array.isArray(resposta) ? resposta : (resposta as any)?.conexoes;
  return Array.isArray(lista) ? lista.map(normalizarConexaoPainel).filter((c) => c.id) : [];
}

const ESTADOS_PAREAMENTO_ENCERRADO = new Set(["expirado", "erro", "cancelado", "concluido", "conectado", "falhou"]);

// O gateway ignora pedido de pareamento com mais de 10 minutos.
const VALIDADE_PAREAMENTO_MS = 10 * 60 * 1000;

export function estaPareando(conexao: ConexaoPainel, agora: Date = new Date()): boolean {
  if (conexao.status === "conectado") return false;
  const p = conexao.pareamento;
  // Um status "aguardando" parado há mais de 10 min é sobra de um gateway que caiu no meio.
  const idade = p?.atualizadoEm ? agora.getTime() - Date.parse(p.atualizadoEm) : 0;
  const recente = !(idade > VALIDADE_PAREAMENTO_MS);
  if (conexao.status === "aguardando_qr" || conexao.status === "aguardando_codigo") return recente;
  if (PAREAMENTO_ACABOU.test(conexao.status_detalhe ?? "")) return false;
  if (!p || ESTADOS_PAREAMENTO_ENCERRADO.has(p.estado)) return false;
  return recente;
}

/** "ABCD1234" -> "ABCD-1234". */
export function formatarCodigoPareamento(codigo: string | null | undefined): string {
  const limpo = (codigo ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return limpo.length === 8 ? `${limpo.slice(0, 4)}-${limpo.slice(4)}` : limpo;
}

/** Telefone para o pareamento por código: só dígitos, com 55 quando vier só DDD + número. */
export function telefoneParaPareamento(texto: string): string | null {
  const bruto = texto.trim();
  const d = soDigitos(bruto);
  // Mesma regra do gateway: com "+" o número fica como está (E.164 tem de 8 a 15 dígitos).
  if (bruto.startsWith("+")) return d.length >= 8 && d.length <= 15 ? d : null;
  const comPais = d.length === 10 || d.length === 11 ? "55" + d : d;
  return comPais.length >= 12 && comPais.length <= 15 ? comPais : null;
}

/**
 * O que a tela manda ao servidor: o número que o usuário digitou com "+" continua com "+" (o servidor só
 * acrescenta o 55 quando não há "+"); sem "+", já vai normalizado.
 */
export function telefoneParaEnvio(texto: string): string | null {
  const normalizado = telefoneParaPareamento(texto);
  if (!normalizado) return null;
  return texto.trim().startsWith("+") ? `+${normalizado}` : normalizado;
}

/** O pareamento já anda (QR ou código gerado pelo gateway), em vez de só pedido ("solicitado")? */
export function pareamentoAndando(conexao: ConexaoPainel): boolean {
  return (
    conexao.status === "aguardando_qr" ||
    conexao.status === "aguardando_codigo" ||
    Boolean(conexao.pareamento?.qr || conexao.pareamento?.codigo)
  );
}

/** Robô ligado no número? null quando o banco ainda não tem a informação. */
export function roboLigado(conexao: Pick<Conexao, "bot_ativo" | "opcoes"> | null | undefined): boolean | null {
  if (!conexao) return null;
  if (typeof conexao.bot_ativo === "boolean") return conexao.bot_ativo;
  if (conexao.opcoes && typeof conexao.opcoes.botAtivo === "boolean") return conexao.opcoes.botAtivo;
  return null;
}

// ---------------------------------------------------------------- downloads

/** Nome do arquivo no Content-Disposition (filename* tem preferência). */
export function nomeDoArquivo(contentDisposition: string | null | undefined, padrao: string): string {
  const cd = contentDisposition ?? "";
  const estendido = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
  if (estendido) {
    try {
      return limparNomeArquivo(decodeURIComponent(estendido[1].trim().replace(/^"|"$/g, ""))) || padrao;
    } catch {
      // segue para o filename simples
    }
  }
  const simples = /filename\s*=\s*"?([^";]+)"?/.exec(cd);
  return (simples && limparNomeArquivo(simples[1].trim())) || padrao;
}

function limparNomeArquivo(nome: string): string {
  return nome.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
}

const ERRO_DOWNLOAD: Record<string, string> = {
  sem_acesso: "Você não tem acesso a esta empresa.",
  nao_encontrada: "Conversa não encontrada.",
  nao_encontrado: "Nada encontrado para baixar.",
  dia_invalido: "Data inválida.",
  data_invalida: "Data inválida.",
};

export function mensagemErroDownload(status: number, codigo?: string | null): string {
  if (codigo && ERRO_DOWNLOAD[codigo]) return ERRO_DOWNLOAD[codigo];
  if (status === 404) return "Nada encontrado para baixar.";
  if (status === 400) return codigo ? `Pedido inválido: ${codigo}` : "Pedido inválido.";
  if (status === 403) return "Você não tem acesso a este arquivo.";
  return codigo ? `Não foi possível baixar: ${codigo}` : `Não foi possível baixar (erro ${status}).`;
}
