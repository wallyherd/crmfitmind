// Chamadas da visão do mentor e da chave de privacidade do mentorado.
import { apiJson, comQuery } from "@/lib/api";
import type { PainelMentor, PrivacidadeEmpresa, RelatorioMentor } from "@/types";

export const buscarPainelMentor = (dia: string) => apiJson<PainelMentor>(comQuery("/api/mentor/painel", { dia }));

export const buscarRelatorioMentor = (partnerId: string, dia: string) =>
  apiJson<RelatorioMentor>(comQuery(`/api/mentor/empresas/${encodeURIComponent(partnerId)}/relatorio`, { dia }));

export const buscarPrivacidade = (partnerId: string) =>
  apiJson<PrivacidadeEmpresa>(comQuery("/api/empresa/privacidade", { partnerId }));

export const definirPrivacidade = (partnerId: string, mentorPodeVerConversas: boolean) =>
  apiJson<PrivacidadeEmpresa>("/api/empresa/privacidade", {
    method: "PUT",
    body: JSON.stringify({ partnerId, mentorPodeVerConversas }),
  });
