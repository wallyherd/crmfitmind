import React from "react";
import { rotuloStatus, tomDoStatus, type TomStatus } from "@/lib/whatsapp";

const CORES: Record<TomStatus, string> = {
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  espera: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  parado: "bg-white/5 text-slate-300 border-white/15",
  erro: "bg-red-500/15 text-red-300 border-red-500/40",
};

const PONTO: Record<TomStatus, string> = {
  ok: "bg-emerald-400",
  espera: "bg-amber-400 animate-pulse",
  parado: "bg-slate-500",
  erro: "bg-red-500",
};

export const SeloStatus: React.FC<{ status: string | null | undefined }> = ({ status }) => {
  const tom = tomDoStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap ${CORES[tom]}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${PONTO[tom]}`} />
      {rotuloStatus(status)}
    </span>
  );
};
