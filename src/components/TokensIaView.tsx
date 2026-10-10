// Admin > Tokens de IA: credencial "crmia_" da rotina do dono. O token aparece uma vez só;
// o servidor guarda apenas o hash.
import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { criarTokenIa, listarTokensIa, revogarTokenIa } from "@/lib/api-comercial";
import { dataBr } from "@/lib/formatos";
import { copiarTexto } from "@/lib/navegador";
import {
  CLASSE_BOTAO,
  CLASSE_BOTAO_LEVE,
  CLASSE_INPUT,
  CLASSE_ROTULO,
  Cabecalho,
  Carregando,
  ErroCarga,
  Painel,
  Selo,
  Vazio,
  mensagemDeErro,
} from "@/components/Pecas";
import type { EmpresaAcesso, TokenIa } from "@/types";

const MAX_EMPRESAS = 5;

export const TokensIaView: React.FC<{ empresas: EmpresaAcesso[] }> = ({ empresas }) => {
  const [tokens, setTokens] = useState<TokenIa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [criando, setCriando] = useState(false);
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);

  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome || id.slice(0, 8);

  const carregar = useCallback(async () => {
    try {
      setTokens(await listarTokensIa());
      setErro(null);
    } catch (e) {
      setErro(mensagemDeErro(e, "Não foi possível carregar os tokens."));
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const alternar = (id: string) =>
    setEscolhidas((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : atual.length >= MAX_EMPRESAS ? atual : [...atual, id],
    );

  const criar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return void toast.error("Dê um nome ao token (ex.: Rotina do Erick).");
    if (escolhidas.length === 0) return void toast.error("Escolha pelo menos uma empresa.");
    setCriando(true);
    try {
      const { token } = await criarTokenIa(nome.trim(), escolhidas);
      setTokenNovo(token);
      setNome("");
      setEscolhidas([]);
      await carregar();
    } catch (err) {
      toast.error(mensagemDeErro(err));
    } finally {
      setCriando(false);
    }
  };

  const copiar = async () => {
    if (!tokenNovo) return;
    const ok = await copiarTexto(tokenNovo);
    toast[ok ? "success" : "error"](ok ? "Token copiado." : "Não consegui copiar. Selecione e copie à mão.");
  };

  const revogar = async (t: TokenIa) => {
    if (!confirm(`Revogar o token "${t.nome}"? Quem usa ele para de conseguir enviar análises na hora.`)) return;
    try {
      await revogarTokenIa(t.id);
      toast.success("Token revogado.");
      await carregar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  };

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <Cabecalho
        icone={KeyRound}
        titulo="Tokens de IA"
        subtitulo="Credencial da rotina de análise (Claude Code). Cada token só enxerga as empresas escolhidas."
      />

      {tokenNovo && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-2.5" role="alert">
          <p className="flex items-start gap-2 text-xs font-bold text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0" /> Copie agora: este token não aparece de novo.
          </p>
          <code className="block p-2.5 rounded-xl bg-black border border-white/10 text-[11px] text-white font-mono break-all select-all">
            {tokenNovo}
          </code>
          <div className="flex flex-wrap gap-2">
            <button onClick={copiar} className={CLASSE_BOTAO}>
              <Copy className="w-3.5 h-3.5" /> Copiar token
            </button>
            <button onClick={() => setTokenNovo(null)} className={CLASSE_BOTAO_LEVE}>
              Já guardei
            </button>
          </div>
        </div>
      )}

      <Painel titulo="Criar token" icone={Plus}>
        <form onSubmit={criar} className="space-y-3">
          <label className="block">
            <span className={CLASSE_ROTULO}>Nome *</span>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              maxLength={60}
              placeholder="Ex.: Rotina do Erick"
              className={CLASSE_INPUT}
            />
          </label>
          <fieldset>
            <legend className={CLASSE_ROTULO}>
              Empresas que o token pode analisar ({escolhidas.length}/{MAX_EMPRESAS})
            </legend>
            {empresas.length === 0 ? (
              <p className="text-[11px] text-slate-500">Nenhuma empresa cadastrada.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto">
                {empresas.map((emp) => {
                  const marcada = escolhidas.includes(emp.id);
                  return (
                    <label
                      key={emp.id}
                      className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer ${
                        marcada ? "bg-red-600/10 border-red-500/50 text-white" : "bg-white/[0.02] border-white/10 text-slate-300"
                      } ${!marcada && escolhidas.length >= MAX_EMPRESAS ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={!marcada && escolhidas.length >= MAX_EMPRESAS}
                        onChange={() => alternar(emp.id)}
                        className="accent-red-600"
                      />
                      <span className="truncate">{emp.nome}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>
          <p className="text-[11px] text-slate-500">
            Use só para o número do dono da mentoria. Mentorados usam a API automática ou o modo manual.
          </p>
          <div className="flex justify-end">
            <button type="submit" disabled={criando} className={CLASSE_BOTAO}>
              {criando ? "Criando..." : "Criar token"}
            </button>
          </div>
        </form>
      </Painel>

      <Painel titulo="Tokens">
        {erro && <ErroCarga mensagem={erro} aoTentar={carregar} />}
        {!erro && tokens === null && <Carregando />}
        {tokens && tokens.length === 0 && <Vazio>Nenhum token criado.</Vazio>}
        {tokens && tokens.length > 0 && (
          <ul className="space-y-2">
            {tokens.map((t) => (
              <li
                key={t.id}
                className={`p-3 rounded-2xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  t.revogado_em ? "opacity-60" : ""
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <p className="text-xs font-bold text-white flex flex-wrap items-center gap-2">
                    {t.nome}
                    {t.revogado_em ? <Selo>Revogado em {dataBr(t.revogado_em)}</Selo> : <Selo tom="claro">Ativo</Selo>}
                  </p>
                  <p className="text-[11px] text-slate-400 break-words">
                    {t.partner_ids.map(nomeEmpresa).join(", ") || "Sem empresa"}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    Criado em {dataBr(t.criado_em)} · último uso {t.ultimo_uso_em ? dataBr(t.ultimo_uso_em) : "nunca"}
                  </p>
                </div>
                {!t.revogado_em && (
                  <button onClick={() => revogar(t)} className={`${CLASSE_BOTAO_LEVE} shrink-0`}>
                    <Trash2 className="w-3 h-3" /> Revogar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Painel>
    </div>
  );
};
