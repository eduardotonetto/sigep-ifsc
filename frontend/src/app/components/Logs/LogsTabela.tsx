import { Search, Clock, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import type { LogAuditoria } from "../../types/logs";
import { acaoColors, acaoLabels, formatarData, formatarHora, labelAcao, labelTabela } from "../../data/logsData";

interface LogsTabelaProps {
  logs: LogAuditoria[];
  total: number;
  pagina: number;
  totalPaginas: number;
  porPagina: number;
  setPagina: (pagina: number) => void;
  onVerDetalhes: (log: LogAuditoria) => void;
}

const COLUNAS = ["Data / Hora", "Usuário", "Ação", "Módulo", "Registro", "IP", "Detalhes"];

export function AcaoBadge({ acao }: { acao: string }) {
  const c = acaoColors[acao] ?? acaoColors.LOGIN;
  return (
    <span
      className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap"
      style={{ background: c.bg, color: c.text, borderColor: c.border }}
      title={acaoLabels[acao] ? acao : undefined}
    >
      {labelAcao(acao)}
    </span>
  );
}

export default function LogsTabela({
  logs,
  total,
  pagina,
  totalPaginas,
  porPagina,
  setPagina,
  onVerDetalhes,
}: LogsTabelaProps) {
  const primeiro = (pagina - 1) * porPagina + 1;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-6 my-5 bg-card rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#f7f8fa] border-b border-border">
                {COLUNAS.map((col) => (
                  <th
                    key={col}
                    className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={COLUNAS.length} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Search size={20} className="text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">Nenhum log encontrado.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr
                    key={log.id_log}
                    className="border-b border-border last:border-0 hover:bg-[#f7f8fa] transition-colors"
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-foreground">{formatarData(log.data_hora)}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock size={10} />
                          {formatarHora(log.data_hora)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {log.usuario_nome ? (
                        <div>
                          <p className="text-sm font-medium text-foreground whitespace-nowrap">{log.usuario_nome}</p>
                          <p className="text-xs text-muted-foreground" style={{ fontFamily: "monospace", fontSize: "11px" }}>
                            SIAPE {log.usuario_siape}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          {log.usuario_id ? "Usuário removido" : "Não identificado"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AcaoBadge acao={log.acao} />
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-[#f0f2f5] text-foreground px-2 py-1 rounded-md font-medium whitespace-nowrap">
                        {labelTabela(log.tabela_afetada)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground" style={{ fontFamily: "monospace" }}>
                      {log.registro_id ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap" style={{ fontFamily: "monospace" }}>
                      {log.endereco_ip ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => onVerDetalhes(log)}
                        className="flex items-center gap-1.5 text-xs font-semibold transition-colors hover:underline whitespace-nowrap"
                        style={{ color: "var(--primary)" }}
                      >
                        Ver detalhes
                        <ExternalLink size={11} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {logs.length > 0 && (
          <div className="px-4 py-3 bg-[#f7f8fa] border-t border-border flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Exibindo {primeiro}–{primeiro + logs.length - 1} de {total} registros
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPagina(pagina - 1)}
                disabled={pagina <= 1}
                className="p-1.5 rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                title="Página anterior"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-muted-foreground">
                Página {pagina} de {totalPaginas}
              </span>
              <button
                onClick={() => setPagina(pagina + 1)}
                disabled={pagina >= totalPaginas}
                className="p-1.5 rounded-md border border-border text-foreground hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                title="Próxima página"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
