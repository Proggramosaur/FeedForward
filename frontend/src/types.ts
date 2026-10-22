  export type FeedId = string;

export interface BaselineImport {
  feed_id: FeedId;
  name: string;
  imported_at: string;
}

export interface RouteInfo {
  route_id: string;
  route_short_name?: string;
  route_long_name?: string;
  trip_count: number;
}

export interface FeedStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
}

export interface TripStop {
  stop_id: string;
  stop_sequence: number;
  arrival_time?: string;
  departure_time?: string;
  lat: number;
  lon: number;
}

export interface FeedTrip {
  trip_id: string;
  route_id?: string;
  stops: TripStop[];
}

export interface BaselineEvaluation {
  stop_count: number;
  trip_count: number;
  route_count: number;
  routes: RouteInfo[];
  schedule_range: {
    first_departure: string;
    last_departure: string;
  };
  stops?: FeedStop[];
  trips?: FeedTrip[];
}

export type ScenarioStatus = string;

export interface Scenario {
  id: string;
  baseline_id: FeedId;
  name: string;
  status: ScenarioStatus;
  created_at: string;
}

export type ChangeType = "add" | "modify" | "remove";
export type TargetType = "trip" | "stop";

export interface Change {
  id: string;
  change_type: ChangeType;
  target_type: TargetType;
  target_id: string | null;
  payload: unknown;
  discarded?: boolean;
}


export interface Conflict {
  type: string;
  stop: string;
  location_stop_id?: string;
  trip_a: string;
  trip_b: string;
  severity: string;
  margin_violated_sec: number;
  rf_estimated_cascade_sec: number;
  rf_confidence?: number;
}


export interface ScenarioEvaluation {
  conflict_count: number;
  conflicts: Conflict[];
}

export interface CompareResult {
  baseline_count: number;
  temp_count: number;
  delta: number;
  gained_stops: string[];
  lost_stops: string[];
  conflict_summary?: {
    total: number;
    critical: number;
    warning: number;
    avg_cascade_delay_sec: number;
  };
}
const API_BASE = "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? JSON.stringify(body);
    } catch {
      // no JSON body
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res.text() as unknown as T;
}

export async function importBaseline(file: File): Promise<BaselineImport> {
  const form = new FormData();
  form.append("file", file);
  return request<BaselineImport>("/baseline/import", { method: "POST", body: form });
}

export async function evaluateBaseline(feedId: FeedId): Promise<BaselineEvaluation> {
  const raw = await request<Record<string, unknown>>(`/baseline/${feedId}/evaluate`);
  return normalizeBaselineEvaluation(raw);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeBaselineEvaluation(raw: Record<string, unknown>): BaselineEvaluation {
  const rawStops = Array.isArray(raw.stops) ? raw.stops : [];
  const stops: FeedStop[] = rawStops.map((stop) => {
    const item = stop as Record<string, unknown>;
    return {
      stop_id: asText(item.stop_id ?? item.id),
      name: asText(item.stop_name ?? item.name),
      lat: asNumber(item.stop_lat ?? item.lat ?? item.latitude),
      lon: asNumber(item.stop_lon ?? item.lon ?? item.longitude),
    };
  });
  const stopById = new Map(stops.map((stop) => [stop.stop_id, stop]));

  const rawTrips = Array.isArray(raw.trips) ? (raw.trips as unknown[]).slice(0, 50) : [];
  const trips: FeedTrip[] = rawTrips.map((trip, tripIndex) => {
    const item = trip as Record<string, unknown>;
    const rawTripStops = Array.isArray(item.stops) ? item.stops : Array.isArray(item.stop_times) ? item.stop_times : [];
    const tripStops: TripStop[] = rawTripStops.map((stop, stopIndex) => {
      const stopItem = typeof stop === "string" ? { stop_id: stop } : stop as Record<string, unknown>;
      const stopId = asText(stopItem.stop_id ?? stopItem.id);
      const knownStop = stopById.get(stopId);
      return {
        stop_id: stopId,
        stop_sequence: asNumber(stopItem.stop_sequence ?? stopItem.sequence ?? stopIndex + 1),
        arrival_time: typeof stopItem.arrival_time === "string" ? stopItem.arrival_time : undefined,
        departure_time: typeof stopItem.departure_time === "string" ? stopItem.departure_time : undefined,
        lat: asNumber(stopItem.stop_lat ?? stopItem.lat ?? knownStop?.lat),
        lon: asNumber(stopItem.stop_lon ?? stopItem.lon ?? knownStop?.lon),
      };
    });
    return {
      trip_id: asText(item.trip_id ?? item.id ?? `trip-${tripIndex + 1}`),
      route_id: typeof item.route_id === "string" ? item.route_id : typeof item.routeId === "string" ? item.routeId : undefined,
      stops: tripStops,
    };
  });
  return {
    stop_count: asNumber(raw.stop_count),
    trip_count: asNumber(raw.trip_count),
    route_count: asNumber(raw.route_count),
    routes: Array.isArray(raw.routes) ? raw.routes as RouteInfo[] : [],
    schedule_range: (raw.schedule_range ?? { first_departure: "", last_departure: "" }) as BaselineEvaluation["schedule_range"],
    stops,
    trips,
  };
}

export async function createScenario(baselineId: FeedId, name: string): Promise<Scenario> {
  const raw = await request<Record<string, unknown>>("/scenarios", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseline_id: baselineId, name }),
  });
  return { ...raw, id: String(raw.id ?? raw.scenario_id) } as Scenario;
}

export async function getBaselineTrips(feedId: FeedId): Promise<FeedTrip[]> {
  const raw = await request<any[]>(`/baseline/${feedId}/trips`);
  return raw.map((t) => ({
    trip_id: t.trip_id,
    route_id: t.route_id,
    stops: (t.stops ?? []).map((s: any) => ({
      stop_id: s.stop_id,
      stop_sequence: s.stop_sequence,
      lat: s.lat,
      lon: s.lon,
    }))
  }));
}

export async function listScenarios(baselineId: FeedId): Promise<Scenario[]> {
  const res = await fetch(`${API_BASE}/baseline/${baselineId}/scenarios`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const data: any[] = await res.json();
  return data.map((s) => ({ ...s, id: String(s.id), baseline_id: String(s.baseline_id) }));
}

export async function getScenarioChanges(scenarioId: string): Promise<Change[]> {
  return request<Change[]>(`/scenarios/${scenarioId}/changes`);
}

export async function addScenarioChange(
  scenarioId: string,
  change: { change_type: ChangeType; target_type: TargetType; target_id: string | null; payload: unknown }
): Promise<Change> {
  return request<Change>(`/scenarios/${scenarioId}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
}

export async function discardChange(scenarioId: string, changeId: string): Promise<void> {
  await request<void>(`/scenarios/${scenarioId}/changes/${changeId}/discard`, { method: "PATCH" });
}

export async function evaluateScenario(scenarioId: string): Promise<ScenarioEvaluation> {
  return request<ScenarioEvaluation>(`/scenarios/${scenarioId}/evaluate`, { method: "POST" });
}


export async function explainConflict(
  conflict: Conflict
): Promise<{ explanation: string }> {
  return request<{ explanation: string }>("/ai/explain-conflict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ conflict }),
  });
}


export async function compareScenario(scenarioId: string, originStopId: string, windowMinutes: number): Promise<CompareResult> {
  const params = new URLSearchParams({ origin_stop_id: originStopId, window_minutes: String(windowMinutes) });
  const raw = await request<any>(`/scenarios/${scenarioId}/compare?${params}`);
  const acc = raw.accessibility ?? raw;
  return {
    baseline_count:   acc.baseline_count ?? 0,
    temp_count:       acc.temp_count ?? 0,
    delta:            acc.delta ?? 0,
    gained_stops:     acc.gained_stops ?? [],
    lost_stops:       acc.lost_stops ?? [],
    conflict_summary: raw.conflict_summary,
  };
}
export async function exportScenario(scenarioId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/scenarios/${scenarioId}/export`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.blob();
}
