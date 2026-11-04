import { X, Calendar, User, Globe, Monitor } from "lucide-react";
import type { DadosLog, LogAuditoria } from "../../../types/logs";
import { formatarData, formatarHora, labelTabela } from "../../../data/logsData";
import { AcaoBadge } from "../LogsTabela";

interface ModalLogDetalhesProps {
  log: LogAuditoria;
  onClose: () => void;
}

const isObjeto = (d: DadosLog): d is Record<string, unknown> => !!d && typeof d === "object" && !Array.isArray(d);

const formatarValor = (valor: unknown) => {
  if (valor === undefined) return "";
  if (valor === null) return "null";
  return typeof valor === "object" ? JSON.stringify(valor) : String(valor);
};

// Campo a campo: antes, depois e se mudou.
function compararDados(anteriores: DadosLog, novos: DadosLog) {
  const antes = isObjeto(anteriores) ? anteriores : {};
  const depois = isObjeto(novos) ? novos : {};
  const campos = [...new Set([...Object.keys(antes), ...Object.keys(depois)])];
  return campos.map((campo) => {
    const a = formatarValor(antes[campo]);
    const d = formatarValor(depois[campo]);
    return { campo, antes: a, depois: d, mudou: isObjeto(anteriores) && isObjeto(novos) && a !== d };
  });
}

export default function ModalLogDetalhes({ log, onClose }: ModalLogDetalhesProps) {
  const temAntes = log.dados_anteriores !== null;
  const temDepois = log.dados_novos !== null;
  const comparavel =
    (!temAntes || isObjeto(log.dados_anteriores)) && (!temDepois || isObjeto(log.dados_novos)) && (temAntes || temDepois);
  const linhas = comparavel ? compararDados(log.dados_anteriores, log.dados_novos) : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="relative z-10 bg-card rounded-2xl shadow-2xl w-full overflow-hidden flex flex-col"
        style={{ maxWidth: "760px", maxHeight: "88vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-6 py-4 flex items-start justify-between shrink-0"
          style={{ background: "linear-gradient(135deg, #0b3d1e 0%, #15622f 100%)" }}
        >
          <div>
            <div className="flex items-center gap-2 mb-1">
              <AcaoBadge acao={log.acao} />
            </div>
            <p className="text-base font-bold text-white">{labelTabela(log.tabela_afetada)}</p>
            <p className="text-xs text-white/60 mt-0.5" style={{ fontFamily: "monospace" }}>
              Log #{log.id_log}
              {log.registro_id ? ` · registro ${log.registro_id}` : ""} · {log.tabela_afetada}
            </p>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Data", value: `${formatarData(log.data_hora)} · ${formatarHora(log.data_hora)}`, icon: Calendar },
              {
                label: "Usuário",
                value: log.usuario_nome
                  ? `${log.usuario_nome} (SIAPE ${log.usuario_siape})`
                  : log.usuario_id
                    ? `Usuário removido (id ${log.usuario_id})`
                    : "Não identificado",
                icon: User,
              },
              { label: "Endereço IP", value: log.endereco_ip ?? "—", icon: Globe },
              { label: "Navegador", value: log.user_agent ?? "—", icon: Monitor },
            ].map((m) => (
              <div key={m.label} className="bg-[#f7f8fa] rounded-lg p-3 min-w-0">
                <div className="flex items-center gap-1 mb-1">
                  <m.icon size={11} className="text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                </div>
                <p className="text-xs font-semibold text-foreground leading-snug break-words">{m.value}</p>
              </div>
            ))}
          </div>

          {comparavel ? (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#f7f8fa] border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide w-1/4">
                      Campo
                    </th>
                    {temAntes && (
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">
                        Antes
                      </th>
                    )}
                    {temDepois && (
                      <th className="px-3 py-2 text-left font-semibold text-muted-foreground uppercase tracking-wide">
                        {temAntes ? "Depois" : "Dados"}
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr
                      key={l.campo}
                      className="border-b border-border last:border-0"
                      style={l.mudou ? { background: "#fefce8" } : undefined}
                    >
                      <td className="px-3 py-2 font-semibold text-foreground align-top" style={{ fontFamily: "monospace" }}>
                        {l.campo}
                      </td>
                      {temAntes && (
                        <td
                          className="px-3 py-2 align-top break-all"
                          style={{ fontFamily: "monospace", color: l.mudou ? "#b91c1c" : "var(--muted-foreground)" }}
                        >
                          {l.antes}
                        </td>
                      )}
                      {temDepois && (
                        <td
                          className="px-3 py-2 align-top break-all"
                          style={{ fontFamily: "monospace", color: l.mudou ? "#15803d" : "var(--foreground)" }}
                        >
                          {l.depois}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : temAntes || temDepois ? (
            <div className="space-y-3">
              {[
                { titulo: "Antes", dados: log.dados_anteriores },
                { titulo: "Depois", dados: log.dados_novos },
              ]
                .filter((b) => b.dados !== null)
                .map((b) => (
                  <div key={b.titulo}>
                    <p className="text-xs font-semibold text-foreground mb-1.5">{b.titulo}</p>
                    <pre className="bg-[#f7f8fa] rounded-lg p-3 text-xs border border-border overflow-x-auto">
                      {JSON.stringify(b.dados, null, 2)}
                    </pre>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4">Este evento não guarda dados do registro.</p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-border flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-border text-foreground hover:bg-muted transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
