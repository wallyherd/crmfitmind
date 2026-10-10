// Supabase falso, em memória, com o pedaço da API do supabase-js que o servidor usa.
// Não imita a RLS: o servidor usa a service role, então quem filtra é o código da rota.
import { randomUUID } from "node:crypto";

type Linha = Record<string, any>;
type Resultado = { data: any; error: any; count?: number | null };

// Relações para o select embutido: "tabela.embutida" -> colunas da junção (muitos-para-um).
const RELACOES: Record<string, { local: string; remoto: string }> = {
  "bot_mensagens.bot_conversas": { local: "conversa_id", remoto: "id" },
  "crm_cartoes.crm_quadros": { local: "quadro_id", remoto: "id" },
  "profiles.partners": { local: "partner_id", remoto: "id" },
};

// Chaves únicas (para insert devolver 23505 e para o upsert achar a linha).
const UNICAS: Record<string, string[][]> = {
  profiles: [["id"], ["user_id"]],
  partner_members: [["partner_id", "profile_id"]],
  bot_conversas: [["id"], ["conexao_id", "telefone"]],
};

type Filtro = (l: Linha) => boolean;

function valorFiltro(v: string): any {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  return v;
}

function comparar(op: string, a: any, b: any): boolean {
  switch (op) {
    case "eq": return a === b || (a != null && b != null && String(a) === String(b));
    case "neq": return !comparar("eq", a, b);
    case "gt": return a != null && a > b;
    case "gte": return a != null && a >= b;
    case "lt": return a != null && a < b;
    case "lte": return a != null && a <= b;
    case "is": return b === null ? a == null : a === b;
    case "in": return (b as any[]).some((x) => comparar("eq", a, x));
    case "ilike": {
      const re = new RegExp("^" + String(b).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i");
      return a != null && re.test(String(a));
    }
    default: throw new Error(`operador não suportado no falso: ${op}`);
  }
}

// "a.op.valor,b.op.valor" do .or() do PostgREST (só o necessário aqui).
function filtroOu(expr: string): Filtro {
  const partes = expr.split(",").map((p) => {
    const i = p.indexOf(".");
    const j = p.indexOf(".", i + 1);
    return { col: p.slice(0, i), op: p.slice(i + 1, j), val: valorFiltro(p.slice(j + 1)) };
  });
  return (l) => partes.some((p) => comparar(p.op, l[p.col], p.val));
}

type Embutido = { alias: string; tabela: string; inner: boolean; colunas: string };

function lerSelect(sel: string): { colunas: string[] | "*"; embutidos: Embutido[] } {
  const embutidos: Embutido[] = [];
  const semEmbutidos = sel.replace(/(?:(\w+):)?(\w+)(?:!(\w+))?\s*\(([^)]*)\)/g, (_m, alias, tabela, dica, cols) => {
    embutidos.push({ alias: alias || tabela, tabela, inner: dica === "inner", colunas: cols });
    return "";
  });
  const cols = semEmbutidos.split(",").map((c) => c.trim()).filter(Boolean);
  return { colunas: cols.length === 0 || cols.includes("*") ? "*" : cols, embutidos };
}

function projetar(l: Linha, colunas: string[] | "*"): Linha {
  if (colunas === "*") return { ...l };
  const r: Linha = {};
  for (const c of colunas) r[c] = l[c];
  return r;
}

export class SupabaseFalso {
  tabelas: Record<string, Linha[]> = {};
  tokens = new Map<string, { id: string; email: string }>();
  usuariosAuth: { id: string; email: string; password: string; user_metadata: any }[] = [];
  // A assinatura do gateway só vale uma vez (bot_gateway_assinatura_nova); aqui aceita sempre, porque os
  // testes repetem o mesmo ts fixo. O teste de repetição troca por um que lembra (ver fase1.test.ts).
  rpcs: Record<string, (args: any) => Resultado | Promise<Resultado>> = {
    bot_gateway_assinatura_nova: () => ({ data: true, error: null }),
  };
  chamadas: { tipo: string; args: any }[] = [];

  tabela(nome: string): Linha[] {
    return (this.tabelas[nome] ??= []);
  }

  inserir(nome: string, linha: Linha): Linha {
    const l = { id: randomUUID(), created_at: new Date().toISOString(), ...linha };
    this.tabela(nome).push(l);
    return l;
  }

  from(nome: string) {
    return new Consulta(this, nome);
  }

  async rpc(nome: string, args: any): Promise<Resultado> {
    this.chamadas.push({ tipo: `rpc:${nome}`, args });
    const f = this.rpcs[nome];
    if (!f) return { data: null, error: { message: `função ${nome} não existe no falso` } };
    return f(args);
  }

  auth = {
    getUser: async (token: string) => {
      const u = this.tokens.get(token);
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid JWT", status: 401 } };
    },
    admin: {
      createUser: async (p: { email: string; password: string; email_confirm?: boolean; user_metadata?: any }) => {
        this.chamadas.push({ tipo: "auth.createUser", args: p });
        if (this.usuariosAuth.some((u) => u.email === p.email)) {
          return { data: { user: null }, error: { message: "A user with this email address has already been registered", status: 422 } };
        }
        const u = { id: randomUUID(), email: p.email, password: p.password, user_metadata: p.user_metadata || {} };
        this.usuariosAuth.push(u);
        // o gatilho trg_criar_profile_do_usuario
        this.inserir("profiles", { user_id: u.id, email: u.email, name: u.user_metadata.name ?? null, role: "user", status: "suspenso", expira_em: null, phone: null, partner_id: null });
        return { data: { user: { id: u.id, email: u.email } }, error: null };
      },
      updateUserById: async (id: string, attrs: any) => {
        this.chamadas.push({ tipo: "auth.updateUserById", args: { id, attrs } });
        const u = this.usuariosAuth.find((x) => x.id === id);
        if (!u) return { data: { user: null }, error: { message: "User not found", status: 404 } };
        Object.assign(u, attrs);
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        this.chamadas.push({ tipo: "auth.deleteUser", args: { id } });
        this.usuariosAuth = this.usuariosAuth.filter((u) => u.id !== id);
        this.tabelas.profiles = this.tabela("profiles").filter((p) => p.user_id !== id);
        return { data: {}, error: null };
      },
    },
  };
}

class Consulta implements PromiseLike<Resultado> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private sel: string | null = null;
  private filtros: { col: string; f: Filtro }[] = [];
  private ordem: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private unico: "single" | "maybe" | null = null;
  private valores: Linha | Linha[] | null = null;
  private conflito: string[] | null = null;

  constructor(private db: SupabaseFalso, private nome: string) {}

  select(cols = "*") { this.sel = cols; return this; }
  insert(v: Linha | Linha[]) { this.op = "insert"; this.valores = v; return this; }
  update(v: Linha) { this.op = "update"; this.valores = v; return this; }
  upsert(v: Linha | Linha[], o?: { onConflict?: string }) {
    this.op = "upsert"; this.valores = v; this.conflito = o?.onConflict ? o.onConflict.split(",").map((s) => s.trim()) : null; return this;
  }
  delete() { this.op = "delete"; return this; }

  private filtro(col: string, op: string, val: any) { this.filtros.push({ col, f: (l) => comparar(op, l[col], val) }); return this; }
  eq(c: string, v: any) { return this.filtro(c, "eq", v); }
  neq(c: string, v: any) { return this.filtro(c, "neq", v); }
  gt(c: string, v: any) { return this.filtro(c, "gt", v); }
  gte(c: string, v: any) { return this.filtro(c, "gte", v); }
  lt(c: string, v: any) { return this.filtro(c, "lt", v); }
  lte(c: string, v: any) { return this.filtro(c, "lte", v); }
  is(c: string, v: any) { return this.filtro(c, "is", v); }
  not(c: string, op: string, v: any) { this.filtros.push({ col: c, f: (l) => !comparar(op, l[c], v) }); return this; }
  in(c: string, v: any[]) { return this.filtro(c, "in", v); }
  ilike(c: string, v: string) { return this.filtro(c, "ilike", v); }
  or(expr: string) { this.filtros.push({ col: "", f: filtroOu(expr) }); return this; }
  order(col: string, o?: { ascending?: boolean }) { this.ordem.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.unico = "single"; return this; }
  maybeSingle() { this.unico = "maybe"; return this; }

  then<A = Resultado, B = never>(ok?: ((r: Resultado) => A | PromiseLike<A>) | null, falha?: ((e: any) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.executar()).then(ok, falha);
  }

  // Junta as linhas embutidas e aplica os filtros "tabela.coluna" nelas.
  private comEmbutidos(linhas: Linha[], sel: string): Linha[] {
    let r = linhas.map((l) => ({ ...l }));
    for (const e of lerSelect(sel).embutidos) {
      const rel = RELACOES[`${this.nome}.${e.tabela}`];
      if (!rel) throw new Error(`relação ${this.nome}.${e.tabela} não configurada no falso`);
      const cols = lerSelect(e.colunas).colunas;
      const filtros = this.filtros.filter((f) => f.col.startsWith(`${e.tabela}.`));
      r = r.flatMap((l) => {
        const alvo = this.db.tabela(e.tabela).find((x) => x[rel.remoto] === l[rel.local]);
        const comPrefixo = alvo && Object.fromEntries(Object.entries(alvo).map(([k, v]) => [`${e.tabela}.${k}`, v]));
        const passou = !!alvo && filtros.every((f) => f.f(comPrefixo!));
        if (e.inner && !passou) return [];
        l[e.alias] = passou ? projetar(alvo!, cols) : null;
        return [l];
      });
    }
    return r;
  }

  private filtradas(): Linha[] {
    const proprias = this.filtros.filter((f) => !f.col.includes("."));
    return this.db.tabela(this.nome).filter((l) => proprias.every((f) => f.f(l)));
  }

  private violaUnica(l: Linha): boolean {
    return (UNICAS[this.nome] || []).some((chave) =>
      this.db.tabela(this.nome).some((x) => chave.every((c) => x[c] != null && x[c] === l[c])));
  }

  // Projeção, ordem, limite e single/maybeSingle, como o PostgREST devolve.
  private finalizar(linhas: Linha[]): Resultado {
    const semRetorno = this.op !== "select" && this.sel === null;
    let r = linhas;
    if (!semRetorno) {
      const sel = this.sel ?? "*";
      const { colunas, embutidos } = lerSelect(sel);
      r = this.comEmbutidos(r, sel).map((l) => ({
        ...projetar(l, colunas),
        ...Object.fromEntries(embutidos.map((e) => [e.alias, l[e.alias]])),
      }));
    }
    for (const o of [...this.ordem].reverse()) {
      r = [...r].sort((a, b) => (a[o.col] === b[o.col] ? 0 : (a[o.col] > b[o.col] ? 1 : -1) * (o.asc ? 1 : -1)));
    }
    if (this.lim !== null) r = r.slice(0, this.lim);
    if (this.unico) {
      if (r.length > 1) return { data: null, error: { code: "PGRST116", message: "várias linhas" } };
      if (r.length === 0) {
        return this.unico === "single" ? { data: null, error: { code: "PGRST116", message: "nenhuma linha" } } : { data: null, error: null };
      }
      return { data: r[0], error: null };
    }
    return { data: semRetorno ? null : r, error: null };
  }

  private executar(): Resultado {
    const t = this.db.tabela(this.nome);
    if (this.op === "select") return this.finalizar(this.filtradas());
    if (this.op === "insert") {
      const lista = Array.isArray(this.valores) ? this.valores : [this.valores!];
      for (const v of lista) if (this.violaUnica(v)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      return this.finalizar(lista.map((v) => this.db.inserir(this.nome, v)));
    }
    if (this.op === "upsert") {
      const lista = Array.isArray(this.valores) ? this.valores : [this.valores!];
      const chave = this.conflito || ["id"];
      return this.finalizar(lista.map((v) => {
        const achada = t.find((x) => chave.every((c) => x[c] === v[c]));
        return achada ? Object.assign(achada, v) : this.db.inserir(this.nome, v);
      }));
    }
    if (this.op === "update") {
      const alvo = this.filtradas();
      for (const l of alvo) Object.assign(l, this.valores);
      return this.finalizar(alvo);
    }
    const apagar = new Set(this.filtradas());
    this.db.tabelas[this.nome] = t.filter((l) => !apagar.has(l));
    return this.finalizar([...apagar]);
  }
}
