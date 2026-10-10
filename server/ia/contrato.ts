// Contrato v1 da análise diária (ia/contrato/schema.json): zod estrito, regras de coerência, erros em
// português com caminho, conferência contra o texto do lote e as duas adaptações para a API da Anthropic.
// Sem telefone e sem nome: a conversa é só o ref (c01, p03).
import { z, type ZodError, type ZodIssue, type ZodIssueOptionalMessage } from "zod";
import { SCHEMA_CONTRATO } from "./contrato-gerado.js";

const refConversa = z.string().regex(/^[cp][0-9]{1,4}$/, "ref de conversa inválido (use c01, p03)");
const refMensagem = z.string().regex(/^[cp][0-9]{1,4}\.m[0-9]{1,4}$/, "ref de mensagem inválido (use c01.m03)");
const textoCurto = z.string().max(200);
const anulavel = <T extends z.ZodTypeAny>(t: T) => t.nullable();

export const CATEGORIAS = ["cliente", "lead", "parceiro", "fornecedor", "pessoal", "equipe", "outro"] as const;
export const COMERCIAIS: readonly string[] = ["cliente", "lead"];
export const ETAPAS = ["novo_contato", "em_atendimento", "proposta_enviada", "negociando", "aguardando_pagamento", "ganho", "perdido", "pos_venda", "nao_se_aplica"] as const;
export const STATUS_COMERCIAL = ["venda_ganha", "perda_venda", "em_aberto", "iniciada_nao_finalizada", "sem_interesse_comercial"] as const;
export const RISCOS = ["esperando_voce", "cliente_sumiu", "followup_atrasado", "objecao_nao_tratada", "esfriando", "promessa_nao_cumprida"] as const;
export const TIPOS_ACAO = ["responder_agora", "followup", "enviar_proposta", "cobrar_pagamento", "confirmar_pagamento", "pos_venda", "reativar", "nenhuma"] as const;
export const MOTORES = ["rotina_dono", "api_batch", "manual"] as const;

const Resumo = z
  .object({
    diagnostico: z.string().max(1200),
    o_que_foi_feito: z.string().max(600),
    melhor_estrategia: z.string().max(600),
    pontos_melhoria: z.array(textoCurto).max(5),
    foco_sugerido: z
      .array(
        z
          .object({
            tipo: z.enum(["followups", "propostas", "vendas", "reativacoes", "novas_conversas", "outro"]),
            descricao: z.string().max(160),
            quantidade: anulavel(z.number().int().min(0).max(500)),
          })
          .strict(),
      )
      .max(5),
    dicas_mensagens: z.array(z.object({ situacao: z.string().max(120), mensagem: z.string().max(400) }).strict()).max(3),
    alertas: z.array(textoCurto).max(5),
  })
  .strict();

const Venda = z
  .object({
    houve: z.boolean(),
    valor: anulavel(z.number().min(0).max(1_000_000)),
    forma: anulavel(z.enum(["pix", "cartao", "boleto", "dinheiro", "transferencia", "link_pagamento", "outro", "desconhecida"])),
    produto: anulavel(z.string().max(80)),
    confirmada: z.boolean(),
    tipo_evidencia: anulavel(z.enum(["confirmacao_do_vendedor", "comprovante_enviado_pelo_cliente", "cliente_disse_que_pagou", "combinado_sem_pagamento"])),
    evidencia_ref: anulavel(refMensagem),
    evidencia_trecho: anulavel(z.string().max(200)),
  })
  .strict();

const Contato = z
  .object({
    ref: refConversa,
    categoria: z.enum(CATEGORIAS),
    confianca: z.number().min(0).max(1),
    origem: z
      .object({
        tipo: z.enum(["trafego_pago", "organico", "indicacao", "desconhecido"]),
        evidencia_ref: anulavel(refMensagem),
        evidencia_trecho: anulavel(z.string().max(200)),
      })
      .strict(),
    etapa_funil: z.enum(ETAPAS),
    tags: z.array(z.string().regex(/^[a-z0-9_]{2,32}$/, "tag inválida (minúsculas, números e _, de 2 a 32 caracteres)")).max(5),
    status_comercial: z.enum(STATUS_COMERCIAL),
    venda: Venda,
    motivo_perda: anulavel(
      z
        .object({
          codigo: z.enum(["preco", "sem_resposta", "concorrente", "timing", "sem_necessidade", "confianca", "forma_pagamento", "atendimento_demorado", "outro"]),
          detalhe: anulavel(z.string().max(200)),
        })
        .strict(),
    ),
    riscos: z.array(z.enum(RISCOS)).max(4),
    proxima_acao: z
      .object({
        tipo: z.enum(TIPOS_ACAO),
        em_dias: anulavel(z.number().int().min(0).max(60)),
        prioridade: z.enum(["alta", "media", "baixa"]),
        mensagem_sugerida: anulavel(z.string().max(400)),
      })
      .strict(),
    produto_sugerido: anulavel(z.string().max(80)),
    como_abordar: anulavel(z.string().max(300)),
    resumo: z.string().max(280),
  })
  .strict();

const AnaliseBase = z
  .object({
    versao_contrato: z.literal("1"),
    lote_id: z.string().uuid(),
    partner_id: z.string().uuid(),
    dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data inválida (use AAAA-MM-DD)"),
    engine: z.object({ tipo: z.enum(MOTORES), modelo: anulavel(z.string().max(60)) }).strict(),
    resumo: Resumo,
    contatos: z.array(Contato).max(300),
  })
  .strict();

export type AnaliseV1 = z.infer<typeof AnaliseBase>;
export type ContatoV1 = z.infer<typeof Contato>;

// Regras que o JSON Schema não expressa (desenho/2 §3, sem telefone).
export const Analise = AnaliseBase.superRefine((a, ctx) => {
  const vistos = new Set<string>();
  a.contatos.forEach((c, i) => {
    const erro = (caminho: (string | number)[], message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["contatos", i, ...caminho], message });
    if (vistos.has(c.ref)) erro(["ref"], `ref ${c.ref} repetido`);
    vistos.add(c.ref);
    const daConversa = (r: string | null) => r === null || r.startsWith(`${c.ref}.`);

    if (!COMERCIAIS.includes(c.categoria)) {
      if (c.etapa_funil !== "nao_se_aplica") erro(["etapa_funil"], `categoria ${c.categoria} exige etapa_funil nao_se_aplica`);
      if (c.status_comercial !== "sem_interesse_comercial") erro(["status_comercial"], `categoria ${c.categoria} exige status_comercial sem_interesse_comercial`);
      if (c.venda.houve) erro(["venda"], `categoria ${c.categoria} não pode ter venda`);
    }

    const v = c.venda;
    if (v.houve) {
      if (!v.evidencia_ref || !v.evidencia_trecho) erro(["venda"], "venda exige evidencia_ref e evidencia_trecho");
      if (!v.tipo_evidencia) erro(["venda"], "venda exige tipo_evidencia");
      if (!daConversa(v.evidencia_ref)) erro(["venda", "evidencia_ref"], `${v.evidencia_ref} não é desta conversa (${c.ref})`);
    } else if (v.valor !== null || v.forma !== null || v.produto !== null || v.confirmada || v.tipo_evidencia !== null || v.evidencia_ref !== null || v.evidencia_trecho !== null) {
      erro(["venda"], "houve=false exige valor, forma, produto, tipo_evidencia, evidencia_ref e evidencia_trecho nulos e confirmada=false");
    }
    if ((c.status_comercial === "venda_ganha") !== v.houve) erro(["status_comercial"], "venda_ganha só vale junto com venda.houve=true (e vice-versa)");
    if (c.status_comercial === "perda_venda" && !c.motivo_perda) erro(["motivo_perda"], "perda_venda exige motivo_perda");
    if (c.status_comercial !== "perda_venda" && c.motivo_perda) erro(["motivo_perda"], "motivo_perda só vale com status perda_venda");

    if ((c.origem.tipo === "trafego_pago" || c.origem.tipo === "indicacao") && !c.origem.evidencia_ref) erro(["origem"], `origem ${c.origem.tipo} exige evidencia_ref`);
    if (!daConversa(c.origem.evidencia_ref)) erro(["origem", "evidencia_ref"], `${c.origem.evidencia_ref} não é desta conversa (${c.ref})`);

    const pa = c.proxima_acao;
    if ((pa.tipo === "nenhuma") !== (pa.em_dias === null)) erro(["proxima_acao"], "tipo nenhuma só com em_dias nulo (e vice-versa)");
  });
});

// ------------------------------------------------------------------ erros em português
const TIPOS_PT: Record<string, string> = { string: "texto", number: "número", integer: "número inteiro", boolean: "verdadeiro/falso", object: "objeto", array: "lista", null: "nulo", undefined: "ausente" };

const mapaDeErros = (issue: ZodIssueOptionalMessage, ctx: { defaultError: string }): { message: string } => {
  switch (issue.code) {
    case "invalid_type":
      return { message: issue.received === "undefined" ? "campo obrigatório ausente" : `esperado ${TIPOS_PT[issue.expected] ?? issue.expected}, recebido ${TIPOS_PT[issue.received] ?? issue.received}` };
    case "unrecognized_keys":
      return { message: `campo não previsto: ${issue.keys.join(", ")}` };
    case "invalid_enum_value":
      return { message: `valor ${JSON.stringify(issue.received)} não permitido (use: ${issue.options.join(", ")})` };
    case "invalid_literal":
      return { message: `deve ser ${JSON.stringify(issue.expected)}` };
    case "too_big":
      if (issue.type === "string") return { message: `texto longo demais (máx. ${issue.maximum} caracteres)` };
      if (issue.type === "array") return { message: `lista longa demais (máx. ${issue.maximum} itens)` };
      return { message: `maior que ${issue.maximum}` };
    case "too_small":
      if (issue.type === "string") return { message: `texto curto demais (mín. ${issue.minimum} caracteres)` };
      if (issue.type === "array") return { message: `lista curta demais (mín. ${issue.minimum} itens)` };
      return { message: `menor que ${issue.minimum}` };
    case "invalid_string":
      return { message: issue.message ?? (issue.validation === "uuid" ? "uuid inválido" : "formato inválido") };
    default:
      return { message: ctx.defaultError };
  }
};

export function caminhoLegivel(caminho: (string | number)[]): string {
  return caminho.reduce<string>((s, p) => (typeof p === "number" ? `${s}[${p}]` : s ? `${s}.${p}` : p), "");
}

export function errosDoZod(erro: ZodError, limite = 30): string[] {
  const linhas = erro.issues.map((i: ZodIssue) => `${caminhoLegivel(i.path) || "$"}: ${i.message}`);
  return [...new Set(linhas)].slice(0, limite);
}

// Um dos dois vem preenchido: `analise` (válida) ou `detalhes` (erros em português com caminho).
export type Validacao = { analise?: AnaliseV1; detalhes?: string[] };

export function validarAnalise(bruto: unknown): Validacao {
  const r = Analise.safeParse(bruto, { errorMap: mapaDeErros });
  return r.success ? { analise: r.data } : { detalhes: errosDoZod(r.error) };
}

// ------------------------------------------------------------------ conferência contra o lote
const normalizar = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Números como o SQL (ia_numeros): 1.497,00 / 497,00 / 497. Só do corpo da mensagem, depois do ':' (V7).
export function numerosDoTexto(t: string): number[] {
  return [...t.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?/g)].map((m) => Number(m[0].replace(/\./g, "").replace(",", ".")));
}

export type LoteLido = {
  cabecalho: Record<string, string>;
  conversas: Map<string, Map<string, string>>; // ref da conversa -> (ref da mensagem -> corpo)
};

// "[c04.m04] 15:02 EU{confirmacao}: texto": o corpo é só o que vem depois do ':' do prefixo (V7).
const LINHA_MENSAGEM = /^\[([cp]\d+\.m\d+)\] (?:\d{2}\/\d{2} )?\d{2}:\d{2} [A-ZÇ]+(?:\([^)]*\))?(?:\[[^\]]*\])?(?:\{[^}]*\})?(?::\s?(.*))?$/;

export function lerLote(texto: string): LoteLido {
  const cabecalho: Record<string, string> = {};
  const conversas = new Map<string, Map<string, string>>();
  let atual: Map<string, string> | null = null;
  for (const linha of texto.split(/\r?\n/)) {
    const cab = /^#@ (\w+): (.+)$/.exec(linha);
    if (cab) cabecalho[cab[1]] = cab[2].trim();
    const h = /^=== (?:CONVERSA|PENDENTE) ([cp]\d+) \|.*===$/.exec(linha);
    if (h) {
      atual = new Map();
      conversas.set(h[1], atual);
      continue;
    }
    const m = LINHA_MENSAGEM.exec(linha);
    if (m && atual) atual.set(m[1], m[2] ?? "");
  }
  return { cabecalho, conversas };
}

// Pega o que o validador do contrato não vê: ids que não batem, conversa esquecida, trecho ou valor inventado.
export function conferirComLote(a: AnaliseV1, texto: string): string[] {
  const lote = lerLote(texto);
  const erros: string[] = [];
  for (const k of ["lote_id", "partner_id", "dia"] as const) {
    if (lote.cabecalho[k] && a[k] !== lote.cabecalho[k]) erros.push(`${k}: difere do cabeçalho do lote (${lote.cabecalho[k]})`);
  }
  const analisadas = new Set(a.contatos.map((c) => c.ref));
  for (const ref of lote.conversas.keys()) if (!analisadas.has(ref)) erros.push(`contatos: faltou analisar a conversa ${ref}`);
  a.contatos.forEach((c, i) => {
    const p = `contatos[${i}]`;
    const msgs = lote.conversas.get(c.ref);
    if (!msgs) return void erros.push(`${p}.ref: ${c.ref} não existe no lote`);
    const checar = (campo: string, ref: string | null, trecho: string | null) => {
      if (!ref) return;
      const corpo = msgs.get(ref);
      if (corpo === undefined) return void erros.push(`${p}.${campo}: mensagem ${ref} não existe no lote`);
      if (trecho && !normalizar(corpo).includes(normalizar(trecho))) erros.push(`${p}.${campo}: evidencia_trecho não aparece literalmente em ${ref}`);
    };
    checar("origem", c.origem.evidencia_ref, c.origem.evidencia_trecho);
    if (c.venda.houve) {
      checar("venda", c.venda.evidencia_ref, c.venda.evidencia_trecho);
      const todos = [...msgs.values()].flatMap(numerosDoTexto);
      if (c.venda.valor !== null && !todos.includes(c.venda.valor)) erros.push(`${p}.venda: valor ${c.venda.valor} não está escrito na conversa`);
    }
  });
  return erros.slice(0, 30);
}

// ------------------------------------------------------------------ saída da API (structured outputs)
type Esquema = Record<string, any>;

const seguir = (raiz: Esquema, ref: string): Esquema => ref.replace(/^#\//, "").split("/").reduce<any>((o, k) => o?.[k], raiz);
const resolver = (raiz: Esquema, s: Esquema): Esquema => (s?.$ref ? resolver(raiz, seguir(raiz, s.$ref)) : s);
const recortar = (t: string, max: number) => (Array.from(t).length > max ? Array.from(t).slice(0, max).join("") : t);

function podarValor(raiz: Esquema, v: unknown, esquema: Esquema | undefined): unknown {
  const s = esquema ? resolver(raiz, esquema) : undefined;
  if (!s) return v;
  if (s.anyOf) {
    if (v === null) return null;
    const alt = s.anyOf.find((x: Esquema) => {
      const t = resolver(raiz, x).type;
      return t !== "null" && (Array.isArray(v) ? t === "array" : typeof v === "object" ? t === "object" : typeof v === "string" ? t === "string" || t === undefined : true);
    });
    return alt ? podarValor(raiz, v, alt) : v;
  }
  if (typeof v === "string") return s.maxLength != null ? recortar(v, s.maxLength) : v;
  if (typeof v === "number") {
    let n = v;
    if (s.minimum != null) n = Math.max(n, s.minimum);
    if (s.maximum != null) n = Math.min(n, s.maximum);
    return n;
  }
  if (Array.isArray(v)) {
    const lista = s.maxItems != null ? v.slice(0, s.maxItems) : v;
    return s.items ? lista.map((x) => podarValor(raiz, x, s.items)) : lista;
  }
  if (v && typeof v === "object") {
    if (!s.properties) return v;
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (s.properties[k]) saida[k] = podarValor(raiz, x, s.properties[k]);
      else if (s.additionalProperties !== false) saida[k] = x;
    }
    return saida;
  }
  return v;
}

// A API não aplica maxLength/maxItems/min/max: o servidor corta textos e listas no limite do schema antes do zod.
export function podar(bruto: unknown): unknown {
  return podarValor(SCHEMA_CONTRATO, bruto, SCHEMA_CONTRATO);
}

const REMOVER = new Set(["$schema", "$id", "title", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format", "uniqueItems", "multipleOf"]);

// O schema aceito pela API não tem limites numéricos nem de tamanho, pattern ou format; ["x","null"] vira anyOf.
export function schemaParaApi(schema: Esquema = SCHEMA_CONTRATO): Esquema {
  const limpar = (s: any): any => {
    if (Array.isArray(s)) return s.map(limpar);
    if (!s || typeof s !== "object") return s;
    const saida: Record<string, any> = {};
    for (const [k, x] of Object.entries(s)) {
      if (REMOVER.has(k) && typeof x !== "object") continue;
      saida[k] = k === "properties" || k === "$defs" ? Object.fromEntries(Object.entries(x as object).map(([n, y]) => [n, limpar(y)])) : limpar(x);
    }
    if ("const" in saida) {
      saida.enum = [saida.const];
      delete saida.const;
    }
    if (Array.isArray(saida.type)) {
      const { type, ...resto } = saida;
      const nulo = type.includes("null");
      const demais = type.filter((t: string) => t !== "null");
      if (nulo && demais.length === 1) return { anyOf: [{ ...resto, type: demais[0] }, { type: "null" }] };
      return { ...resto, anyOf: type.map((t: string) => ({ type: t })) };
    }
    return saida;
  };
  return limpar(schema);
}
