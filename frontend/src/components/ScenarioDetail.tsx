import { useState, useEffect, useCallback } from "react";
import { ArrowLeft, Play, GitCompare, Download, Trash2, Sparkles } from "lucide-react";
import type { Scenario, Change, Conflict, ScenarioEvaluation, CompareResult, BaselineEvaluation, FeedTrip } from "../types";

import {
  evaluateBaseline,
  getScenarioChanges,
  addScenarioChange,
  discardChange,
  evaluateScenario,
  compareScenario,
  exportScenario,
  explainConflict,
} from "../types";

import { FeedMap, type ChangeDraft } from "./FeedMap";
import { Panel, Button, Spinner, ErrorBanner, StatCard, LabeledInput } from "./ui";

export function ScenarioDetail({ scenario, onBack }: { scenario: Scenario; onBack: () => void }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [evaluation, setEvaluation] = useState<ScenarioEvaluation | null>(null);
  const [baselineEvaluation, setBaselineEvaluation] = useState<BaselineEvaluation | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [originStopId, setOriginStopId] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<
    Record<string, {
      loading: boolean;
      explanation?: string;
      error?: string;
    }>
  >({});

  const fetchChanges = useCallback(async () => {
    setLoadingChanges(true);
    setChangesError(null);
    try {
      setChanges(await getScenarioChanges(scenario.id));
    } catch (e: unknown) {
      setChangesError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingChanges(false);
    }
  }, [scenario.id]);

  useEffect(() => {
    fetchChanges();
    setBaselineError(null);
    evaluateBaseline(scenario.baseline_id)
      .then(setBaselineEvaluation)
      .catch((e: unknown) => setBaselineError(e instanceof Error ? e.message : String(e)));
  }, [fetchChanges, scenario.baseline_id]);

  const handleAddChange = useCallback(async (draft: ChangeDraft, trip: FeedTrip) => {
    setAdding(true);
    setAddError(null);
    const payload = draft.action === "remove"
      ? { stop_id: draft.stopId }
      : draft.action === "add"
        ? {
          stop_id: draft.stopId,
          stop_sequence: Number(draft.stopSequence),
          arrival_time: draft.arrivalTime,
          departure_time: draft.departureTime,
        }
        : {
          stop_id: draft.stopId,
          arrival_time: draft.arrivalTime,
          departure_time: draft.departureTime,
        };
    try {
      await addScenarioChange(scenario.id, {
        change_type: draft.action,
        target_type: "trip",
        target_id: trip.trip_id,
        payload: payload,
      });
      await fetchChanges();
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }, [fetchChanges, scenario.id]);

  const handleDiscard = useCallback(async (changeId: string) => {
    try {
      await discardChange(scenario.id, changeId);
      await fetchChanges();
    } catch (e: unknown) {
      setChangesError(e instanceof Error ? e.message : String(e));
    }
  }, [fetchChanges, scenario.id]);

  const handleEvaluate = useCallback(async () => {
    setEvaluating(true);
    setEvalError(null);
    try {
      setEvaluation(await evaluateScenario(scenario.id));
    } catch (e: unknown) {
      setEvalError(e instanceof Error ? e.message : String(e));
    } finally {
      setEvaluating(false);
    }
  }, [scenario.id]);

  const handleCompare = useCallback(async () => {
    if (!originStopId.trim()) return;
    setComparing(true);
    setCompareError(null);
    try {
      setCompareResult(await compareScenario(scenario.id, originStopId.trim(), windowMinutes));
    } catch (e: unknown) {
      setCompareError(e instanceof Error ? e.message : String(e));
    } finally {
      setComparing(false);
    }
  }, [originStopId, scenario.id, windowMinutes]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await exportScenario(scenario.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `scenario_${scenario.id}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [scenario.id]);


  const handleExplainConflict = useCallback(
    async (conflict: Conflict, key: string) => {
      setExplanations((previous) => ({
        ...previous,
        [key]: { loading: true },
      }));

      try {
        const result = await explainConflict(conflict);

        setExplanations((previous) => ({
          ...previous,
          [key]: {
            loading: false,
            explanation: result.explanation,
          },
        }));
      } catch (error: unknown) {
        setExplanations((previous) => ({
          ...previous,
          [key]: {
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Unable to generate explanation.",
          },
        }));
      }
    },
    []
  );


  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200">
        <ArrowLeft size={16} /> Back to Scenarios
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-neutral-100">{scenario.name}</h1>
          <div className="mt-1 flex items-center gap-4 text-sm">
            <span className="font-mono text-neutral-500">id: {scenario.id}</span>
            <StatusBadge status={scenario.status} />
            <span className="text-neutral-500">created: {scenario.created_at}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button onClick={handleEvaluate} disabled={evaluating}>
            <span className="flex items-center gap-1.5"><Play size={14} /> Evaluate</span>
          </Button>
          <Button onClick={handleExport} disabled={exporting} variant="secondary">
            <span className="flex items-center gap-1.5"><Download size={14} /> Export</span>
          </Button>
        </div>
      </div>

      {evalError && <ErrorBanner message={evalError} />}
      {exportError && <ErrorBanner message={exportError} />}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-neutral-200">Baseline network</h2>
            <p className="text-xs text-neutral-500">Click a stop for details. Click a trip line to edit its stop sequence.</p>
          </div>
          {baselineEvaluation && <span className="text-xs font-mono text-neutral-500">{baselineEvaluation.stops?.length ?? 0} stops · {baselineEvaluation.trips?.length ?? 0} trips</span>}
        </div>
        {baselineError && <ErrorBanner message={baselineError} />}
        {baselineEvaluation ? (
          <FeedMap evaluation={baselineEvaluation} onAddChange={handleAddChange} adding={adding} addError={addError} />
        ) : !baselineError ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-neutral-800 text-sm text-neutral-500"><Spinner /> <span className="ml-2">Loading baseline network…</span></div>
        ) : null}
      </div>

      <Panel title="Active Changes" actions={loadingChanges ? <Spinner /> : <Button variant="secondary" onClick={fetchChanges}>Refresh</Button>}>
        {changesError && <ErrorBanner message={changesError} />}
        {!changes && !changesError && <div className="text-sm text-neutral-500">Loading changes…</div>}
        {changes?.length === 0 && <div className="text-sm text-neutral-500">No changes yet. Select a trip on the map to add one.</div>}
        {changes && changes.length > 0 && (
          <div className="space-y-2">
            {changes.map((change) => (
              <div key={change.id} className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-3">
                <div className="flex items-center gap-3 text-sm">
                  <span className="rounded bg-neutral-800 px-2 py-0.5 font-mono text-xs text-neutral-300">{change.change_type}</span>
                  <span className="text-neutral-400">trip</span>
                  <span className="font-mono text-neutral-500">{change.target_id ?? "—"}</span>
                </div>
                <Button variant="danger" onClick={() => handleDiscard(change.id)} className="px-2 py-1 text-xs">
                  <span className="flex items-center gap-1"><Trash2 size={12} /> Discard</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Compare" actions={<Button onClick={handleCompare} disabled={comparing || !originStopId.trim()}><span className="flex items-center gap-1.5"><GitCompare size={14} /> Compare</span></Button>}>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <LabeledInput label="Origin Stop ID" type="text" value={originStopId} onChange={(e) => setOriginStopId(e.target.value)} className="font-mono" />
            <LabeledInput label="Window (min)" type="number" value={windowMinutes} onChange={(e) => setWindowMinutes(Number(e.target.value))} className="w-24" />
          </div>
          {compareError && <ErrorBanner message={compareError} />}
          {compareResult && <div className="space-y-4"><div className="grid grid-cols-3 gap-3"><StatCard label="Baseline Count" value={compareResult.baseline_count} /><StatCard label="Temp Count" value={compareResult.temp_count} /><StatCard label="Delta" value={compareResult.delta >= 0 ? `+${compareResult.delta}` : compareResult.delta} /></div><div className="grid grid-cols-2 gap-4"><StopList title="Gained Stops" stops={compareResult.gained_stops} tone="positive" /><StopList title="Lost Stops" stops={compareResult.lost_stops} tone="negative" /></div></div>}
        </div>
      </Panel>


      {evaluation && (
        <Panel title="Evaluation Results">
          <div className="space-y-4">
            <StatCard
              label="Conflict Count"
              value={evaluation.conflict_count}
            />

            {evaluation.conflicts.length > 0 && (
              <ConflictTable
                conflicts={evaluation.conflicts}
                explanations={explanations}
                onExplain={handleExplainConflict}
              />
            )}
          </div>
        </Panel>
      )}

    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = { draft: "text-neutral-400 bg-neutral-800", active: "text-blue-300 bg-blue-950/50", evaluated: "text-emerald-300 bg-emerald-950/50" };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? "text-neutral-400 bg-neutral-800"}`}>{status}</span>;
}


function ConflictTable({
  conflicts,
  explanations,
  onExplain,
}: {
  conflicts: Conflict[];
  explanations: Record<
    string,
    {
      loading: boolean;
      explanation?: string;
      error?: string;
    }
  >;
  onExplain: (conflict: Conflict, key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {conflicts.map((conflict, index) => {
        const key = `${conflict.trip_a}-${conflict.trip_b}-${index}`;
        const state = explanations[key];

        return (
          <div
            key={key}
            className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-neutral-100">
                  {conflict.type}
                </h3>
                <p className="mt-1 text-sm text-neutral-400">
                  Stop: {conflict.stop} · Trips: {conflict.trip_a} /{" "}
                  {conflict.trip_b}
                </p>
              </div>

              <span className="rounded bg-neutral-800 px-2 py-1 text-xs">
                {conflict.severity}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-neutral-500">Margin violated</p>
                <p className="text-neutral-200">
                  {conflict.margin_violated_sec} sec
                </p>
              </div>

              <div>
                <p className="text-neutral-500">RF cascade estimate</p>
                <p className="text-neutral-200">
                  {conflict.rf_estimated_cascade_sec} sec
                </p>
              </div>

              {conflict.rf_confidence != null && (
                <div>
                  <p className="text-neutral-500">RF confidence</p>
                  <p className="text-neutral-200">
                    {conflict.rf_confidence}
                  </p>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => onExplain(conflict, key)}
              disabled={state?.loading}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-blue-800 bg-blue-950/40 px-3 py-2 text-sm text-blue-300 transition-colors hover:bg-blue-900/50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles size={15} />
              {state?.loading ? "Generating..." : "Explain with AI"}
            </button>

            {state?.error && (
              <p className="mt-3 text-sm text-red-400">
                {state.error}
              </p>
            )}

            {state?.explanation && (
              <div className="mt-4 rounded-md border border-neutral-800 bg-neutral-900 p-3">
                <h4 className="mb-2 text-sm font-semibold text-neutral-200">
                  AI Explanation
                </h4>
                <p className="whitespace-pre-wrap text-sm leading-6 text-neutral-300">
                  {state.explanation}
                </p>
                <p className="mt-3 text-xs text-neutral-500">
                  AI-generated explanation of the existing model output;
                  not a new prediction.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StopList({ title, stops, tone }: { title: string; stops: string[]; tone: "positive" | "negative" }) {
  return <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3"><div className={`mb-2 text-sm font-medium ${tone === "positive" ? "text-emerald-400" : "text-red-400"}`}>{title} ({stops.length})</div>{stops.length === 0 ? <p className="text-xs text-neutral-600">None</p> : <div className="flex flex-wrap gap-1.5">{stops.map((stop) => <span key={stop} className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-mono text-neutral-300">{stop}</span>)}</div>}</div>;
}
