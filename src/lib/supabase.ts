const DEFAULT_SUPABASE_URL = "";
const DEFAULT_SUPABASE_KEY = "";

// Configuração persistida ou variáveis de ambiente
export const getStoredConfig = () => {
  try {
    const url =
      localStorage.getItem("crm_supabase_url") ||
      import.meta.env.VITE_SUPABASE_URL ||
      DEFAULT_SUPABASE_URL;
    const key =
      localStorage.getItem("crm_supabase_anon_key") ||
      import.meta.env.VITE_SUPABASE_ANON_KEY ||
      DEFAULT_SUPABASE_KEY;
    return { url, key };
  } catch {
    return {
      url: import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL,
      key: import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_KEY,
    };
  }
};

export function createRestClient(baseUrl: string, apiKey: string) {
  return {
    from(table: string) {
      const state = {
        table,
        method: "GET",
        params: new URLSearchParams(),
        body: null as string | null,
        isSingle: false,
        headers: {
          apikey: apiKey,
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        } as Record<string, string>,
      };

      const builder = {
        select(cols = "*") {
          state.params.set("select", cols);
          return builder;
        },
        eq(col: string, val: any) {
          state.params.set(col, `eq.${val}`);
          return builder;
        },
        order(col: string, { ascending = true }: { ascending?: boolean } = {}) {
          state.params.set("order", `${col}.${ascending ? "asc" : "desc"}`);
          return builder;
        },
        maybeSingle() {
          state.isSingle = true;
          state.headers["Accept"] = "application/vnd.pgrst.object+json";
          return builder;
        },
        single() {
          state.isSingle = true;
          state.headers["Accept"] = "application/vnd.pgrst.object+json";
          return builder;
        },
        insert(data: any) {
          state.method = "POST";
          state.body = JSON.stringify(data);
          return builder;
        },
        update(data: any) {
          state.method = "PATCH";
          state.body = JSON.stringify(data);
          return builder;
        },
        delete() {
          state.method = "DELETE";
          return builder;
        },
        async then(resolve: (res: { data: any; error: any }) => void) {
          try {
            const query = state.params.toString();
            const endpoint = `${baseUrl}/rest/v1/${state.table}${query ? `?${query}` : ""}`;
            const res = await fetch(endpoint, {
              method: state.method,
              headers: state.headers,
              body: state.body,
            });

            if (!res.ok) {
              const err = await res.json().catch(() => ({ message: res.statusText }));
              return resolve({ data: null, error: err });
            }

            if (res.status === 204) {
              return resolve({ data: null, error: null });
            }

            const data = await res.json().catch(() => null);
            return resolve({ data, error: null });
          } catch (err: any) {
            return resolve({ data: null, error: err });
          }
        },
      };

      return builder;
    },
    auth: {
      persistSession: true,
      async signOut() {
        localStorage.removeItem("crm_auth_user");
      },
      async getSession() {
        const user = localStorage.getItem("crm_auth_user");
        return { data: { session: user ? { user: JSON.parse(user) } : null } };
      },
      onAuthStateChange(cb: any) {
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  };
}

const config = getStoredConfig();

export const supabase = createRestClient(config.url, config.key) as any;

export const updateSupabaseConfig = (url: string, key: string) => {
  localStorage.setItem("crm_supabase_url", url);
  localStorage.setItem("crm_supabase_anon_key", key);
  window.location.reload();
};
