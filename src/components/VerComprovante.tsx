// Botão que abre o comprovante (imagem ou PDF) que o cliente mandou. O link vem do servidor, vale 60 s e só é
// pedido no clique. Nunca confirma venda: é só uma prova a mais para quem decide.
import React, { useState } from "react";
import { toast } from "sonner";
import { FileText, Image as IconeImagem, Loader2 } from "lucide-react";
import { abrirArquivo, rotuloDoArquivo, type TipoArquivo } from "@/lib/comprovantes";
import { mensagemDeErro } from "@/components/Pecas";

interface Props {
  mensagemId: string;
  /** Texto do botão; sem ele usa "Ver imagem" ou "Ver PDF" conforme o tipo. */
  rotulo?: string;
  tipo?: TipoArquivo | null;
  className: string;
}

export const VerComprovante: React.FC<Props> = ({ mensagemId, rotulo, tipo, className }) => {
  const [abrindo, setAbrindo] = useState(false);
  const Icone = tipo === "pdf" ? FileText : IconeImagem;

  const abrir = async () => {
    setAbrindo(true);
    try {
      await abrirArquivo(mensagemId);
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não consegui abrir o arquivo. Tente de novo."));
    } finally {
      setAbrindo(false);
    }
  };

  return (
    <button type="button" onClick={abrir} disabled={abrindo} className={className}>
      {abrindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icone className="w-3.5 h-3.5" />}
      {rotulo ?? rotuloDoArquivo(tipo)}
    </button>
  );
};
