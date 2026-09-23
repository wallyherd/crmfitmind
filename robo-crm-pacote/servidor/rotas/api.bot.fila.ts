import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { autenticarConector } from "./api.bot.eventos";

/**
 * O conector busca aqui o que precisa ser enviado pelo WhatsApp.
 *
 * A nuvem não alcança o PC da academia, então quem puxa é ele. Devolve as
 * mensagens pendentes daquela conexão e marca como enviadas quando o conector
 * confirma (em /api/bot/confirmar).
 */

const db = supabaseAdmin as unknown as { from: (t: string) => any };

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export const Route = createFileRoute("/api/bot/fila")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const conexao = await autenticarConector(request);
        if (!conexao) return json({ erro: "conexao ou segredo invalido" }, 401);

        const url = new URL(request.url);
        const limite = Math.min(Math.max(Number(url.searchParams.get("limite") || 10), 1), 50);

        const agora = new Date();
        // Duas travas de tempo, com propósitos diferentes:
        //  - agendado_para: o disparo sai espaçado, sem precisar de agendador
        //  - entregue_em: a mesma mensagem não sai de novo enquanto o conector
        //    ainda está com ela na mão
        const reentrega = new Date(agora.getTime() - 2 * 60_000).toISOString();

        /*
         * A conexão entra pelo join, não por uma lista de ids.
         *
         * Antes esta rota carregava TODAS as conversas da conexão e filtrava as
         * mensagens com `.in("conversa_id", ...)`. O supabase-js põe esse IN na
         * URL do GET, e o gateway do Supabase corta em ~16 KB: medido em 11/09,
         * passa com 380 ids e cai com 400. Campanha cria uma conversa por pessoa,
         * então um número chegava lá em semanas — e dali em diante nenhuma
         * resposta saía, enquanto as recebidas continuavam gravando e o painel
         * parecia normal.
         */
        const { data: pendentes, error } = await db
          .from("bot_mensagens")
          .select("id, conversa_id, corpo, bot_conversas!inner(telefone, jid, conexao_id)")
          .eq("bot_conversas.conexao_id", conexao.id)
          .eq("direcao", "saida")
          .eq("status", "pendente")
          .or(`agendado_para.is.null,agendado_para.lte.${agora.toISOString()}`)
          .or(`entregue_em.is.null,entregue_em.lt.${reentrega}`)
          .order("created_at", { ascending: true })
          .limit(limite);

        if (error) return json({ erro: error.message }, 500);

        type Pendente = {
          id: string;
          corpo: string | null;
          bot_conversas: { telefone: string; jid: string | null } | null;
        };
        const mensagens = ((pendentes ?? []) as Pendente[])
          .map((m) => ({
            id: m.id,
            telefone: m.bot_conversas?.telefone ?? "",
            // Quando existe, o conector responde direto para este endereço em
            // vez de remontar um a partir dos dígitos.
            jid: m.bot_conversas?.jid ?? null,
            corpo: m.corpo ?? "",
          }))
          .filter((m) => (m.telefone || m.jid) && m.corpo);

        // Marca ANTES de responder. Se o conector cair no meio, a marca expira
        // em 2 minutos e a mensagem volta sozinha — melhor do que arriscar
        // entregar duas vezes por causa de uma queda.
        if (mensagens.length) {
          await db
            .from("bot_mensagens")
            .update({ entregue_em: agora.toISOString() })
            .in("id", mensagens.map((m) => m.id));
        }

        return json({ mensagens });
      },
    },
  },
});
