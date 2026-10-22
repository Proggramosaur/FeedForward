import { useEffect, useMemo, useRef, useState } from "react";
import type { BaselineEvaluation, FeedStop, FeedTrip, TripStop } from "../types";
import { Button, ErrorBanner, LabeledInput, Panel, Spinner } from "./ui";

type LeafletMap = { setView: (center: [number, number], zoom: number) => LeafletMap; remove: () => void };
type LeafletLayerGroup = { clearLayers: () => void };

declare global {
  interface Window {
    L: any;
  }
}

type LeafletShape = {
  on: (event: string, handler: () => void) => LeafletShape;
  bindTooltip: (text: string) => LeafletShape;
  addTo: (layers: LeafletLayerGroup) => LeafletShape;
};

type ChangeDraft = {
  action: "modify" | "add" | "remove";
  stopId: string;
  arrivalTime: string;
  departureTime: string;
  stopSequence: string;
};

const MUMBAI: [number, number] = [19.076, 72.8777];

export function FeedMap({
  evaluation,
  onAddChange,
  adding,
  addError,
}: {
  evaluation: BaselineEvaluation | null;
  onAddChange: (draft: ChangeDraft, trip: FeedTrip) => Promise<void>;
  adding: boolean;
  addError: string | null;
}) {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LeafletLayerGroup | null>(null);
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ChangeDraft>({
    action: "modify",
    stopId: "",
    arrivalTime: "",
    departureTime: "",
    stopSequence: "",
  });

  const stops = useMemo(() => evaluation?.stops ?? [], [evaluation]);
  const trips = useMemo(() => evaluation?.trips ?? [], [evaluation]);
  const selectedStop = stops.find((stop) => stop.stop_id === selectedStopId) ?? null;
  const selectedTrip = trips.find((trip) => trip.trip_id === selectedTripId) ?? null;

  useEffect(() => {
    if (!mapNode.current || !window.L || mapRef.current) return;
    const map = window.L.map(mapNode.current).setView(MUMBAI, 11);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    layersRef.current = window.L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layers = layersRef.current;
    if (!map || !layers || !window.L) return;
    layers.clearLayers();

    const tripColors = ["#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#a78bfa"];
    trips.forEach((trip, index) => {
      const points = trip.stops
        .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .map((stop) => [stop.lat, stop.lon] as [number, number]);
      if (points.length < 2) return;
      const line = window.L.polyline(points, {
        color: trip.trip_id === selectedTripId ? "#f8fafc" : tripColors[index % tripColors.length],
        weight: trip.trip_id === selectedTripId ? 5 : 2.5,
        opacity: trip.trip_id === selectedTripId ? 1 : 0.7,
      });
      line.on("click", () => {
        setSelectedTripId(trip.trip_id);
        setSelectedStopId(null);
        setDraft((current) => ({ ...current, stopId: trip.stops[0]?.stop_id ?? "" }));
      });
      line.bindTooltip(`Trip ${trip.trip_id}`);
      line.addTo(layers);
    });

    stops.forEach((stop) => {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
      const marker = window.L.circleMarker([stop.lat, stop.lon], {
        radius: stop.stop_id === selectedStopId ? 8 : 5,
        color: stop.stop_id === selectedStopId ? "#f8fafc" : "#f59e0b",
        weight: 2,
        fillColor: "#111827",
        fillOpacity: 1,
      });
      marker.on("click", () => {
        setSelectedStopId(stop.stop_id);
        setSelectedTripId(null);
      });
      marker.bindTooltip(stop.name || stop.stop_id);
      marker.addTo(layers);
    });
  }, [stops, trips, selectedStopId, selectedTripId]);

  useEffect(() => {
    if (!selectedTrip || !draft.stopId) return;
    const tripStop = selectedTrip.stops.find((stop) => stop.stop_id === draft.stopId);
    if (!tripStop) return;
    setDraft((current) => ({
      ...current,
      arrivalTime: tripStop.arrival_time ?? "",
      departureTime: tripStop.departure_time ?? "",
      stopSequence: String(tripStop.stop_sequence),
    }));
  }, [selectedTrip, draft.stopId]);

  const selectTrip = (trip: FeedTrip) => {
    setSelectedTripId(trip.trip_id);
    setSelectedStopId(null);
    setDraft((current) => ({ ...current, stopId: current.stopId || trip.stops[0]?.stop_id || "" }));
  };

  const handleSubmit = async () => {
    if (!selectedTrip) return;
    await onAddChange(draft, selectedTrip);
  };

  return (
    <Panel title="Network Map">
      <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div ref={mapNode} className="h-[600px] overflow-hidden rounded-md border border-neutral-800 bg-neutral-950" />
        <aside className="space-y-4">
          {selectedStop && (
            <div className="rounded-md border border-amber-900/50 bg-amber-950/20 p-3">
              <div className="text-xs uppercase tracking-wide text-amber-500">Selected stop</div>
              <div className="mt-2 text-sm font-medium text-neutral-100">{selectedStop.name || "Unnamed stop"}</div>
              <div className="mt-1 text-xs font-mono text-neutral-400">{selectedStop.stop_id}</div>
              <div className="mt-2 text-xs font-mono text-neutral-500">{selectedStop.lat.toFixed(5)}, {selectedStop.lon.toFixed(5)}</div>
            </div>
          )}

          <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Trips</div>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {trips.length === 0 && <p className="text-xs text-neutral-600">No trip geometry in evaluation response.</p>}
              {trips.map((trip) => (
                <button
                  key={trip.trip_id}
                  onClick={() => selectTrip(trip)}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs font-mono transition-colors ${selectedTripId === trip.trip_id ? "bg-neutral-700 text-white" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"}`}
                >
                  {trip.trip_id} <span className="text-neutral-600">({trip.stops.length} stops)</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-neutral-800 bg-neutral-950/60 p-3">
            <div className="text-xs uppercase tracking-wide text-neutral-500">Trip change</div>
            {!selectedTrip ? (
              <p className="mt-2 text-xs leading-5 text-neutral-600">Click a trip line or choose a trip above to edit its stops.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="text-xs font-mono text-neutral-400">Trip: {selectedTrip.trip_id}</div>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Action</span>
                  <select
                    value={draft.action}
                    onChange={(e) => setDraft((current) => ({ ...current, action: e.target.value as ChangeDraft["action"] }))}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 focus:border-neutral-500 focus:outline-none"
                  >
                    <option value="modify">Modify stop times</option>
                    <option value="add">Add stop</option>
                    <option value="remove">Remove stop</option>
                  </select>
                </label>
                <LabeledInput label="Stop ID" value={draft.stopId} onChange={(e) => setDraft((current) => ({ ...current, stopId: e.target.value }))} className="font-mono" />
                {draft.action !== "remove" && (
                  <div className="grid grid-cols-2 gap-2">
                    <LabeledInput label="Arrival" type="time" step="1" value={draft.arrivalTime} onChange={(e) => setDraft((current) => ({ ...current, arrivalTime: e.target.value }))} />
                    <LabeledInput label="Departure" type="time" step="1" value={draft.departureTime} onChange={(e) => setDraft((current) => ({ ...current, departureTime: e.target.value }))} />
                  </div>
                )}
                {draft.action === "add" && (
                  <LabeledInput label="Stop sequence" type="number" value={draft.stopSequence} onChange={(e) => setDraft((current) => ({ ...current, stopSequence: e.target.value }))} />
                )}
                {addError && <ErrorBanner message={addError} />}
                <Button onClick={handleSubmit} disabled={adding || !draft.stopId.trim()} className="w-full">
                  {adding ? <span className="flex items-center justify-center gap-2"><Spinner /> Saving…</span> : "Save trip change"}
                </Button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </Panel>
  );
}

export type { ChangeDraft };
