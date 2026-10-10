// Como a análise é feita (motor) e a autorização LGPD da empresa para mandar conversas à IA.
import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bot, Hand, ShieldCheck, Terminal } from "lucide-react";
import { salvarConfigIa } from "@/lib/api-comercial";
import { brl, dataBr, lerValor } from "@/lib/formatos";
import { TesteHoje } from "@/components/ia/TesteHoje";
import { CLASSE_BOTAO, CLASSE_INPUT, CLASSE_ROTULO, Painel, mensagemDeErro } from "@/components/Pecas";
import type { AlteracaoConfigIa, ConfigIa, MotorIa as Motor } from "@/types";

const LIMIARES = [
  { valor: 0.6, texto: "Pouca (60%)" },
  { valor: 0.75, texto: "Normal (75%)" },
  { valor: 0.85, texto: "Bastante (85%)" },
  { valor: 0.95, texto: "Muita (95%)" },
];

interface Props {
  partnerId: string;
  isAdmin: boolean;
  config: ConfigIa;
  aoMudar: (config: ConfigIa) => void;
}

const OpcaoMotor: React.FC<{
  ativo: boolean;
  desabilitado?: boolean;
  icone: React.ElementType;
  titulo: string;
  texto: string;
  aviso?: string;
  aoEscolher: () => void;
}> = ({ ativo, desabilitado, icone: Icone, titulo, texto, aviso, aoEscolher }) => (
  <button
    type="button"
    role="radio"
    aria-checked={ativo}
    disabled={desabilitado}
    onClick={aoEscolher}
    className={`text-left p-4 rounded-2xl border transition space-y-1.5 disabled:cursor-not-allowed ${
      ativo
        ? "bg-red-600/10 border-red-500/60"
        : "bg-white/[0.02] border-white/10 hover:border-red-500/40 disabled:opacity-50 disabled:hover:border-white/10"
    }`}
  >
    <span className="flex items-center gap-2 text-sm font-bold text-white">
      <Icone className={`w-4 h-4 ${ativo ? "text-red-400" : "text-slate-400"}`} /> {titulo}
      {ativo && <span className="ml-auto text-[10px] text-red-300 font-bold">EM USO</span>}
    </span>
    <span className="block text-[11px] text-slate-400 leading-relaxed">{texto}</span>
    {aviso && <span className="block text-[11px] text-amber-300">{aviso}</span>}
  </button>
);

export const MotorIa: React.FC<Props> = ({ partnerId, isAdmin, config, aoMudar }) => {
  const [salvando, setSalvando] = useState(false);
  const [autoPix, setAutoPix] = useState(config.autoconfirmar_pix);
  const [teto, setTeto] = useState(String(config.teto_autoconfirmacao ?? ""));
  const [limiar, setLimiar] = useState(config.limiar_confianca ?? 0.75);
  const consentiu = !!config.consentimento_ia_em;

  useEffect(() => {
    setAutoPix(config.autoconfirmar_pix);
    setTeto(String(config.teto_autoconfirmacao ?? ""));
    setLimiar(config.limiar_confianca ?? 0.75);
  }, [config]);

  const salvar = async (alteracao: AlteracaoConfigIa, sucesso: string) => {
    setSalvando(true);
    try {
      const resposta = await salvarConfigIa(partnerId, alteracao);
      // O servidor devolve a configuração inteira; se não devolver, aplica a mudança aqui.
      if (resposta && typeof resposta === "object" && "motor" in resposta) aoMudar(resposta);
      else {
        const { consentir, ...resto } = alteracao;
        aoMudar({
          ...config,
          ...resto,
          ...(consentir === undefined ? {} : { consentimento_ia_em: consentir ? new Date().toISOString() : null }),
        });
      }
      toast.success(sucesso);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setSalvando(false);
    }
  };

  const escolherMotor = (motor: Motor) => {
    if (motor === config.motor) return;
    if (motor === "api_batch" && !consentiu) return;
    salvar({ motor }, motor === "api_batch" ? "A IA vai analisar sozinha a partir do próximo dia." : "Modo trocado.");
  };

  const mudarConsentimento = (marcar: boolean) => {
    if (marcar) {
      salvar({ consentir: true }, "Autorização registrada.");
      return;
    }
    const aviso =
      config.motor === "api_batch"
        ? "Tirar a autorização? A análise automática para e a empresa volta para o modo manual."
        : "Tirar a autorização para a análise automática?";
    if (!confirm(aviso)) return;
    salvar(
      config.motor === "api_batch" ? { consentir: false, motor: "manual" } : { consentir: false },
      "Autorização retirada.",
    );
  };

  const salvarAvancado = () => {
    const valorTeto = lerValor(teto);
    if (autoPix && (valorTeto === null || valorTeto <= 0)) {
      toast.error("Defina até que valor a confirmação automática vale.");
      return;
    }
    salvar(
      {
        autoconfirmar_pix: autoPix,
        limiar_confianca: limiar,
        ...(valorTeto !== null && valorTeto > 0 ? { teto_autoconfirmacao: valorTeto } : {}),
      },
      "Opções salvas.",
    );
  };

  return (
    <div className="space-y-4">
      <Painel titulo="Como a análise é feita" icone={Bot}>
        <div role="radiogroup" className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <OpcaoMotor
            ativo={config.motor === "api_batch"}
            desabilitado={salvando || (!consentiu && config.motor !== "api_batch")}
            icone={Bot}
            titulo="API automática"
            texto="Todo dia de manhã a IA analisa sozinha as conversas de ontem. Você só abre o Relatório do dia."
            aviso={consentiu ? undefined : "Precisa da sua autorização logo abaixo."}
            aoEscolher={() => escolherMotor("api_batch")}
          />
          <OpcaoMotor
            ativo={config.motor === "manual"}
            desabilitado={salvando}
            icone={Hand}
            titulo="Manual no meu Claude"
            texto="Você baixa o arquivo do dia, analisa no seu Claude e cola o resultado aqui. Nada sai daqui sem você."
            aoEscolher={() => escolherMotor("manual")}
          />
          {(isAdmin || config.motor === "rotina_dono") && (
            <OpcaoMotor
              ativo={config.motor === "rotina_dono"}
              desabilitado={salvando || !isAdmin}
              icone={Terminal}
              titulo="Rotina do dono (Claude Code)"
              texto="Só para o número do dono da mentoria: a rotina dele busca e devolve a análise com um token de IA."
              aoEscolher={() => escolherMotor("rotina_dono")}
            />
          )}
        </div>
      </Painel>

      <Painel titulo="Autorização para usar a IA" icone={ShieldCheck}>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={consentiu}
            disabled={salvando}
            onChange={(e) => mudarConsentimento(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-red-600 shrink-0"
          />
          <span className="text-xs text-white font-semibold">
            Autorizo enviar as conversas e os comprovantes (imagem ou PDF) desta empresa para a IA analisar
            {consentiu && (
              <span className="block text-[11px] text-slate-400 font-normal mt-0.5">
                Autorizado em {dataBr(config.consentimento_ia_em)}.
              </span>
            )}
          </span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] leading-relaxed">
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
            <p className="font-bold text-slate-200 mb-1">O que vai para a IA</p>
            <p className="text-slate-400">
              O texto das conversas do dia com clientes e interessados, só com o primeiro nome. Números longos, CPF,
              e-mail e chave PIX vão escondidos.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10">
            <p className="font-bold text-slate-200 mb-1">O que não vai</p>
            <p className="text-slate-400">
              Telefone, conversas de grupos e contatos que você marcou como pessoais.
            </p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          A análise automática é feita pela Anthropic (Claude), fora do Brasil, e inclui a leitura dos comprovantes
          (imagem ou PDF) que seus clientes mandam: o arquivo inteiro vai para a Anthropic para ler valor, data, banco e ID.
          Sem esta autorização a análise automática fica desligada e você ainda pode usar o modo manual. Você pode tirar a autorização quando quiser.
        </p>
      </Painel>

      <TesteHoje partnerId={partnerId} config={config} />

      <Painel titulo="Opções avançadas">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={autoPix}
            onChange={(e) => setAutoPix(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-red-600 shrink-0"
          />
          <span className="text-xs text-slate-200">
            Confirmar sozinho o PIX que <strong>você</strong> confirmou na conversa
            <span className="block text-[11px] text-slate-500 mt-0.5">
              Ex.: você escreveu “Pix recebido, R$ 497”. Desligado, toda venda da IA espera o seu toque em Vendas.
            </span>
          </span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={CLASSE_ROTULO}>Confirmar sozinho só até (R$)</span>
            <input
              value={teto}
              onChange={(e) => setTeto(e.target.value)}
              disabled={!autoPix}
              inputMode="decimal"
              placeholder={brl(2000)}
              className={CLASSE_INPUT}
            />
          </label>
          <label className="block">
            <span className={CLASSE_ROTULO}>Certeza que a IA precisa ter para mudar a categoria</span>
            <select value={limiar} onChange={(e) => setLimiar(Number(e.target.value))} className={CLASSE_INPUT}>
              {(LIMIARES.some((l) => l.valor === limiar)
                ? LIMIARES
                : [...LIMIARES, { valor: limiar, texto: `${Math.round(limiar * 100)}%` }]
              ).map((l) => (
                <option key={l.valor} value={l.valor}>
                  {l.texto}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex justify-end">
          <button onClick={salvarAvancado} disabled={salvando} className={CLASSE_BOTAO}>
            Salvar opções
          </button>
        </div>
      </Painel>
    </div>
  );
};
