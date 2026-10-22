import { useRef, useState, useCallback } from "react";
import { Upload, Play } from "lucide-react";
import { importBaseline, evaluateBaseline, type BaselineImport, type BaselineEvaluation } from "../types";
import { Panel, Button, Spinner, ErrorBanner, StatCard } from "./ui";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

export function Baseline({
  baselineId,
  onBaselineImported,
}: {
  baselineId: string;
  onBaselineImported: (id: string) => void;
}) {
  const [imported, setImported] = useState<BaselineImport | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [evaluation, setEvaluation] = useState<BaselineEvaluation | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluateId, setEvaluateId] = useState(() => normalizeId(baselineId));
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const result = await importBaseline(file);
      setImported(result);
      const feedId = normalizeId(result.feed_id);
      onBaselineImported(feedId);
      setEvaluateId(feedId);
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }, [onBaselineImported]);

  const handleEvaluate = useCallback(async () => {
    const id = normalizeId(evaluateId).trim();
    if (!id) return;
    setEvaluating(true);
    setEvalError(null);
    try {
      const result = await evaluateBaseline(id);
      setEvaluation(result);
    } catch (e: unknown) {
      setEvalError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvaluating(false);
    }
  }, [evaluateId]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-neutral-100">Baseline Import</h1>

      <Panel title="Upload GTFS ZIP">
        <div className="space-y-4">
          <div
            className="border-2 border-dashed border-neutral-700 rounded-lg p-8 text-center transition-colors hover:border-neutral-500 cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleImport(f); }}
            onDragOver={(e) => e.preventDefault()}
          >
            {importing ? (
              <div className="flex items-center justify-center gap-2 text-neutral-400">
                <Spinner /> Importing…
              </div>
            ) : (
              <>
                <Upload size={28} className="mx-auto text-neutral-500" />
                <p className="mt-3 text-sm text-neutral-400">Click or drag a GTFS .zip file here</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImport(f); }}
          />
          {importError && <ErrorBanner message={importError} />}
          {imported && (
            <div className="rounded-md border border-emerald-900/50 bg-emerald-950/30 px-4 py-3 space-y-1">
              <div className="text-sm font-mono text-emerald-300">feed_id: {imported.feed_id}</div>
              <div className="text-sm text-neutral-300">name: {imported.name}</div>
              <div className="text-sm text-neutral-400">imported_at: {imported.imported_at}</div>
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Evaluate Baseline" actions={evaluating ? <Spinner /> : undefined}>
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <label className="flex-1">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">Feed ID</span>
              <input
                type="text"
                value={normalizeId(evaluateId)}
                onChange={(e) => setEvaluateId(e.target.value)}
                className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 font-mono focus:border-neutral-500 focus:outline-none"
              />
            </label>
            <Button onClick={handleEvaluate} disabled={evaluating || !normalizeId(evaluateId).trim()}>
              <span className="flex items-center gap-1.5"><Play size={14} /> Evaluate</span>
            </Button>
          </div>
          {evalError && <ErrorBanner message={evalError} />}
          {evaluation && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Stops" value={evaluation.stop_count} />
                <StatCard label="Trips" value={evaluation.trip_count} />
                <StatCard label="Routes" value={evaluation.route_count} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="First Departure" value={evaluation.schedule_range.first_departure} />
                <StatCard label="Last Departure" value={evaluation.schedule_range.last_departure} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium text-neutral-300">Routes</div>
                <div className="overflow-hidden rounded-md border border-neutral-800">
                  <table className="w-full text-sm font-mono">
                    <thead className="bg-neutral-900 text-neutral-500 text-xs uppercase tracking-wide">
                      <tr>
                        <th className="px-3 py-2 text-left">Route ID</th>
                        <th className="px-3 py-2 text-left">Short Name</th>
                        <th className="px-3 py-2 text-left">Long Name</th>
                        <th className="px-3 py-2 text-right">Trips</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-800">
                      {evaluation.routes.map((r) => (
                        <tr key={r.route_id} className="text-neutral-300 hover:bg-neutral-900/50">
                          <td className="px-3 py-2">{r.route_id}</td>
                          <td className="px-3 py-2">{r.route_short_name ?? "—"}</td>
                          <td className="px-3 py-2">{r.route_long_name ?? "—"}</td>
                          <td className="px-3 py-2 text-right">{r.trip_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
