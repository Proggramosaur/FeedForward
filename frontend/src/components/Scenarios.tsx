import { useState, useEffect, useCallback } from "react";
import { Plus, FolderOpen, RefreshCw } from "lucide-react";
import { createScenario, listScenarios, type Scenario } from "../types";
import { Panel, Button, Spinner, ErrorBanner, LabeledInput } from "./ui";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function Scenarios({
  baselineId,
  onSetBaselineId,
  onOpenScenario,
}: {
  baselineId: string;
  onSetBaselineId: (id: string) => void;
  onOpenScenario: (s: Scenario) => void;
}) {
  const [formBaselineId, setFormBaselineId] = useState(() => normalizeId(baselineId));
  const [formName, setFormName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [scenarios, setScenarios] = useState<Scenario[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [queryBaselineId, setQueryBaselineId] = useState(() => normalizeId(baselineId));

  const fetchScenarios = useCallback(async () => {
    const id = normalizeId(queryBaselineId).trim();
    if (!id) return;
    setLoadingList(true);
    setListError(null);
    try {
      const result = await listScenarios(id);
      setScenarios(result);
    } catch (e: unknown) {
      setListError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingList(false);
    }
  }, [queryBaselineId]);

  useEffect(() => {
    if (normalizeId(queryBaselineId).trim()) fetchScenarios();
  }, [fetchScenarios, queryBaselineId]);

  const handleCreate = useCallback(async () => {
    const bid = normalizeId(formBaselineId).trim();
    if (!bid || !normalizeId(formName).trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await createScenario(bid, normalizeId(formName).trim());
      setFormName("");
      onSetBaselineId(bid);
      setQueryBaselineId(bid);
    } catch (e: unknown) {
      setCreateError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }, [formBaselineId, formName, onSetBaselineId]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-neutral-100">Scenarios</h1>

      <Panel title="Create Scenario" actions={creating ? <Spinner /> : undefined}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <LabeledInput
              label="Baseline ID"
              type="text"
              value={formBaselineId}
              onChange={(e) => setFormBaselineId(e.target.value)}
              className="font-mono"
            />
            <LabeledInput
              label="Scenario Name"
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
          </div>
          {createError && <ErrorBanner message={createError} />}
          <Button onClick={handleCreate} disabled={creating || !normalizeId(formBaselineId).trim() || !normalizeId(formName).trim()}>
            <span className="flex items-center gap-1.5"><Plus size={14} /> Create Scenario</span>
          </Button>
        </div>
      </Panel>

      <Panel title="Scenarios for Baseline" actions={loadingList ? <Spinner /> : (
        <Button variant="secondary" onClick={fetchScenarios} disabled={loadingList || !normalizeId(queryBaselineId).trim()}>
          <span className="flex items-center gap-1.5"><RefreshCw size={12} /> Refresh</span>
        </Button>
      )}>
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Baseline ID</span>
              <input
                type="text"
                value={normalizeId(queryBaselineId)}
                onChange={(e) => setQueryBaselineId(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 font-mono focus:border-neutral-500 focus:outline-none"
              />
            </label>
          </div>
          {listError && <ErrorBanner message={listError} />}
          {scenarios && scenarios.length === 0 && (
            <p className="text-sm text-neutral-500">No scenarios found for this baseline.</p>
          )}
          {scenarios && scenarios.length > 0 && (
            <div className="space-y-2">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  onClick={() => onOpenScenario(s)}
                  className="group flex w-full items-center justify-between rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-left transition-colors hover:border-neutral-600 hover:bg-neutral-900"
                >
                  <div className="flex items-center gap-3">
                    <FolderOpen size={18} className="text-neutral-500 group-hover:text-neutral-300" />
                    <div>
                      <div className="text-sm font-medium text-neutral-200">{s.name}</div>
                      <div className="text-xs font-mono text-neutral-500">{s.id}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-neutral-500">
                    <StatusBadge status={s.status} />
                    <span className="font-mono">{s.created_at}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "text-neutral-400 bg-neutral-800",
    active: "text-blue-300 bg-blue-950/50",
    evaluated: "text-emerald-300 bg-emerald-950/50",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[status] ?? "text-neutral-400 bg-neutral-800"}`}>
      {status}
    </span>
  );
}
