import { backend } from "./apiClient";
import type { PlanilhaLida } from "../utils/leituraPlanilha";

const LIMITE_BYTES = 4 * 1024 * 1024;

export async function importarPlanilha(planilha: PlanilhaLida): Promise<void> {
  const corpo = JSON.stringify(planilha);
  const tamanho = new Blob([corpo]).size;

  // Acima do limite, a Vercel recusa antes de chegar ao backend, e o motivo não iria para o relatório.
  await backend<unknown>("/importacoes/conselho", {
    method: "POST",
    body: tamanho > LIMITE_BYTES ? JSON.stringify({ arquivo: planilha.arquivo, linhas: [], tamanho }) : corpo,
  });
}
