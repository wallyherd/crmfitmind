// Mensagem sugerida pela IA: copiar, editar, abrir no WhatsApp ou descartar.
// Cada uso vira retorno para a IA (POST /api/ia/sugestoes/:id) — é assim que ela aprende o tom.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, MessageCircle, Pencil, Check, Trash2 } from "lucide-react";
import { responderSugestao } from "@/lib/api-comercial";
import { linkWhatsApp } from "@/lib/formatos";
import { abrirLink, copiarTexto } from "@/lib/navegador";
import { CLASSE_BOTAO_LEVE, CLASSE_INPUT } from "@/components/Pecas";
import type { RespostaSugestao } from "@/types";

interface Props {
  texto: string;
  sugestaoId: string | null;
  telefone: string | null;
  /** Compacta: só o texto e o botão do WhatsApp (lista "O que fazer agora"). */
  compacta?: boolean;
}

export const MensagemSugerida: React.FC<Props> = ({ texto, sugestaoId, telefone, compacta = false }) => {
  const [rascunho, setRascunho] = useState(texto);
  const [editando, setEditando] = useState(false);
  const [registrado, setRegistrado] = useState<{ acao: RespostaSugestao["acao"]; texto: string } | null>(null);
  const [descartando, setDescartando] = useState(false);
  const [motivo, setMotivo] = useState("");

  // Outro relatório/outra pendência no mesmo lugar da tela: começa do zero.
  useEffect(() => {
    setRascunho(texto);
    setEditando(false);
    setRegistrado(null);
    setDescartando(false);
    setMotivo("");
  }, [texto, sugestaoId]);

  const editado = rascunho.trim() !== texto.trim();
  const link = linkWhatsApp(telefone, rascunho);

  // Registra uma vez por texto: copiar duas vezes o mesmo texto não conta dois usos.
  const registrar = async (acao: RespostaSugestao["acao"], motivoDescarte?: string) => {
    if (!sugestaoId) return;
    const acaoFinal: RespostaSugestao["acao"] = acao === "descartou" ? "descartou" : editado ? "editou" : "usou";
    if (registrado && registrado.acao === acaoFinal && registrado.texto === rascunho) return;
    const resposta: RespostaSugestao = { acao: acaoFinal };
    if (acaoFinal === "editou") resposta.texto_final = rascunho.trim();
    if (acaoFinal === "descartou" && motivoDescarte?.trim()) resposta.motivo = motivoDescarte.trim().slice(0, 200);
    try {
      await responderSugestao(sugestaoId, resposta);
      setRegistrado({ acao: acaoFinal, texto: rascunho });
    } catch {
      // O mentorado já copiou/abriu; só o aprendizado fica sem esse retorno.
      if (acaoFinal === "descartou") toast.error("Não consegui registrar o descarte. Tente de novo.");
    }
  };

  const copiar = async () => {
    if (await copiarTexto(rascunho)) {
      toast.success("Mensagem copiada.");
      registrar("usou");
    } else {
      toast.error("Não consegui copiar. Selecione o texto e copie à mão.");
    }
  };

  const abrirWhatsApp = () => {
    if (!link) return;
    abrirLink(link); // antes de qualquer await, para o navegador não bloquear a aba
    registrar("usou");
  };

  const descartar = async () => {
    await registrar("descartou", motivo);
    setDescartando(false);
  };

  if (registrado?.acao === "descartou") {
    return <p className="text-[11px] text-slate-500 italic">Sugestão descartada. A IA vai levar isso em conta.</p>;
  }

  const botaoWhatsApp = (
    <button
      onClick={abrirWhatsApp}
      disabled={!link}
      title={link ? "Abre a conversa com a mensagem pronta" : "Contato sem telefone"}
      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-bold transition"
    >
      <MessageCircle className="w-3.5 h-3.5" /> Abrir no WhatsApp
    </button>
  );

  if (compacta) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-slate-300 leading-relaxed line-clamp-2 break-words">“{rascunho}”</p>
        <div className="flex flex-wrap gap-1.5">
          {botaoWhatsApp}
          <button onClick={copiar} className={CLASSE_BOTAO_LEVE}>
            <Copy className="w-3 h-3" /> Copiar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-black/50 border border-white/10 p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Mensagem sugerida</span>
        {registrado && (
          <span className="text-[10px] text-slate-500">{registrado.acao === "editou" ? "Editada e usada" : "Usada"}</span>
        )}
      </div>

      {editando ? (
        <textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          rows={4}
          maxLength={1000}
          className={`${CLASSE_INPUT} resize-y leading-relaxed`}
          aria-label="Editar mensagem sugerida"
        />
      ) : (
        <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">{rascunho}</p>
      )}

      {descartando ? (
        <div className="space-y-2">
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            maxLength={200}
            placeholder="Por que não serve? (opcional, ajuda a IA)"
            className={CLASSE_INPUT}
          />
          <div className="flex flex-wrap gap-1.5">
            <button onClick={descartar} className={CLASSE_BOTAO_LEVE}>
              <Trash2 className="w-3 h-3" /> Descartar sugestão
            </button>
            <button onClick={() => setDescartando(false)} className={CLASSE_BOTAO_LEVE}>
              Voltar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {botaoWhatsApp}
          <button onClick={copiar} className={CLASSE_BOTAO_LEVE}>
            <Copy className="w-3 h-3" /> Copiar
          </button>
          <button onClick={() => setEditando((v) => !v)} className={CLASSE_BOTAO_LEVE}>
            {editando ? <Check className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
            {editando ? "Pronto" : "Editar"}
          </button>
          {sugestaoId && (
            <button onClick={() => setDescartando(true)} className={CLASSE_BOTAO_LEVE}>
              <Trash2 className="w-3 h-3" /> Não serve
            </button>
          )}
        </div>
      )}
    </div>
  );
};
