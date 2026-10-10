import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";

/** Desenha no navegador o QR que o gateway mandou (a string crua do WhatsApp). */
export const ImagemQr: React.FC<{ texto: string }> = ({ texto }) => {
  const [src, setSrc] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    QRCode.toString(texto, {
      type: "svg",
      margin: 2,
      errorCorrectionLevel: "L",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((svg) => {
        if (!vivo) return;
        setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        setFalhou(false);
      })
      .catch(() => {
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [texto]);

  if (falhou) {
    return <p className="text-sm text-red-300">Não foi possível desenhar o QR. Clique em "Gerar de novo".</p>;
  }

  return (
    <div className="w-64 h-64 max-w-full aspect-square rounded-2xl bg-white p-2 flex items-center justify-center shadow-xl">
      {src ? (
        <img src={src} alt="QR para conectar o WhatsApp" className="w-full h-full" />
      ) : (
        <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
      )}
    </div>
  );
};
