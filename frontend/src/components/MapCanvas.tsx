import { useEffect, useMemo, useRef } from "react";
import type { BaselineEvaluation, CompareResult, Conflict } from "../types";

declare global {
  interface Window { L: any }
}

type LayerGroup = { addTo: (map: any) => LayerGroup; clearLayers: () => void; addLayer: (layer: any) => LayerGroup; removeFrom: (map: any) => LayerGroup };

const MUMBAI: [number, number] = [19.076, 72.8777];

export function MapCanvas({
  evaluation,
  conflicts,
  compareResult,
  showStops,
  showConflicts,
  showAccessibility,
  selectedStopId,
  onStopSelect,
  selectedRouteId,
  onRouteSelect,
}: {
  evaluation: BaselineEvaluation | null;
  conflicts: Conflict[];
  compareResult: CompareResult | null;
  showStops: boolean;
  showConflicts: boolean;
  showAccessibility: boolean;
  selectedStopId: string;
  onStopSelect: (stopId: string) => void;
  selectedRouteId: string;
  onRouteSelect: (routeId: string) => void;
}) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const stopsLayer = useRef<LayerGroup | null>(null);
  const routesLayer = useRef<LayerGroup | null>(null);
  const conflictsLayer = useRef<LayerGroup | null>(null);
  const accessibilityLayer = useRef<LayerGroup | null>(null);
  const stops = useMemo(() => evaluation?.stops ?? [], [evaluation]);

  useEffect(() => {
    if (!nodeRef.current || !window.L || mapRef.current) return;
    const map = window.L.map(nodeRef.current).setView(MUMBAI, 11);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    stopsLayer.current = window.L.layerGroup().addTo(map);
    routesLayer.current = window.L.layerGroup().addTo(map);
    conflictsLayer.current = window.L.layerGroup().addTo(map);
    accessibilityLayer.current = window.L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !window.L) return;
    const routeLayer = routesLayer.current;
    const layer = stopsLayer.current;
    if (!layer || !routeLayer) return;
    routeLayer.clearLayers();
    const routeColors = ["#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#a78bfa"];
    const routeIds = Array.from(new Set((evaluation?.trips ?? []).map((trip) => trip.route_id ?? trip.trip_id)));
    (evaluation?.trips ?? []).forEach((trip) => {
      const routeId = trip.route_id ?? trip.trip_id;
      const points = trip.stops
        .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lon))
        .sort((a, b) => a.stop_sequence - b.stop_sequence)
        .map((stop) => [stop.lat, stop.lon] as [number, number]);
      if (points.length < 1) return;
      const active = selectedRouteId === routeId;
      const line = points.length > 1
        ? window.L.polyline(points, {
            color: active ? "#ffffff" : routeColors[routeIds.indexOf(routeId) % routeColors.length],
            weight: active ? 6 : 2,
            opacity: active ? 1 : 0.45,
          })
        : window.L.circleMarker(points[0], { radius: active ? 7 : 3, color: active ? "#ffffff" : "#64748b", fillColor: "#1e293b", fillOpacity: 0.8 });
      line.on("click", () => onRouteSelect(routeId));
      line.bindTooltip(`Route ${routeId}`);
      line.addTo(routeLayer);
    });
    layer.clearLayers();
    if (!showStops) return;
    stops.forEach((stop) => {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
      const marker = window.L.circleMarker([stop.lat, stop.lon], {
        radius: stop.stop_id === selectedStopId ? 9 : 5,
        color: stop.stop_id === selectedStopId ? "#ffffff" : isRouteStop(stop.stop_id, evaluation?.trips ?? [], selectedRouteId) ? "#facc15" : "#38bdf8",
        fillColor: isRouteStop(stop.stop_id, evaluation?.trips ?? [], selectedRouteId) ? "#854d0e" : "#0c4a6e",
        fillOpacity: 0.95,
        weight: 2,
      });
      marker.bindPopup(`<strong>${escapeHtml(stop.name || "Unnamed stop")}</strong><br><span>${escapeHtml(stop.stop_id)}</span>`);
      marker.on("click", () => onStopSelect(stop.stop_id));
      marker.addTo(layer);
    });
  }, [evaluation, onRouteSelect, onStopSelect, selectedRouteId, selectedStopId, showStops, stops]);

  useEffect(() => {
    const layer = conflictsLayer.current;
    if (!layer || !window.L) return;
    layer.clearLayers();
    if (!showConflicts) return;
    conflicts.forEach((conflict) => {
      const stop = stops.find((item) => item.stop_id === (conflict.location_stop_id ?? conflict.stop));
      if (!stop || !Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
      const severity = String(conflict.severity ?? "").toUpperCase();
      const marker = window.L.circleMarker([stop.lat, stop.lon], {
        radius: 9,
        color: severity === "CRITICAL" ? "#ef4444" : "#facc15",
        fillColor: severity === "CRITICAL" ? "#991b1b" : "#854d0e",
        fillOpacity: 0.95,
        weight: 3,
      });
      marker.bindPopup(`<strong>${escapeHtml(conflict.type)}</strong><br>Stop: ${escapeHtml(conflict.location_stop_id ?? conflict.stop)}<br>${escapeHtml(conflict.trip_a)} vs ${escapeHtml(conflict.trip_b)}<br>Severity: ${escapeHtml(conflict.severity)}<br>Margin: ${conflict.margin_violated_sec}s<br>Cascade: ${conflict.rf_estimated_cascade_sec}s`);
      marker.addTo(layer);
    });
  }, [conflicts, showConflicts, stops]);

  useEffect(() => {
    const layer = accessibilityLayer.current;
    if (!layer || !window.L) return;
    layer.clearLayers();
    if (!showAccessibility || !compareResult) return;
    const gained = new Set(compareResult.gained_stops);
    const lost = new Set(compareResult.lost_stops);
    stops.forEach((stop) => {
      if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lon)) return;
      const isGained = gained.has(stop.stop_id);
      const isLost = lost.has(stop.stop_id);
      if (!isGained && !isLost) return;
      window.L.circleMarker([stop.lat, stop.lon], {
        radius: 7,
        color: isGained ? "#4ade80" : "#fb923c",
        fillColor: isGained ? "#166534" : "#9a3412",
        fillOpacity: 0.95,
        weight: 2,
      }).bindPopup(`${isGained ? "Gained" : "Lost"} stop: ${escapeHtml(stop.stop_id)}`).addTo(layer);
    });
  }, [compareResult, showAccessibility, stops]);

  return <div ref={nodeRef} className="h-full min-h-[600px] w-full bg-neutral-900" />;
}

function isRouteStop(stopId: string, trips: NonNullable<BaselineEvaluation["trips"]>, routeId: string): boolean {
  if (!routeId) return false;
  return trips.some((trip) => (trip.route_id ?? trip.trip_id) === routeId && trip.stops.some((stop) => stop.stop_id === stopId));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character] ?? character));
}
