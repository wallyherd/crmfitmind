import React, { useState } from "react";
import { ChevronDown, ExternalLink, Laptop } from "lucide-react";
import type { ConexaoPainel } from "@/types";
import { CredenciaisConector } from "@/components/CredenciaisConector";

const PAINEL_LOCAL = "http://127.0.0.1:3100";

interface UsarNoComputadorProps {
  conexoes: ConexaoPainel[];
  aberto: boolean;
  onAlternar: () => void;
  /** Conexão já escolhida ao abrir pela tela de uma conexão modo PC. */
  conexaoInicialId?: string | null;
}

/** Modo PC (piloto): o programa roda no computador do mentorado e usa as credenciais de uma conexão. */
export const UsarNoComputador: React.FC<UsarNoComputadorProps> = ({
  conexoes,
  aberto,
  onAlternar,
  conexaoInicialId,
}) => {
  const [escolhidaId, setEscolhidaId] = useState<string>("");
  // Só conexão do computador: a do servidor tem credencial recusada pelo conector do PC.
  const doComputador = conexoes.filter((c) => c.modo === "pc");
  const selecionada =
    doComputador.find((c) => c.id === escolhidaId) ||
    doComputador.find((c) => c.id === conexaoInicialId) ||
    doComputador[0] ||
    null;

  return (
    <section id="usar-no-computador" className="glass-panel rounded-3xl border border-white/10 overflow-hidden">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="w-full min-h-[56px] flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/[0.02]"
      >
        <span className="flex items-center gap-3">
          <Laptop className="w-5 h-5 text-red-400 shrink-0" />
          <span>
            <span className="block text-sm font-bold text-white">Usar no meu computador</span>
            <span className="block text-xs text-slate-400">
              Alternativa para o piloto: o programa roda no seu PC em vez do servidor.
            </span>
          </span>
        </span>
        <ChevronDown className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="px-5 pb-5 space-y-5 border-t border-white/10 pt-5">
          <ol className="space-y-3 text-sm text-slate-300 list-decimal pl-5 marker:text-red-400 marker:font-bold">
            <li>
              Copie o identificador e o segredo da conexão (botão abaixo). O segredo dá acesso à conexão: mostre só no
              computador onde o programa vai rodar.
            </li>
            <li>
              Na pasta <code className="text-red-300 font-mono">gateway</code> do pacote do CRM (o conector), dê dois
              cliques em <code className="text-red-300 font-mono">iniciar.bat</code>. Na primeira vez ele baixa as
              dependências (precisa do Node.js LTS e de internet).
            </li>
            <li>
              Abra{" "}
              <a
                href={PAINEL_LOCAL}
                target="_blank"
                rel="noreferrer"
                className="text-red-300 font-mono underline underline-offset-2 inline-flex items-center gap-1"
              >
                {PAINEL_LOCAL} <ExternalLink className="w-3 h-3" />
              </a>{" "}
              nesse computador, cole os dois, clique em <strong className="text-white">Salvar</strong> e depois em{" "}
              <strong className="text-white">Testar ligação com o CRM</strong>.
            </li>
            <li>
              Ainda no painel do programa, conecte com QR ou com código, como no celular.
            </li>
          </ol>

          <p className="text-xs text-slate-400 leading-relaxed">
            O robô e os grupos permitidos da conexão do computador também são decididos aqui, no CRM (cartão da
            conexão, em Opções): o que estiver no <code className="font-mono">config.json</code> do programa não
            liga o robô nem libera grupo. Não use o mesmo número no servidor e no computador ao mesmo tempo.
          </p>

          {selecionada ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                  Credenciais da conexão ({selecionada.nome})
                </h4>
                {doComputador.length > 1 && (
                  <select
                    value={selecionada.id}
                    onChange={(e) => setEscolhidaId(e.target.value)}
                    aria-label="Conexão"
                    className="min-h-[40px] bg-black border border-white/15 rounded-xl px-3 text-base md:text-xs text-white focus:outline-none focus:border-red-500"
                  >
                    {doComputador.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <CredenciaisConector key={selecionada.id} conexaoId={selecionada.id} />
            </div>
          ) : (
            <p className="text-xs text-slate-400 rounded-xl border border-dashed border-white/10 p-3 text-center">
              Crie uma conexão em <strong className="text-white">Nova conexão</strong>, escolhendo{" "}
              <strong className="text-white">No meu computador</strong>, para obter as credenciais.
            </p>
          )}
        </div>
      )}
    </section>
  );
};
