import { ShieldCheck, RefreshCw } from "lucide-react";

interface LogsHeaderProps {
  onAtualizar: () => void;
  loading: boolean;
}

export default function LogsHeader({ onAtualizar, loading }: LogsHeaderProps) {
  return (
    <div className="bg-card border-b border-border px-6 py-4 shrink-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck size={16} style={{ color: "var(--primary)" }} />
            <h1 className="text-base font-bold text-foreground">Logs de Auditoria</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Histórico de inclusões, alterações, exclusões e acessos ao sistema
          </p>
        </div>
        <button
          onClick={onAtualizar}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-border text-foreground hover:bg-muted transition-colors disabled:opacity-60 shrink-0"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Atualizar
        </button>
      </div>
    </div>
  );
}
