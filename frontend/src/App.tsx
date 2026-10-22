import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, MapPinned, Plus, RefreshCw, Sparkles, Train, Upload, X } from "lucide-react";
import type { BaselineEvaluation, Change, CompareResult, Conflict, FeedTrip, Scenario, TripStop } from "./types";
import {
  addScenarioChange,
  compareScenario,
  createScenario,
  discardChange,
  evaluateBaseline,
  evaluateScenario,
  explainConflict,
  exportScenario,
  getBaselineTrips,
  getScenarioChanges,
  importBaseline,
  listScenarios,
} from "./types";

import { MapCanvas } from "./components/MapCanvas";
import { Button, ErrorBanner, LabeledInput, Spinner } from "./components/ui";

type Operation = "modify_stop_time" | "add_stop" | "remove_stop" | "add_trip" | "remove_trip";
type LayerKey = "stops" | "conflicts" | "accessibility";
type TripRow = { stop_id: string; sequence: string; arrival: string; departure: string };
type ChangeForm = {
  operation: Operation;
  tripId: string;
  stopId: string;
  arrival: string;
  departure: string;
  sequence: string;
  routeId: string;
  serviceId: string;
  headsign: string;
  rows: TripRow[];
};

const emptyForm: ChangeForm = {
  operation: "modify_stop_time", tripId: "", stopId: "", arrival: "", departure: "", sequence: "1",
  routeId: "", serviceId: "", headsign: "", rows: [{ stop_id: "", sequence: "1", arrival: "", departure: "" }],
};

function normalizeId(value: unknown): string { return typeof value === "string" ? value : String(value ?? ""); }

function App() {
  const [feedId, setFeedId] = useState("");
  const [feedName, setFeedName] = useState("");
  const [baseline, setBaseline] = useState<BaselineEvaluation | null>(null);
  const [baselineTrips, setBaselineTrips] = useState<FeedTrip[]>([]);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [evaluatingBaseline, setEvaluatingBaseline] = useState(false);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("");
  const selectedScenario = scenarios.find((scenario) => String(scenario.id) === scenarioId) ?? null;
  const [showNewScenario, setShowNewScenario] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [changeForm, setChangeForm] = useState<ChangeForm>(emptyForm);
  const [showChangeForm, setShowChangeForm] = useState(false);
  const [savingChange, setSavingChange] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [conflictCount, setConflictCount] = useState<number | null>(null);
  const [conflictExplanations, setConflictExplanations] = useState<Record<string, {
    loading: boolean;
    explanation?: string;
    error?: string;
  }>>({});
  const [evaluateError, setEvaluateError] = useState<string | null>(null);
  const [evaluatingScenario, setEvaluatingScenario] = useState(false);
  const [originStopId, setOriginStopId] = useState("");
  const [windowMinutes, setWindowMinutes] = useState(30);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedStopId, setSelectedStopId] = useState("");
  const [selectedRouteId, setSelectedRouteId] = useState("");
  const routeIds = useMemo(() => Array.from(new Set(baselineTrips.map((trip) => trip.route_id ?? trip.trip_id))), [baselineTrips]);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ stops: true, conflicts: true, accessibility: true });
  const [sections, setSections] = useState({ baseline: true, scenarios: true, changes: true, results: true, compare: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const loadScenarios = useCallback(async () => {
    if (!feedId.trim()) return;
    setLoadingScenarios(true);
    setScenarioError(null);
    try { setScenarios(await listScenarios(feedId.trim())); }
    catch (error: unknown) { setScenarioError(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingScenarios(false); }
  }, [feedId]);

  const loadChanges = useCallback(async () => {
    if (!scenarioId) { setChanges([]); return; }
    setChangesError(null);
    try { setChanges(await getScenarioChanges(scenarioId)); }
    catch (error: unknown) { setChangesError(error instanceof Error ? error.message : String(error)); }
  }, [scenarioId]);

  useEffect(() => { if (feedId) loadScenarios(); }, [feedId, loadScenarios]);
  useEffect(() => { loadChanges(); setConflicts([]); setConflictCount(null); setCompareResult(null); }, [loadChanges]);

  const onStopSelect = useCallback((stopId: string) => {
    setSelectedStopId(stopId);
    setChangeForm((form) => ({ ...form, stopId, rows: form.rows.map((row, index) => index === 0 && !row.stop_id ? { ...row, stop_id: stopId } : row) }));
    setOriginStopId((current) => current || stopId);
  }, []);

  const handleImport = async (file: File) => {
    setUploading(true); setBaselineError(null);
    try {
      const result = await importBaseline(file);
      setFeedId(normalizeId(result.feed_id)); setFeedName(result.name); setBaseline(null); setSelectedRouteId("");
    } catch (error: unknown) { setBaselineError(error instanceof Error ? error.message : String(error)); }
    finally { setUploading(false); }
  };

  const handleBaselineEvaluate = async () => {
    if (!feedId.trim()) return;
    setEvaluatingBaseline(true); setBaselineError(null);
    try {
      const [eval_, trips] = await Promise.all([
        evaluateBaseline(feedId.trim()),
        getBaselineTrips(feedId.trim()),
      ]);
      setBaseline(eval_);
      setBaselineTrips(trips.slice(0, 100));
    }
    catch (error: unknown) { setBaselineError(error instanceof Error ? error.message : String(error)); }
    finally { setEvaluatingBaseline(false); }
  };

  const handleCreateScenario = async () => {
    if (!feedId.trim() || !scenarioName.trim()) return;
    setScenarioError(null);
    try {
      const created = await createScenario(feedId.trim(), scenarioName.trim());
      setScenarioName(""); setShowNewScenario(false); await loadScenarios(); setScenarioId(created.id);
    } catch (error: unknown) { setScenarioError(error instanceof Error ? error.message : String(error)); }
  };

  const handleSaveChange = async () => {
    if (!scenarioId) return;
    const form = changeForm;
    const isTrip = form.operation === "add_trip" || form.operation === "remove_trip";
    const changeType = form.operation === "modify_stop_time" ? "modify" : form.operation === "remove_stop" || form.operation === "remove_trip" ? "remove" : "add";
    const targetId = isTrip ? form.tripId : form.tripId;
    const payload = form.operation === "modify_stop_time"
      ? { "operation": "modify_stop_time",trip_id: form.tripId, stop_id: form.stopId, arrival_time: form.arrival, departure_time: form.departure }
      : form.operation === "add_stop"
        ? { "operation": "add_stop_to_trip",trip_id: form.tripId, stop_id: form.stopId, stop_sequence: Number(form.sequence), arrival_time: form.arrival, departure_time: form.departure }
        : form.operation === "remove_stop"
          ? { "operation": "remove_stop_from_trip",trip_id: form.tripId, stop_id: form.stopId }
          : form.operation === "add_trip"
            ? { "operation": "add_trip",trip_id: form.tripId, route_id: form.routeId, service_id: form.serviceId, trip_headsign: form.headsign, stop_times: form.rows.map((row) => ({ stop_id: row.stop_id, stop_sequence: Number(row.sequence), arrival_time: row.arrival, departure_time: row.departure })) }
            : { "operation": "remove_trip" };
    setSavingChange(true); setChangeError(null);
    try {
      await addScenarioChange(scenarioId, { change_type: changeType, target_type: "trip", target_id: targetId || null, payload: payload });
      setChangeForm(emptyForm); setShowChangeForm(false); await loadChanges();
    } catch (error: unknown) { setChangeError(error instanceof Error ? error.message : String(error)); }
    finally { setSavingChange(false); }
  };

  const handleScenarioEvaluate = async () => {
    if (!scenarioId) return;
    setEvaluatingScenario(true); setEvaluateError(null);
    try { const result = await evaluateScenario(scenarioId); setConflictCount(result.conflict_count); setConflicts(result.conflicts); }
    catch (error: unknown) { setEvaluateError(error instanceof Error ? error.message : String(error)); }
    finally { setEvaluatingScenario(false); }
  };

  const handleExplainConflict = async (conflict: Conflict, key: string) => {
    setConflictExplanations((current) => ({
      ...current,
      [key]: { loading: true },
    }));
    try {
      const result = await explainConflict(conflict);
      setConflictExplanations((current) => ({
        ...current,
        [key]: { loading: false, explanation: result.explanation },
      }));
    } catch (error: unknown) {
      setConflictExplanations((current) => ({
        ...current,
        [key]: {
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        },
      }));
    }
  };

  const handleCompare = async () => {
    if (!scenarioId || !originStopId.trim()) return;
    setComparing(true); setCompareError(null);
    try { setCompareResult(await compareScenario(scenarioId, originStopId.trim(), windowMinutes)); }
    catch (error: unknown) { setCompareError(error instanceof Error ? error.message : String(error)); }
    finally { setComparing(false); }
  };

  const handleExport = async () => {
    if (!scenarioId) return;
    setExporting(true); setExportError(null);
    try { const blob = await exportScenario(scenarioId); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `scenario_${scenarioId}.zip`; link.click(); URL.revokeObjectURL(url); }
    catch (error: unknown) { setExportError(error instanceof Error ? error.message : String(error)); }
    finally { setExporting(false); }
  };

  const toggleSection = (key: keyof typeof sections) => setSections((current) => ({ ...current, [key]: !current[key] }));
  const mapCompare = compareResult;

  return (
    <div className="h-screen overflow-hidden bg-neutral-950 text-neutral-200">
      <header className="absolute left-0 right-0 top-0 z-[1000] flex h-12 items-center border-b border-neutral-800 bg-neutral-950/95 px-4 backdrop-blur">
        <div className="flex items-center gap-2"><Train size={18} className="text-sky-400" /><span className="font-semibold tracking-tight">FeedForward</span><span className="ml-2 border-l border-neutral-800 pl-3 text-xs text-neutral-500">GTFS Scenario Manager</span></div>
        <div className="ml-auto flex items-center gap-3 text-xs font-mono text-neutral-500"><span>{feedId || "No feed loaded"}</span>{selectedScenario && <span className="border-l border-neutral-800 pl-3">{selectedScenario.name}</span>}</div>
      </header>

      <aside className="absolute bottom-0 left-0 top-12 z-[900] flex w-[30%] min-w-[380px] max-w-[480px] flex-col border-r border-neutral-800 bg-neutral-950 shadow-2xl">
        <div className="flex-1 overflow-y-auto p-3">
          <Section title="Baseline" open={sections.baseline} onToggle={() => toggleSection("baseline")}>
            <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) handleImport(file); }} />
            <div className="flex gap-2"><Button onClick={() => fileRef.current?.click()} disabled={uploading}><span className="flex items-center gap-1.5"><Upload size={14} /> {uploading ? "Uploading…" : "Upload GTFS ZIP"}</span></Button><Button variant="secondary" onClick={handleBaselineEvaluate} disabled={evaluatingBaseline || !feedId}>{evaluatingBaseline ? <Spinner /> : "Evaluate"}</Button></div>
            {feedName && <div className="mt-3 rounded border border-emerald-900/60 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-300">Feed loaded: {feedName}</div>}
            {baselineError && <div className="mt-3"><ErrorBanner message={baselineError} /></div>}
            {baseline && <><div className="mt-3 grid grid-cols-3 gap-2"><Metric label="Stops" value={baseline.stop_count} /><Metric label="Trips" value={baseline.trip_count} /><Metric label="Routes" value={baseline.route_count} /></div><label className="mt-3 block"><span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-600">Highlight route</span><select value={selectedRouteId} onChange={(event) => setSelectedRouteId(event.target.value)} className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-mono text-neutral-200 outline-none focus:border-sky-500"><option value="">All routes</option>{routeIds.map((routeId) => <option key={routeId} value={routeId}>{routeId}</option>)}</select></label>{selectedRouteId && <p className="mt-2 text-[11px] text-yellow-400">Highlighted route stops are yellow and its path is bright.</p>}</>}
          </Section>

          <Section title="Scenarios" open={sections.scenarios} onToggle={() => toggleSection("scenarios")} badge={scenarios.length}>
            <div className="flex gap-2"><Button onClick={() => setShowNewScenario((value) => !value)} disabled={!feedId}><span className="flex items-center gap-1"><Plus size={14} /> New Scenario</span></Button><Button variant="secondary" onClick={loadScenarios} disabled={loadingScenarios || !feedId}><RefreshCw size={14} /></Button></div>
            {showNewScenario && <div className="mt-3 flex gap-2"><input autoFocus value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} placeholder="Scenario name" className="min-w-0 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none focus:border-sky-500" /><Button onClick={handleCreateScenario} disabled={!scenarioName.trim()}>Create</Button></div>}
            <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} className="mt-3 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 outline-none focus:border-sky-500"><option value="">Select a scenario…</option>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name} · {scenario.status}</option>)}</select>
            {scenarioError && <div className="mt-3"><ErrorBanner message={scenarioError} /></div>}
          </Section>

          {selectedScenario && <>
            <Section title="Changes" open={sections.changes} onToggle={() => toggleSection("changes")} badge={changes.length}>
              <div className="flex items-center justify-between"><span className="text-xs text-neutral-500">Active changes</span><Button onClick={() => setShowChangeForm((value) => !value)}><span className="flex items-center gap-1"><Plus size={14} /> Add Change</span></Button></div>
              {changesError && <div className="mt-3"><ErrorBanner message={changesError} /></div>}
              <div className="mt-3 space-y-2">{changes.map((change) => <ChangeCard key={change.id} change={change} onDiscard={async () => { await discardChange(scenarioId, change.id); await loadChanges(); }} />)}{changes.length === 0 && <p className="text-xs text-neutral-600">No active changes.</p>}</div>
              {showChangeForm && <ChangeEditor form={changeForm} setForm={setChangeForm} onSave={handleSaveChange} saving={savingChange} error={changeError} onClose={() => setShowChangeForm(false)} />}
            </Section>

            <Section title="Evaluate & Results" open={sections.results} onToggle={() => toggleSection("results")} badge={conflictCount ?? undefined}>
              <Button onClick={handleScenarioEvaluate} disabled={evaluatingScenario} className="w-full">{evaluatingScenario ? <span className="flex justify-center gap-2"><Spinner /> Evaluating…</span> : "Evaluate scenario"}</Button>
              {evaluateError && <div className="mt-3"><ErrorBanner message={evaluateError} /></div>}
              {conflictCount !== null && <div className="mt-3 rounded border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm"><span className="font-semibold text-red-300">{conflictCount} conflicts</span></div>}
              <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{conflicts.map((conflict, index) => {
                const key = `${conflict.trip_a}-${conflict.trip_b}-${index}`;
                return <ConflictCard key={key} conflict={conflict} explanationState={conflictExplanations[key]} onExplain={() => handleExplainConflict(conflict, key)} />;
              })}</div>
            </Section>

            <Section title="Compare" open={sections.compare} onToggle={() => toggleSection("compare")}>
              <div className="grid grid-cols-[1fr_86px] gap-2"><LabeledInput label="Origin stop" value={originStopId} onChange={(event) => setOriginStopId(event.target.value)} className="font-mono" /><LabeledInput label="Window" type="number" value={windowMinutes} onChange={(event) => setWindowMinutes(Number(event.target.value))} /></div>
              <Button onClick={handleCompare} disabled={comparing || !originStopId.trim()} className="mt-3 w-full">{comparing ? <Spinner /> : "Compare accessibility"}</Button>
              {compareError && <div className="mt-3"><ErrorBanner message={compareError} /></div>}
              {compareResult && <CompareSummary result={compareResult} />}
            </Section>
          </>}

          <section className="mt-3 border-t border-neutral-800 pt-3"><Button variant="secondary" onClick={handleExport} disabled={!scenarioId || exporting} className="w-full"><span className="flex items-center justify-center gap-2"><Download size={14} /> {exporting ? "Exporting…" : "Export GTFS"}</span></Button>{exportError && <div className="mt-3"><ErrorBanner message={exportError} /></div>}</section>
        </div>
        <div className="border-t border-neutral-800 px-3 py-2 text-[11px] text-neutral-600">Map centered on Mumbai Western Railway · OpenStreetMap</div>
      </aside>

      <main className="absolute bottom-0 left-[30%] right-0 top-12"><MapCanvas evaluation={baseline ? {...baseline, trips: baselineTrips} : null} conflicts={conflicts} compareResult={mapCompare} showStops={layers.stops} showConflicts={layers.conflicts} showAccessibility={layers.accessibility} selectedStopId={selectedStopId} onStopSelect={onStopSelect} selectedRouteId={selectedRouteId} onRouteSelect={setSelectedRouteId} /><div className="absolute right-4 top-4 z-[500] flex overflow-hidden rounded-md border border-neutral-700 bg-neutral-950/90 shadow-lg backdrop-blur">{(["stops", "conflicts", "accessibility"] as LayerKey[]).map((key) => <button key={key} onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))} className={`border-r border-neutral-800 px-3 py-2 text-xs capitalize last:border-0 ${layers[key] ? "text-sky-300" : "text-neutral-600"}`}>{layers[key] ? "●" : "○"} {key}</button>)}</div><div className="absolute bottom-5 right-4 z-[500] rounded-md border border-neutral-700 bg-neutral-950/90 px-3 py-2 text-xs text-neutral-500 shadow-lg"><MapPinned size={13} className="mr-1 inline text-sky-400" />{baseline?.stops?.length ?? 0} stops mapped</div></main>
    </div>
  );
}

function Section({ title, open, onToggle, badge, children }: { title: string; open: boolean; onToggle: () => void; badge?: number; children: React.ReactNode }) {
  return <section className="border-b border-neutral-800 py-3"><button onClick={onToggle} className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-[0.14em] text-neutral-400 hover:text-neutral-200">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {title}{badge !== undefined && <span className="ml-auto rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400">{badge}</span>}</button>{open && <div className="mt-3">{children}</div>}</section>;
}

function Metric({ label, value }: { label: string; value: number }) { return <div className="rounded border border-neutral-800 bg-neutral-900/70 p-2"><div className="text-[10px] uppercase text-neutral-600">{label}</div><div className="mt-1 font-mono text-lg text-neutral-100">{value}</div></div>; }
function ChangeCard({ change, onDiscard }: { change: Change; onDiscard: () => Promise<void> }) { return <div className="flex items-center justify-between rounded border border-neutral-800 bg-neutral-900/60 px-3 py-2"><div><div className="text-xs font-medium text-neutral-200">{change.change_type}</div><div className="font-mono text-[11px] text-neutral-500">{change.target_id || "—"}</div></div><button onClick={onDiscard} className="rounded p-1 text-neutral-600 hover:bg-red-950/40 hover:text-red-300"><X size={14} /></button></div>; }
function ConflictCard({
  conflict,
  explanationState,
  onExplain,
}: {
  conflict: Conflict;
  explanationState?: { loading: boolean; explanation?: string; error?: string };
  onExplain: () => void;
}) {
  const critical = String(conflict.severity).toUpperCase() === "CRITICAL";
  return (
    <div className={`rounded border px-3 py-2 text-xs ${critical ? "border-red-900/60 bg-red-950/20" : "border-yellow-900/60 bg-yellow-950/20"}`}>
      <div className={critical ? "text-red-300" : "text-yellow-300"}>{conflict.severity} · {conflict.type}</div>
      <div className="mt-1 font-mono text-neutral-400">{conflict.trip_a} ↔ {conflict.trip_b}</div>
      <div className="mt-1 text-neutral-500">stop {conflict.location_stop_id ?? conflict.stop} · margin {conflict.margin_violated_sec}s</div>
      <div className="mt-2 text-neutral-500">RF cascade: {conflict.rf_estimated_cascade_sec}s</div>
      <button
        type="button"
        onClick={onExplain}
        disabled={explanationState?.loading}
        className="mt-3 inline-flex items-center gap-1.5 rounded border border-sky-800 bg-sky-950/40 px-2.5 py-1.5 text-[11px] font-medium text-sky-300 hover:bg-sky-900/50 disabled:cursor-wait disabled:opacity-60"
      >
        <Sparkles size={13} />
        {explanationState?.loading ? "Generating..." : explanationState?.explanation ? "Regenerate explanation" : "Explain with AI"}
      </button>
      {explanationState?.error && (
        <div className="mt-2 rounded border border-red-900/50 bg-red-950/30 p-2 text-red-300">
          {explanationState.error}
          <button type="button" onClick={onExplain} className="ml-2 underline">Retry</button>
        </div>
      )}
      {explanationState?.explanation && (
        <div className="mt-2 whitespace-pre-wrap rounded border border-sky-900/50 bg-sky-950/20 p-2 text-neutral-300">
          <div className="mb-1 flex items-center gap-1 font-semibold text-sky-300"><Sparkles size={12} /> AI explanation</div>
          {explanationState.explanation}
        </div>
      )}
    </div>
  );
}

function CompareSummary({ result }: { result: CompareResult }) {
  return (
    <div className="mt-3 space-y-3">
      {/* Accessibility Delta */}
      <div className="rounded border border-neutral-800 bg-neutral-900/60 p-3 text-xs">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">Accessibility</div>
        <div className="flex justify-between font-mono">
          <span>Baseline <strong className="text-neutral-200">{result.baseline_count}</strong></span>
          <span>Temp <strong className="text-neutral-200">{result.temp_count}</strong></span>
          <strong className={result.delta >= 0 ? "text-emerald-400" : "text-orange-400"}>
            {result.delta >= 0 ? "+" : ""}{result.delta} stops
          </strong>
        </div>
        {result.gained_stops.length > 0 && (
          <div className="mt-2 text-emerald-400">▲ Gained: {result.gained_stops.join(", ")}</div>
        )}
        {result.lost_stops.length > 0 && (
          <div className="mt-1 text-orange-400">▼ Lost: {result.lost_stops.join(", ")}</div>
        )}
        {result.delta === 0 && (
          <div className="mt-2 text-neutral-600">No accessibility change from this scenario.</div>
        )}
      </div>

      {/* Conflict Summary */}
      {result.conflict_summary && (
        <div className="rounded border border-red-900/40 bg-red-950/10 p-3 text-xs">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">Conflict Analysis</div>
          <div className="grid grid-cols-2 gap-2 font-mono">
            <div>Total <strong className="text-red-300">{result.conflict_summary.total}</strong></div>
            <div>Critical <strong className="text-red-400">{result.conflict_summary.critical}</strong></div>
            <div>Warning <strong className="text-yellow-400">{result.conflict_summary.warning}</strong></div>
            <div>Avg cascade <strong className="text-orange-300">{result.conflict_summary.avg_cascade_delay_sec}s</strong></div>
          </div>
        </div>
      )}
    </div>
  );
}
function ChangeEditor({ form, setForm, onSave, saving, error, onClose }: { form: ChangeForm; setForm: React.Dispatch<React.SetStateAction<ChangeForm>>; onSave: () => Promise<void>; saving: boolean; error: string | null; onClose: () => void }) {
  const update = (values: Partial<ChangeForm>) => setForm((current) => ({ ...current, ...values }));
  const operation = form.operation;
  return <div className="mt-3 rounded border border-sky-900/50 bg-sky-950/10 p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-sky-300">New structured change</span><button onClick={onClose} className="text-neutral-500 hover:text-white"><X size={14} /></button></div><select value={operation} onChange={(event) => update({ operation: event.target.value as Operation })} className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 outline-none"><option value="modify_stop_time">Modify Stop Time</option><option value="add_stop">Add Stop to Trip</option><option value="remove_stop">Remove Stop from Trip</option><option value="add_trip">Add New Trip</option><option value="remove_trip">Remove Trip</option></select><div className="mt-3 space-y-3">
    <LabeledInput label="Trip ID" value={form.tripId} onChange={(event) => update({ tripId: event.target.value })} className="font-mono" />
    {operation === "add_trip" && <><div className="grid grid-cols-2 gap-2"><LabeledInput label="Route ID" value={form.routeId} onChange={(event) => update({ routeId: event.target.value })} /><LabeledInput label="Service ID" value={form.serviceId} onChange={(event) => update({ serviceId: event.target.value })} /></div><LabeledInput label="Trip headsign" value={form.headsign} onChange={(event) => update({ headsign: event.target.value })} /><div className="space-y-2"><div className="flex items-center justify-between text-xs text-neutral-500"><span>Stop rows</span><button onClick={() => update({ rows: [...form.rows, { stop_id: "", sequence: String(form.rows.length + 1), arrival: "", departure: "" }] })} className="text-sky-400 hover:text-sky-300">+ Add row</button></div>{form.rows.map((row, index) => <div key={index} className="grid grid-cols-[1fr_45px_1fr_1fr_20px] gap-1"><input placeholder="stop_id" value={row.stop_id} onChange={(event) => update({ rows: form.rows.map((item, rowIndex) => rowIndex === index ? { ...item, stop_id: event.target.value } : item) })} className="min-w-0 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs font-mono text-neutral-200" /><input placeholder="#" value={row.sequence} onChange={(event) => update({ rows: form.rows.map((item, rowIndex) => rowIndex === index ? { ...item, sequence: event.target.value } : item) })} className="min-w-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-200" /><input type="time" step="1" value={row.arrival} onChange={(event) => update({ rows: form.rows.map((item, rowIndex) => rowIndex === index ? { ...item, arrival: event.target.value } : item) })} className="min-w-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-200" /><input type="time" step="1" value={row.departure} onChange={(event) => update({ rows: form.rows.map((item, rowIndex) => rowIndex === index ? { ...item, departure: event.target.value } : item) })} className="min-w-0 rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-xs text-neutral-200" /><button onClick={() => update({ rows: form.rows.filter((_, rowIndex) => rowIndex !== index) })} className="text-neutral-600 hover:text-red-300"><X size={13} /></button></div>)}</div></>}
    {(operation === "modify_stop_time" || operation === "add_stop" || operation === "remove_stop") && <LabeledInput label="Stop ID" value={form.stopId} onChange={(event) => update({ stopId: event.target.value })} className="font-mono" />}
    {(operation === "modify_stop_time" || operation === "add_stop") && <div className="grid grid-cols-2 gap-2"><LabeledInput label="Arrival" type="time" step="1" value={form.arrival} onChange={(event) => update({ arrival: event.target.value })} /><LabeledInput label="Departure" type="time" step="1" value={form.departure} onChange={(event) => update({ departure: event.target.value })} /></div>}
    {operation === "add_stop" && <LabeledInput label="Stop sequence" type="number" value={form.sequence} onChange={(event) => update({ sequence: event.target.value })} />}
    {error && <ErrorBanner message={error} />}<Button onClick={onSave} disabled={saving || !form.tripId.trim()} className="w-full">{saving ? <Spinner /> : "Save change"}</Button>
  </div></div>;
}



export default App;
