import { createFileRoute } from "@tanstack/react-router";

/**
 * Solta os avisos de vencimento sem ninguém apertar o botão.
 *
 * Roda de hora em hora. Quem decide SE e QUANDO é o banco
 * (`academia_avisos_a_disparar`), pelo fuso de cada academia — aqui não existe
 * nenhuma conta de horário. Isso é deliberado: `new Date()` neste servidor está
 * em UTC, e foi assim que a cota diária do chip passou a virar às 20h de Cuiabá.
 *
 * O disparo em si é `executarDisparo`, o MESMO caminho do botão. Uma segunda
 * cópia da lógica significaria uma proteção corrigida só de um lado — e o lado
 * esquecido seria justamente este, que roda sem ninguém olhando.
 */

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/public/hooks/avisos-automaticos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey =
          request.headers.get("apikey") ||
          request.headers.get("authorization")?.replace("Bearer ", "");
        const expected =
          process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (!apiKey || !expected || apiKey !== expected) {
          return json({ error: "unauthorized" }, 401);
        }

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { executarDisparo } = await import("@/lib/bot-disparos.functions");
          const db = supabaseAdmin as unknown as {
            from: (t: string) => any;
            rpc: (fn: string, args?: Record<string, unknown>) => any;
          };

          const { data, error } = await db.rpc("academia_avisos_a_disparar");
          if (error) return json({ ok: false, error: error.message }, 500);

          const aDisparar = (data ?? []) as Array<{
            disparo_id: string; partner_id: string; nome: string; alvos: number;
          }>;
          if (!aDisparar.length) return json({ ok: true, disparadas: 0 });

          const resultado: Array<Record<string, unknown>> = [];
          for (const item of aDisparar) {
            /*
             * Relê a campanha e confere que ainda é rascunho.
             *
             * Entre a consulta e este ponto alguém pode ter apertado o botão na
             * tela. Sem esta conferência, a mesma campanha sairia duas vezes —
             * e mensagem repetida da academia é exatamente o que faz o cliente
             * bloquear o número.
             */
            const { data: d } = await db
              .from("bot_disparos").select("*").eq("id", item.disparo_id).maybeSingle();
            const disparo = d as { status: string } | null;
            if (!disparo || disparo.status !== "rascunho") {
              resultado.push({ nome: item.nome, pulada: "ja nao era rascunho" });
              continue;
            }

            try {
              const r = await executarDisparo(db, disparo as never);
              resultado.push({ nome: item.nome, ...r });
            } catch (e) {
              // Uma campanha que falha não pode impedir a próxima: cada academia
              // tem o seu número, e o problema de uma não é o da outra.
              resultado.push({
                nome: item.nome,
                erro: e instanceof Error ? e.message : String(e),
              });
            }
          }

          return json({ ok: true, disparadas: resultado.length, resultado });
        } catch (e: any) {
          console.error("[avisos-automaticos]", e);
          return json({ ok: false, error: String(e?.message || e) }, 500);
        }
      },
    },
  },
});
