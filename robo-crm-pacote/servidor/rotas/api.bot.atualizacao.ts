import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { autenticarConector } from "./api.bot.eventos";

/**
 * O conector pergunta aqui se existe versão mais nova dele.
 *
 * Mesmo desenho da auto-atualização do agente da catraca: a nuvem não alcança o
 * PC da academia, então quem pergunta é ele. Só o código viaja — o Node e as
 * dependências ficam onde estão.
 *
 * A comparação de versão é TEXTUAL, e é por isso que o formato tem dois dígitos
 * em cada parte (1.02.00). Sem os zeros, "1.9.0" pareceria maior que "1.10.0" e
 * o conector pararia de se atualizar sem ninguém perceber.
 */

const db = supabaseAdmin as unknown as { from: (t: string) => any };

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/bot/atualizacao")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const conexao = await autenticarConector(request);
        if (!conexao) return json({ erro: "conexao ou segredo invalido" }, 401);

        const url = new URL(request.url);
        const atual = String(url.searchParams.get("versao") || "0.00.00").slice(0, 20);

        // Registra o que este PC está rodando. É a única forma de saber, à
        // distância, se uma correção chegou de fato na academia.
        await db.from("bot_conexoes").update({ versao: atual }).eq("id", conexao.id);

        const { data, error } = await db
          .from("conector_versoes")
          .select("versao, arquivos, notas")
          .gt("versao", atual)
          .order("versao", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) return json({ erro: error.message }, 500);
        if (!data) return json({ novidade: false, versao: atual });

        const nova = data as { versao: string; arquivos: Record<string, string>; notas: string | null };
        return json({ novidade: true, versao: nova.versao, arquivos: nova.arquivos, notas: nova.notas });
      },
    },
  },
});
