import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

let clientInstance: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (clientInstance) return clientInstance;

  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "https://sua-empresa.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "sua-chave-service-role";

  clientInstance = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return clientInstance;
}

export function reconfigureSupabaseAdmin(url: string, serviceRoleKey: string) {
  process.env.SUPABASE_URL = url;
  process.env.VITE_SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

  clientInstance = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Salva no .env
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    let content = "";
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, "utf8");
    }
    const lines = content.split("\n").filter((l) => !l.startsWith("SUPABASE_URL") && !l.startsWith("VITE_SUPABASE_URL") && !l.startsWith("SUPABASE_SERVICE_ROLE_KEY"));
    lines.push(`SUPABASE_URL=${url}`);
    lines.push(`VITE_SUPABASE_URL=${url}`);
    lines.push(`SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`);
    fs.writeFileSync(envPath, lines.join("\n"), "utf8");
  } catch (err) {
    console.warn("Não foi possível salvar no .env:", err);
  }

  return clientInstance;
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get: (_, prop) => {
    const client = getSupabaseAdmin();
    const val = (client as any)[prop];
    if (typeof val === "function") {
      return val.bind(client);
    }
    return val;
  },
});

export type Db = SupabaseClient;
