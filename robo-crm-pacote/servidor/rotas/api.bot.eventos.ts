import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Recebe os avisos do conector que roda no PC da academia.
 *
 * O PC fica atrás do roteador, sem IP fixo — a nuvem não alcança ele. Por isso
 * todas as chamadas partem de lá. Aqui chegam: mensagem recebida, mudança de
 * estado da conexão, batimento de "estou vivo" e teste de ligação.
 *
 * Autenticação: cabeçalhos x-bot-conexao e x-bot-segredo. O segredo é gerado
 * junto com a conexão e nunca sai do servidor para o navegador.
 */

const db = supabaseAdmin as unknown as {
  from: (t: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

/** Confere o par conexão + segredo. Devolve a conexão ou null. */
export async function autenticarConector(request: Request) {
  const id = request.headers.get("x-bot-conexao");
  const segredo = request.headers.get("x-bot-segredo");
  if (!id || !segredo) return null;

  const { data } = await db
    .from("bot_conexoes")
    .select("id, escopo, owner_id, webhook_segredo, status, arquivado_em")
    .eq("id", id)
    .maybeSingle();

  const conexao = data as {
    id: string;
    escopo: string;
    owner_id: string | null;
    webhook_segredo: string;
    arquivado_em: string | null;
  } | null;

  if (!conexao || conexao.arquivado_em) return null;
  if (conexao.webhook_segredo !== segredo) return null;
  return conexao;
}

export const Route = createFileRoute("/api/bot/eventos")({
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

        const tipo = String(corpo.tipo ?? "");
        const agora = new Date().toISOString();

        // toda chamada do conector prova que o PC da academia está no ar
        await db.from("bot_conexoes").update({ visto_em: agora }).eq("id", conexao.id);

        if (tipo === "teste" || tipo === "batimento") {
          return json({ ok: true });
        }

        if (tipo === "status") {
          const status = String(corpo.status ?? "desconectado");
          const permitidos = ["desconectado", "aguardando_qr", "conectado", "erro"];
          const atualizacao: Record<string, unknown> = {
            status: permitidos.includes(status) ? status : "erro",
            status_detalhe: corpo.detalhe ? String(corpo.detalhe).slice(0, 300) : null,
          };
          if (corpo.numero) atualizacao.numero = String(corpo.numero).replace(/\D/g, "").slice(0, 20);
          if (status === "conectado") atualizacao.conectado_em = agora;
          await db.from("bot_conexoes").update(atualizacao).eq("id", conexao.id);
          return json({ ok: true });
        }

        if (tipo === "mensagem") {
          const telefone = String(corpo.telefone ?? "").replace(/\D/g, "");
          if (!telefone) return json({ erro: "telefone ausente" }, 400);

          /*
           * O endereço de onde a mensagem veio, inteiro.
           *
           * É por ele que a resposta volta. Os dígitos sozinhos deixaram de
           * bastar quando o WhatsApp passou a endereçar conversas por LID
           * (`103843987759126@lid`): aqueles números não são telefone de
           * ninguém, e responder para eles não chega em lugar nenhum.
           */
          const jid = corpo.jid ? String(corpo.jid).slice(0, 120) : null;

          /*
           * Acha a conversa por JID e, se não achar, pelo telefone.
           *
           * A segunda tentativa não é zelo: sem ela o robô morre. A coluna `jid`
           * nasceu em 27/08 sem preencher o que já existia, então 93 das 96
           * conversas do banco têm `jid` NULO. Procurando só por JID, nenhuma
           * delas é encontrada — e o INSERT que vem em seguida bate na
           * constraint `bot_conversas_unica (conexao_id, telefone)`, a rota
           * devolve 500, e a mensagem NUNCA chega a ser gravada. Foi assim que
           * uma academia inteira ficou sem atendimento automático enquanto o
           * painel dizia "conectado".
           */
          const achar = (coluna: "jid" | "telefone", valor: string) =>
            db.from("bot_conversas").select("id, estado")
              .eq("conexao_id", conexao.id).eq(coluna, valor).maybeSingle();

          let { data: existente } = jid
            ? await achar("jid", jid)
            : await achar("telefone", telefone);
          if (!existente && jid) ({ data: existente } = await achar("telefone", telefone));

          let conversaId = (existente as { id: string } | null)?.id;
          if (!conversaId) {
            const { data: nova, error } = await db
              .from("bot_conversas")
              .insert({
                conexao_id: conexao.id,
                telefone,
                jid,
                nome: corpo.nome ? String(corpo.nome).slice(0, 120) : null,
                estado: "bot",
              })
              .select("id")
              .single();
            if (error) {
              /*
               * 23505 = alguém criou essa conversa entre a busca e o insert.
               * Pega a que existe e segue. Devolver 500 aqui seria pior que
               * inútil: o conector guarda o evento em disco e repete para
               * sempre, e o evento envenenado trava a fila local dele atrás.
               * Erro que a repetição não resolve nunca deve virar 500.
               */
              if (error.code !== "23505") return json({ erro: error.message }, 500);
              const { data: achada } = await achar("telefone", telefone);
              conversaId = (achada as { id: string } | null)?.id;
              if (!conversaId) return json({ erro: error.message }, 500);
              if (jid) await db.from("bot_conversas").update({ jid }).eq("id", conversaId);
            } else {
              conversaId = (nova as { id: string }).id;
            }
          } else {
            // Conversa que já existia: grava o JID se ainda não tinha. É assim
            // que a conversa aberta pelo nosso lado ganha endereço de volta
            // quando a pessoa responde.
            const remendo: Record<string, unknown> = {};
            if (corpo.nome) remendo.nome = String(corpo.nome).slice(0, 120);
            if (jid) remendo.jid = jid;
            if (Object.keys(remendo).length) {
              await db.from("bot_conversas").update(remendo).eq("id", conversaId);
            }
          }

          const tiposMidia = ["texto", "imagem", "audio", "video", "documento"];
          const tipoMidia = String(corpo.tipoMidia ?? "texto");

          // o índice único em (conversa_id, wa_id) faz o webhook repetido não duplicar
          const { error: erroMsg } = await db.from("bot_mensagens").insert({
            conversa_id: conversaId,
            direcao: "entrada",
            tipo: tiposMidia.includes(tipoMidia) ? tipoMidia : "texto",
            corpo: corpo.corpo ? String(corpo.corpo).slice(0, 4000) : null,
            wa_id: corpo.waId ? String(corpo.waId).slice(0, 120) : null,
            status: "recebida",
          });
          // 23505 = duplicata; é esperado quando o WhatsApp reenvia o mesmo evento
          if (erroMsg && erroMsg.code !== "23505") return json({ erro: erroMsg.message }, 500);

          // repetida: já foi processada antes, não roda o robô de novo
          if (erroMsg?.code === "23505") {
            return json({ ok: true, conversaId, repetida: true });
          }

          // o robô decide o que responder (verificação, funil, fluxo)
          let resultado = { acao: "sem processamento" };
          try {
            const { processarMensagem } = await import("@/lib/bot-engine");
            resultado = await processarMensagem(db, {
              conexao: { id: conexao.id, escopo: conexao.escopo, owner_id: conexao.owner_id },
              conversaId: conversaId!,
              telefone,
              texto: corpo.corpo ? String(corpo.corpo) : "",
              nome: corpo.nome ? String(corpo.nome) : null,
            });
          } catch (e) {
            // o robô falhar não pode fazer a mensagem se perder: ela já está salva
            console.error("[bot] motor falhou:", e);
          }

          return json({ ok: true, conversaId, ...resultado });
        }

        return json({ erro: `tipo desconhecido: ${tipo}` }, 400);
      },
    },
  },
});
