import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { autenticarConector } from "./api.bot.eventos";

/**
 * O conector avisa aqui se conseguiu enviar a mensagem ou se deu erro.
 * Sem isto a mensagem ficaria pendente para sempre e seria reenviada em loop.
 */

const db = supabaseAdmin as unknown as { from: (t: string) => any };

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/bot/confirmar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const conexao = await autenticarConector(request);
        if (!conexao) return json({ erro: "conexao ou segredo invalido" }, 401);

        let corpo: Record<string, unknown> = {};
        try {
          corpo = await request.json();
        } catch {
          return json({ erro: "corpo invalido" }, 400);
        }

        const id = String(corpo.id ?? "");
        if (!id) return json({ erro: "id ausente" }, 400);

        const status = corpo.status === "erro" ? "erro" : "enviada";

        // confere que a mensagem pertence mesmo a esta conexão
        const { data: msg } = await db
          .from("bot_mensagens")
          .select("id, conversa_id, tentativas")
          .eq("id", id)
          .maybeSingle();
        const linha = msg as { id: string; conversa_id: string; tentativas: number } | null;
        if (!linha) return json({ erro: "mensagem nao encontrada" }, 404);

        const { data: conv } = await db
          .from("bot_conversas")
          .select("conexao_id")
          .eq("id", linha.conversa_id)
          .maybeSingle();
        if ((conv as { conexao_id: string } | null)?.conexao_id !== conexao.id) {
          return json({ erro: "mensagem de outra conexao" }, 403);
        }

        const { error } = await db
          .from("bot_mensagens")
          .update({
            status,
            enviada_em: status === "enviada" ? new Date().toISOString() : null,
            wa_id: corpo.waId ? String(corpo.waId).slice(0, 120) : null,
            erro: status === "erro" && corpo.erro ? String(corpo.erro).slice(0, 300) : null,
            tentativas: (linha.tentativas ?? 0) + 1,
          })
          .eq("id", id);

        if (error) return json({ erro: error.message }, 500);

        /*
         * O alvo da campanha anda junto com a mensagem.
         *
         * Sem isto ele ficava "enfileirado" para sempre: a mensagem chegava ao
         * cliente, o painel continuava dizendo que estava na fila, e o resumo
         * da campanha (que conta por status de alvo) nunca fechava. Foi o que
         * o Erick viu em 26/08 — "enviada" no conector, "enfileirado" na tela.
         *
         * A ligação já existia desde sempre: dispararCampanha grava
         * `mensagem_id` no alvo. Faltava alguém usar.
         */
        await db
          .from("bot_disparo_alvos")
          .update({
            status: status === "enviada" ? "enviado" : "erro",
            erro: status === "erro" && corpo.erro ? String(corpo.erro).slice(0, 300) : null,
          })
          .eq("mensagem_id", id);

        return json({ ok: true });
      },
    },
  },
});
