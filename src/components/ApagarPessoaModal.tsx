import React, { useState } from "react";
import { toast } from "sonner";
import { ModalConfirmacao } from "@/components/ModalConfirmacao";
import { apagarDadosDoContato } from "@/lib/api-comercial";
import { O_QUE_SOME, PALAVRA_DE_SEGURANCA, desfechoDaResposta, frasePronta, mensagemDeErroApagar } from "@/lib/lgpd";

interface Props {
  contatoId: string;
  nome: string;
  onCancelar: () => void;
  /** Depois de apagar (ou de a pessoa já não existir): a tela tira a pessoa da lista. */
  onApagado: () => void;
}

/** Dois passos: explica o que some; depois exige digitar APAGAR. */
export const ApagarPessoaModal: React.FC<Props> = ({ contatoId, nome, onCancelar, onApagado }) => {
  const [etapa, setEtapa] = useState<1 | 2>(1);
  const [digitado, setDigitado] = useState("");

  const apagar = async () => {
    try {
      const desfecho = desfechoDaResposta(await apagarDadosDoContato(contatoId));
      if (desfecho.tipo === "aviso") toast.warning(desfecho.mensagem, { duration: 15000 });
      else if (desfecho.tipo === "info") toast.info(desfecho.mensagem);
      else toast.success(desfecho.mensagem);
      onApagado();
    } catch (e) {
      toast.error(mensagemDeErroApagar(e));
    }
  };

  if (etapa === 1) {
    return (
      <ModalConfirmacao
        titulo={`Apagar todos os dados de ${nome}?`}
        textoConfirmar="Continuar"
        perigo
        onConfirmar={() => setEtapa(2)}
        onCancelar={onCancelar}
      >
        <p>Pedido do titular (LGPD). Vai sumir do CRM, de forma definitiva:</p>
        <ul className="list-disc pl-5 space-y-1">
          {O_QUE_SOME.map((linha) => (
            <li key={linha}>{linha}</li>
          ))}
        </ul>
        <p className="font-semibold text-white">Não dá para desfazer.</p>
      </ModalConfirmacao>
    );
  }

  return (
    <ModalConfirmacao
      titulo="Confirme digitando a palavra"
      textoConfirmar="Apagar para sempre"
      perigo
      confirmarDesabilitado={!frasePronta(digitado)}
      onConfirmar={apagar}
      onCancelar={onCancelar}
    >
      <label className="block space-y-1.5">
        <span>
          Para apagar <b className="text-white">{nome}</b>, digite <b className="text-white">{PALAVRA_DE_SEGURANCA}</b>:
        </span>
        <input
          value={digitado}
          onChange={(e) => setDigitado(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="w-full min-h-[44px] rounded-xl bg-black border border-white/15 px-3 text-base text-white"
          aria-label={`Digite ${PALAVRA_DE_SEGURANCA} para confirmar`}
        />
      </label>
    </ModalConfirmacao>
  );
};
