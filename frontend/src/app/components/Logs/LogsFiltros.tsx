import { Search, X, ChevronDown } from "lucide-react";
import type { FiltrosLogs, OpcoesLogs } from "../../types/logs";
import { labelAcao, labelTabela } from "../../data/logsData";

interface LogsFiltrosProps {
  filtros: FiltrosLogs;
  setFiltro: (campo: keyof FiltrosLogs, valor: string) => void;
  limparFiltros: () => void;
  temFiltro: boolean;
  opcoes: OpcoesLogs;
  total: number;
}

const controlClass =
  "py-2 text-sm rounded-lg border border-border bg-[#f7f8fa] outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all";

function Select({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${controlClass} appearance-none pl-3 pr-8 cursor-pointer max-w-52`}
        style={{ color: value ? "var(--foreground)" : "var(--muted-foreground)" }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
      />
    </div>
  );
}

export default function LogsFiltros({ filtros, setFiltro, limparFiltros, temFiltro, opcoes, total }: LogsFiltrosProps) {
  return (
    <div className="bg-card border-b border-border px-6 py-3 shrink-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-56 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por usuário, SIAPE, registro, IP ou conteúdo..."
            value={filtros.busca}
            onChange={(e) => setFiltro("busca", e.target.value)}
            className={`${controlClass} w-full pl-9 pr-8 placeholder:text-muted-foreground`}
          />
          {filtros.busca && (
            <button
              onClick={() => setFiltro("busca", "")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <Select
          value={filtros.acao}
          onChange={(v) => setFiltro("acao", v)}
          placeholder="Todas as ações"
          options={opcoes.acoes.map((a) => ({ value: a, label: labelAcao(a) }))}
        />
        <Select
          value={filtros.tabela}
          onChange={(v) => setFiltro("tabela", v)}
          placeholder="Todos os módulos"
          options={opcoes.tabelas.map((t) => ({ value: t, label: labelTabela(t) }))}
        />
        <Select
          value={filtros.usuarioId}
          onChange={(v) => setFiltro("usuarioId", v)}
          placeholder="Todos os usuários"
          options={opcoes.usuarios.map((u) => ({ value: String(u.id), label: `${u.nome} (${u.siape})` }))}
        />

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={filtros.de}
            max={filtros.ate || undefined}
            onChange={(e) => setFiltro("de", e.target.value)}
            className={`${controlClass} px-2.5`}
            title="A partir de"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <input
            type="date"
            value={filtros.ate}
            min={filtros.de || undefined}
            onChange={(e) => setFiltro("ate", e.target.value)}
            className={`${controlClass} px-2.5`}
            title="Até"
          />
        </div>

        {temFiltro && (
          <button
            onClick={limparFiltros}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <X size={11} /> Limpar
          </button>
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {total} registro{total !== 1 ? "s" : ""}
          {temFiltro ? " encontrados" : ""}
        </span>
      </div>
    </div>
  );
}
