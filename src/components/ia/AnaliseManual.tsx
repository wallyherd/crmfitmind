// Motor manual: baixar o lote do dia (sem telefone), analisar no Claude do mentorado
// e colar o JSON de volta. Os erros do contrato (422) aparecem em lista para colar no Claude.
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, Download, FileUp, ListOrdered, RefreshCw } from "lucide-react";
import { ErroApi } from "@/lib/api";
import { baixarArquivoLote, importarAnalise, listarLotes } from "@/lib/api-comercial";
import { dataBr, extrairJson, hojeIso, ontemIso } from "@/lib/formatos";
import { baixarTexto, copiarTexto } from "@/lib/navegador";
import { STATUS_LOTE } from "@/lib/rotulos";
import {
  CLASSE_BOTAO,
  CLASSE_BOTAO_LEVE,
  CLASSE_BOTAO_SEC,
  CLASSE_INPUT,
  Carregando,
  ErroCarga,
  Painel,
  Selo,
  Vazio,
  mensagemDeErro,
} from "@/components/Pecas";
import type { LoteIa, ResultadoImportacao } from "@/types";

type Falha = { titulo: string; itens: string[]; podeSubstituir?: boolean };

function milTokens(n: number | null): string {
  if (!n) return "";
  return n >= 1000 ? `~${Math.round(n / 1000)} mil tokens` : `~${n} tokens`;
}

// --------------------------------------------------------------- 1. baixar o lote
const BaixarLote: React.FC<{ partnerId: string; diaInicial?: string }> = ({ partnerId, diaInicial }) => {
  const [dia, setDia] = useState(() => diaInicial ?? ontemIso());
  const [lotes, setLotes] = useState<LoteIa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setLotes(null);
    try {
      const lista = await listarLotes(partnerId, dia);
      setLotes([...lista].sort((a, b) => (a.parte || 1) - (b.parte || 1)));
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível buscar os lotes."));
    }
  }, [partnerId, dia]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const baixar = async (lote: LoteIa) => {
    setBaixando(lote.id);
    try {
      const texto = await baixarArquivoLote(lote.id);
      const parte = lotes && lotes.length > 1 ? `-parte${lote.parte || 1}` : "";
      baixarTexto(`conversas-${lote.dia || dia}${parte}.txt`, texto);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível baixar o arquivo."));
    } finally {
      setBaixando(null);
    }
  };

  return (
    <Painel titulo="1. Baixe o lote da IA" icone={Download}>
      <p className="text-[11px] text-slate-400 leading-relaxed">
        O lote é o arquivo com as conversas do dia, já sem telefone e só com o primeiro nome. Ele fica pronto às 04:30
        do dia seguinte. Dia muito movimentado vem em partes: analise e importe uma de cada vez.
      </p>
      <div className="flex items-end gap-2">
        <label className="w-44">
          <span className="block text-[11px] font-semibold text-slate-400 mb-1">Dia das conversas</span>
          <input
            type="date"
            value={dia}
            max={hojeIso()}
            onChange={(e) => e.target.value && setDia(e.target.value)}
            className={CLASSE_INPUT}
          />
        </label>
        <button onClick={carregar} className={CLASSE_BOTAO_SEC} aria-label="Buscar lotes de novo">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
      {!erro && lotes === null && <Carregando texto="Procurando o lote..." />}
      {lotes && lotes.length === 0 && (
        <Vazio>Ainda não há lote de {dataBr(dia)}. Se o dia acabou agora, ele fica pronto às 04:30.</Vazio>
      )}
      {lotes && lotes.length > 0 && (
        <ul className="space-y-2">
          {lotes.map((l) => (
            <li
              key={l.id}
              className="p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="text-xs text-white font-semibold flex flex-wrap items-center gap-2">
                {lotes.length > 1 ? `Parte ${l.parte || 1} de ${lotes.length}` : `Lote de ${dataBr(l.dia || dia)}`}
                <Selo tom={l.status === "concluido" ? "claro" : l.status === "erro" ? "vermelho" : "neutro"}>
                  {STATUS_LOTE[l.status]?.texto || l.status}
                </Selo>
                <span className="text-[11px] text-slate-500 font-normal">{milTokens(l.tokens_estimados)}</span>
              </div>
              <button onClick={() => baixar(l)} disabled={baixando === l.id} className={CLASSE_BOTAO}>
                <Download className="w-3.5 h-3.5" /> {baixando === l.id ? "Baixando..." : "Baixar lote da IA"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
};

// ------------------------------------------------------------ 3. importar o JSON
const ImportarAnalise: React.FC<{ partnerId: string }> = ({ partnerId }) => {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<Falha | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  const enviar = async (substituir = false) => {
    setFalha(null);
    setResultado(null);
    const bruto = extrairJson(texto);
    if (!bruto) {
      setFalha({ titulo: "Não achei a análise no texto colado.", itens: ["Copie a resposta inteira do Claude (o bloco que começa com { e termina com })."] });
      return;
    }
    let analise: any;
    try {
      analise = JSON.parse(bruto);
    } catch (e) {
      setFalha({
        titulo: "O texto colado não é um JSON válido.",
        itens: [`Detalhe: ${(e as Error).message}`, "Peça ao Claude: “responda só com o JSON completo, num bloco de código”."],
      });
      return;
    }
    if (analise?.partner_id && analise.partner_id !== partnerId) {
      setFalha({
        titulo: "Esta análise é de outra empresa.",
        itens: ["O partner_id do JSON não é o da empresa escolhida no topo da tela. Troque a empresa ou baixe o lote certo."],
      });
      return;
    }

    setEnviando(true);
    try {
      const r = await importarAnalise(analise, substituir);
      setResultado(r);
      setTexto("");
      toast.success(r?.duplicado ? "Esta análise já tinha sido importada." : "Análise importada. Veja no Relatório do dia.");
    } catch (e) {
      if (e instanceof ErroApi && e.status === 422) {
        setFalha({
          titulo: "O Claude devolveu algo fora do formato. Copie os erros, cole no Claude e peça “corrija”.",
          itens: e.detalhes.length ? e.detalhes : [e.message],
        });
      } else if (e instanceof ErroApi && e.status === 409) {
        setFalha({
          titulo: "Já existe uma análise diferente deste lote.",
          itens: [e.message, "Se esta é a versão corrigida, substitua a anterior."],
          podeSubstituir: !substituir,
        });
      } else {
        setFalha({ titulo: "Não foi possível importar.", itens: [mensagemDeErro(e)] });
      }
    } finally {
      setEnviando(false);
    }
  };

  const copiarErros = async () => {
    if (!falha) return;
    const ok = await copiarTexto(`Corrija o JSON. Erros:\n${falha.itens.map((i) => `- ${i}`).join("\n")}`);
    toast[ok ? "success" : "error"](ok ? "Erros copiados." : "Não consegui copiar.");
  };

  const res = resultado?.resultado;

  return (
    <Painel titulo="3. Importe a análise" icone={FileUp}>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder='Cole aqui a resposta do Claude: o JSON que começa com {"versao_contrato": "1", ...'
        className={`${CLASSE_INPUT} font-mono text-[11px] leading-relaxed resize-y`}
        aria-label="JSON da análise"
      />
      <div className="flex justify-end">
        <button onClick={() => enviar(false)} disabled={enviando || !texto.trim()} className={CLASSE_BOTAO}>
          <FileUp className="w-3.5 h-3.5" /> {enviando ? "Importando..." : "Importar análise"}
        </button>
      </div>

      {falha && (
        <div className="p-3 rounded-2xl bg-red-500/10 border border-red-500/30 space-y-2" role="alert">
          <p className="flex items-start gap-2 text-xs font-bold text-red-200">
            <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" /> {falha.titulo}
          </p>
          <ul className="space-y-1 max-h-60 overflow-y-auto">
            {falha.itens.map((item, i) => (
              <li key={i} className="text-[11px] text-red-100/90 font-mono break-words">
                • {item}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={copiarErros} className={CLASSE_BOTAO_LEVE}>
              <Copy className="w-3 h-3" /> Copiar erros
            </button>
            {falha.podeSubstituir && (
              <button onClick={() => enviar(true)} disabled={enviando} className={CLASSE_BOTAO_LEVE}>
                Substituir a análise anterior
              </button>
            )}
          </div>
        </div>
      )}

      {resultado && (
        <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/15 space-y-1.5">
          <p className="flex items-center gap-2 text-xs font-bold text-white">
            <CheckCircle2 className="w-4 h-4 text-red-400" /> Análise importada
          </p>
          {res && (
            <p className="text-[11px] text-slate-300">
              {res.contatos ?? 0} contatos · {res.tarefas ?? 0} follow-ups · {res.vendas_pendentes ?? 0} vendas a
              confirmar · {res.vendas_confirmadas ?? 0} confirmadas
              {res.rejeitados?.length ? ` · ${res.rejeitados.length} contatos ignorados por erro` : ""}
            </p>
          )}
        </div>
      )}
    </Painel>
  );
};

// ------------------------------------------------------------------------ a aba
export const AnaliseManual: React.FC<{ partnerId: string; diaInicial?: string }> = ({ partnerId, diaInicial }) => (
  <div className="space-y-4">
    <BaixarLote partnerId={partnerId} diaInicial={diaInicial} />
    <Painel titulo="2. Analise no seu Claude" icone={ListOrdered}>
      <ol className="space-y-1.5 text-xs text-slate-300 leading-relaxed list-decimal pl-4">
        <li>Abra o Projeto “Análise diária CRM” no seu Claude (o mentor passa as instruções do Projeto).</li>
        <li>Comece uma conversa nova, anexe o arquivo baixado e escreva: “Analise o lote”.</li>
        <li>Copie a resposta inteira (o JSON) e cole no passo 3.</li>
      </ol>
    </Painel>
    <ImportarAnalise partnerId={partnerId} />
  </div>
);
