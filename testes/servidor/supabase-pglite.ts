// Supabase falso que fala com um PGlite de verdade (o mesmo esquema das migrações): from()/rpc()/storage/auth
// com o pedaço da API do supabase-js que as rotas das Fases 2 e 3 usam. Como a service role, não aplica RLS:
// quem filtra por empresa é o código da rota, e é isso que os testes conferem.
type Resultado = { data: any; error: any };

function normalizar(v: any): any {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "bigint") return Number(v);
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizar(x)]));
  return v;
}

// Colunas numeric chegam como número, como no PostgREST.
const NUMERICOS = new Set(["valor", "preco", "preco_minimo", "meta", "limiar_confianca", "teto_autoconfirmacao", "categoria_confianca", "ha_horas"]);
function linhaJson(l: Record<string, any>) {
  const r = normalizar(l);
  for (const k of Object.keys(r)) if (NUMERICOS.has(k) && typeof r[k] === "string") r[k] = Number(r[k]);
  return r;
}

const parametro = (v: any) => (v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? JSON.stringify(v) : v);

class Consulta implements PromiseLike<Resultado> {
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private sel: string | null = null;
  private onde: string[] = [];
  private params: any[] = [];
  private ordem: string[] = [];
  private lim: number | null = null;
  private unico: "single" | "maybe" | null = null;
  private valores: Record<string, any> | Record<string, any>[] | null = null;
  private conflito: string[] = [];

  constructor(private pg: any, private tabela: string) {}

  select(cols = "*") { this.sel = cols; return this; }
  insert(v: any) { this.op = "insert"; this.valores = v; return this; }
  update(v: any) { this.op = "update"; this.valores = v; return this; }
  upsert(v: any, o?: { onConflict?: string }) { this.op = "upsert"; this.valores = v; this.conflito = (o?.onConflict ?? "id").split(",").map((s) => s.trim()); return this; }
  delete() { this.op = "delete"; return this; }

  private cond(col: string, op: string, v: any) {
    this.params.push(parametro(v));
    this.onde.push(`"${col}" ${op} $${this.params.length}`);
    return this;
  }
  eq(c: string, v: any) { return this.cond(c, "=", v); }
  neq(c: string, v: any) { return this.cond(c, "<>", v); }
  gt(c: string, v: any) { return this.cond(c, ">", v); }
  gte(c: string, v: any) { return this.cond(c, ">=", v); }
  lt(c: string, v: any) { return this.cond(c, "<", v); }
  lte(c: string, v: any) { return this.cond(c, "<=", v); }
  ilike(c: string, v: string) { return this.cond(c, "ILIKE", v); }
  is(c: string, v: null) { this.onde.push(`"${c}" IS NULL`); return this; }
  not(c: string, op: string, v: null) { if (op !== "is" || v !== null) throw new Error("not() só com is.null no falso"); this.onde.push(`"${c}" IS NOT NULL`); return this; }
  in(c: string, v: any[]) { this.params.push(v); this.onde.push(`"${c}" = ANY($${this.params.length})`); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ordem.push(`"${c}" ${o?.ascending === false ? "DESC" : "ASC"}`); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.unico = "single"; return this; }
  maybeSingle() { this.unico = "maybe"; return this; }

  then<A = Resultado, B = never>(ok?: ((r: Resultado) => A | PromiseLike<A>) | null, falha?: ((e: any) => B | PromiseLike<B>) | null) {
    return this.executar().then(ok, falha);
  }

  private async executar(): Promise<Resultado> {
    try {
      const { sql, params } = this.montar();
      const { rows } = await this.pg.query(sql, params);
      const linhas = rows.map(linhaJson);
      const devolve = this.op === "select" || this.sel !== null;
      if (this.unico) {
        if (linhas.length > 1 || (linhas.length === 0 && this.unico === "single")) return { data: null, error: { code: "PGRST116", message: "esperava uma linha" } };
        return { data: linhas[0] ?? null, error: null };
      }
      return { data: devolve ? linhas : null, error: null };
    } catch (e: any) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  }

  private montar(): { sql: string; params: any[] } {
    const t = `public."${this.tabela}"`;
    const params = [...this.params];
    const where = this.onde.length ? ` WHERE ${this.onde.join(" AND ")}` : "";
    const colunasSel = this.sel ?? "*";
    if (this.op === "select") {
      return {
        sql: `SELECT ${colunasSel} FROM ${t}${where}${this.ordem.length ? ` ORDER BY ${this.ordem.join(", ")}` : ""}${this.lim !== null ? ` LIMIT ${this.lim}` : ""}`,
        params,
      };
    }
    const retorno = ` RETURNING ${colunasSel}`;
    if (this.op === "delete") return { sql: `DELETE FROM ${t}${where}${retorno}`, params };
    if (this.op === "update") {
      const sets = Object.entries(this.valores as Record<string, any>).map(([k, v]) => {
        params.push(parametro(v));
        return `"${k}" = $${params.length}`;
      });
      return { sql: `UPDATE ${t} SET ${sets.join(", ")}${where}${retorno}`, params };
    }
    const lista = Array.isArray(this.valores) ? this.valores : [this.valores as Record<string, any>];
    const cols = Object.keys(lista[0]);
    const linhas = lista.map((l) => `(${cols.map((c) => (params.push(parametro(l[c])), `$${params.length}`)).join(", ")})`);
    let sql = `INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES ${linhas.join(", ")}`;
    if (this.op === "upsert") {
      const atualizar = cols.filter((c) => !this.conflito.includes(c));
      sql += ` ON CONFLICT (${this.conflito.map((c) => `"${c}"`).join(", ")}) DO ` + (atualizar.length ? `UPDATE SET ${atualizar.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")}` : "NOTHING");
    }
    return { sql: sql + retorno, params };
  }
}

export class SupabasePglite {
  tokens = new Map<string, { id: string; email: string }>();
  arquivos = new Map<string, string>();
  falhaUpload = false;
  falhaRemove = false;
  // Arquivos binários (comprovantes) com o tipo declarado no upload, e os links assinados que a rota pediu.
  binarios = new Map<string, { corpo: Buffer; contentType?: string }>();
  linksAssinados: { bucket: string; caminho: string; segundos: number }[] = [];
  falhaAssinar = false;
  chamadasAuth: { tipo: string; args: any }[] = [];
  chamadas: { nome: string; args: any }[] = [];

  constructor(private pg: any) {}

  from(tabela: string) {
    return new Consulta(this.pg, tabela);
  }

  async rpc(nome: string, args: Record<string, unknown> = {}): Promise<Resultado> {
    this.chamadas.push({ nome, args });
    const chaves = Object.keys(args);
    const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(", ");
    const valores = chaves.map((k) => parametro(args[k]));
    try {
      const { rows: [f] } = await this.pg.query(`SELECT proretset, prorettype::regtype::text AS tipo FROM pg_proc WHERE proname = $1 LIMIT 1`, [nome]);
      if (!f) return { data: null, error: { message: `função ${nome} não existe` } };
      if (f.proretset) return { data: normalizar((await this.pg.query(`SELECT * FROM public.${nome}(${lista})`, valores)).rows).map(linhaJson), error: null };
      if (f.tipo === "void") {
        await this.pg.query(`SELECT public.${nome}(${lista})`, valores);
        return { data: null, error: null };
      }
      // to_jsonb entrega o composto (ex.: public.vendas) como objeto, como o PostgREST.
      const { rows: [l] } = await this.pg.query(`SELECT to_jsonb(public.${nome}(${lista})) AS r`, valores);
      return { data: normalizar(l.r), error: null };
    } catch (e: any) {
      return { data: null, error: { code: e.code, message: e.message } };
    }
  }

  auth = {
    getUser: async (token: string) => {
      const u = this.tokens.get(token);
      return u ? { data: { user: u }, error: null } : { data: { user: null }, error: { message: "invalid JWT", status: 401 } };
    },
    // O usuário vai para auth.users (o gatilho do esquema cria o profile) e ganha o token "tok-<email>".
    admin: {
      createUser: async (p: { email: string; password?: string; user_metadata?: Record<string, unknown> }) => {
        this.chamadasAuth.push({ tipo: "createUser", args: { email: p.email } });
        const { rows: [existente] } = await this.pg.query(`SELECT id FROM auth.users WHERE email = $1`, [p.email]);
        if (existente) return { data: { user: null }, error: { message: "User already registered", status: 422 } };
        const { rows: [u] } = await this.pg.query(
          `INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2::jsonb) RETURNING id`, [p.email, JSON.stringify(p.user_metadata ?? {})]);
        this.tokens.set(`tok-${p.email}`, { id: u.id, email: p.email });
        return { data: { user: { id: u.id, email: p.email } }, error: null };
      },
      updateUserById: async (id: string, attrs: any) => {
        this.chamadasAuth.push({ tipo: "updateUserById", args: { id, attrs } });
        return { data: { user: { id } }, error: null };
      },
      deleteUser: async (id: string) => {
        this.chamadasAuth.push({ tipo: "deleteUser", args: { id } });
        await this.pg.query(`DELETE FROM auth.users WHERE id = $1`, [id]);
        return { data: {}, error: null };
      },
    },
  };

  storage = {
    from: (bucket: string) => ({
      upload: async (caminho: string, corpo: Buffer, opcoes?: { contentType?: string }) => {
        if (this.falhaUpload) return { data: null, error: { message: "storage fora do ar" } };
        this.arquivos.set(`${bucket}/${caminho}`, corpo.toString("utf8"));
        this.binarios.set(`${bucket}/${caminho}`, { corpo: Buffer.from(corpo), contentType: opcoes?.contentType });
        return { data: { path: caminho }, error: null };
      },
      download: async (caminho: string) => {
        const bin = this.binarios.get(`${bucket}/${caminho}`);
        if (bin) return { data: new Blob([new Uint8Array(bin.corpo)]), error: null }; // bytes de verdade (imagem/PDF)
        const t = this.arquivos.get(`${bucket}/${caminho}`);
        return t === undefined ? { data: null, error: { message: "Object not found" } } : { data: new Blob([t]), error: null };
      },
      remove: async (caminhos: string[]) => {
        if (this.falhaRemove) return { data: null, error: { message: "storage fora do ar" } };
        for (const c of caminhos) {
          this.arquivos.delete(`${bucket}/${c}`);
          this.binarios.delete(`${bucket}/${c}`);
        }
        return { data: caminhos.map((name) => ({ name })), error: null };
      },
      createSignedUrl: async (caminho: string, segundos: number) => {
        if (this.falhaAssinar) return { data: null, error: { message: "storage fora do ar" } };
        this.linksAssinados.push({ bucket, caminho, segundos });
        return { data: { signedUrl: `https://storage.falso/${bucket}/${caminho}?token=abc&expira=${segundos}` }, error: null };
      },
    }),
  };
}
