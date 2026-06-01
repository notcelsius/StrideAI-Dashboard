"use client";

import "ol/ol.css";
import { useEffect, useRef, useState } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import HeatmapLayer from "ol/layer/Heatmap";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import LineString from "ol/geom/LineString";
import Overlay from "ol/Overlay";
import { fromLonLat } from "ol/proj";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import { HUB_COLORS, formatDwell } from "@/lib/hubComputation";

// Patient-set label pins sit on top of the auto-detected hubs and use a cool
// blue so they read as distinct from the warm habitual/frequented palette.
const NAMED_PIN_FILL = "#2563eb";
const NAMED_PIN_TEXT = "#1e3a8a";

// Labels are free text the patient typed, so escape before injecting into the
// popup's innerHTML.
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

function formatLabelDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// Cap heatmap input so OpenLayers stays smooth on large studies. Density still
// reads correctly after a uniform stride sample.
const HEATMAP_POINT_CAP = 20000;
// Cap points drawn per track segment so dense lines stay responsive.
const TRACK_SEGMENT_CAP = 2000;

function strideSample(arr, cap) {
  if (!arr || arr.length <= cap) return arr || [];
  const stride = Math.ceil(arr.length / cap);
  const out = [];
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i]);
  // Always keep the final point so the line ends where the data does.
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

export default function LocationHubsMap({ hubs, points, tracks, namedLocations }) {
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const heatmapLayerRef = useRef(null);
  const [showHeatmap, setShowHeatmap] = useState(true);

  useEffect(() => {
    if (!mapRef.current) return;
    const hasData = hubs?.length || points?.length || tracks?.length || namedLocations?.length;
    if (!hasData) return;

    // --- Track polylines (one color per track group / participant) ---
    const trackFeatures = (tracks || []).flatMap((group) =>
      (group.segments || [])
        .filter((seg) => seg.length > 1)
        .map((seg) => {
          const coords = strideSample(seg, TRACK_SEGMENT_CAP).map((pt) =>
            fromLonLat([pt.lon, pt.lat])
          );
          const feature = new Feature({ geometry: new LineString(coords) });
          feature.setStyle(
            new Style({ stroke: new Stroke({ color: group.color, width: 2 }) })
          );
          return feature;
        })
    );
    const trackSource = new VectorSource({ features: trackFeatures });

    // --- Hub circles + glow (optional overlay) ---
    const maxTime = hubs?.length ? Math.max(...hubs.map((h) => h.totalTimeSeconds)) : 0;
    const hubFeatures = (hubs || []).flatMap((hub) => {
      const coord = fromLonLat([hub.centerLon, hub.centerLat]);
      const intensity = maxTime > 0 ? hub.totalTimeSeconds / maxTime : 0;
      const radius = 8 + 16 * intensity;
      const color = HUB_COLORS[hub.classification];

      const glowFeature = new Feature({ geometry: new Point(coord) });
      glowFeature.setStyle(
        new Style({ image: new CircleStyle({ radius: radius * 1.5, fill: new Fill({ color: color + "33" }) }) })
      );

      const mainFeature = new Feature({ geometry: new Point(coord), hub });
      mainFeature.setStyle(
        new Style({
          image: new CircleStyle({
            radius,
            fill: new Fill({ color: color + "cc" }),
            stroke: new Stroke({ color, width: 2 }),
          }),
        })
      );
      return [glowFeature, mainFeature];
    });
    const hubSource = new VectorSource({ features: hubFeatures });

    // --- Patient-set named locations (Home / Clinic / …) ---
    const namedFeatures = (namedLocations || [])
      .filter((loc) => Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude))
      .map((loc) => {
        const feature = new Feature({
          geometry: new Point(fromLonLat([loc.longitude, loc.latitude])),
          namedLocation: loc,
        });
        feature.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 7,
              fill: new Fill({ color: NAMED_PIN_FILL }),
              stroke: new Stroke({ color: "#ffffff", width: 2 }),
            }),
            text: new Text({
              text: loc.label || "",
              offsetY: -16,
              font: "600 12px system-ui, sans-serif",
              fill: new Fill({ color: NAMED_PIN_TEXT }),
              stroke: new Stroke({ color: "#ffffff", width: 3 }),
              overflow: true,
            }),
          })
        );
        return feature;
      });
    const namedSource = new VectorSource({ features: namedFeatures });

    // --- Heatmap (density of raw points) ---
    const heatSource = new VectorSource({
      features: strideSample(points, HEATMAP_POINT_CAP).map(
        (p) => new Feature({ geometry: new Point(fromLonLat([p.lon, p.lat])), accuracy: p.accuracy })
      ),
    });
    const heatmapLayer = new HeatmapLayer({
      source: heatSource,
      blur: 18,
      radius: 12,
      // Down-weight low-accuracy fixes so noisy points contribute less density.
      // Unknown/legacy (-1, or missing) keeps full weight. ~1 at <=10m, tapering off.
      weight: (f) => {
        const a = f.get("accuracy");
        if (a == null || a < 0) return 1;
        return Math.max(0.2, Math.min(1, 10 / a));
      },
      gradient: ["#00f", "#0ff", "#0f0", "#ff0", "#f00", "#fff"],
    });
    heatmapLayer.setVisible(showHeatmap);
    heatmapLayerRef.current = heatmapLayer;

    const overlay = new Overlay({
      element: popupRef.current,
      positioning: "bottom-center",
      offset: [0, -12],
      autoPan: true,
    });

    const map = new Map({
      target: mapRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        // Heatmap (bottom), then tracks, hub circles, then named pins on top.
        heatmapLayer,
        new VectorLayer({ source: trackSource }),
        new VectorLayer({ source: hubSource }),
        new VectorLayer({ source: namedSource }),
      ],
      overlays: [overlay],
      view: new View({ center: [0, 0], zoom: 2 }),
    });

    // Fit to the most meaningful extent available: non-transient hubs > all
    // hubs > tracks > heatmap points.
    const nonTransient = (hubs || []).filter((h) => h.classification !== "transient");
    let fitExtent = null;
    if (hubFeatures.length && nonTransient.length) {
      const coords = nonTransient.map((h) => fromLonLat([h.centerLon, h.centerLat]));
      if (coords.length === 1) {
        map.getView().animate({ center: coords[0], zoom: 16, duration: 500 });
      } else {
        fitExtent = new VectorSource({
          features: nonTransient.map((h) => new Feature({ geometry: new Point(fromLonLat([h.centerLon, h.centerLat])) })),
        }).getExtent();
      }
    } else if (trackFeatures.length) {
      fitExtent = trackSource.getExtent();
    } else if (heatSource.getFeatures().length) {
      fitExtent = heatSource.getExtent();
    } else if (hubFeatures.length) {
      fitExtent = hubSource.getExtent();
    } else if (namedFeatures.length) {
      fitExtent = namedSource.getExtent();
    }
    if (fitExtent) {
      map.getView().fit(fitExtent, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 500 });
    }

    map.on("click", (e) => {
      const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f);
      const hub = feature?.get("hub");
      const named = feature?.get("namedLocation");
      if (named) {
        const setOn = formatLabelDate(named.createdDate);
        popupRef.current.innerHTML = `
          <div class="hub-popup">
            <strong style="color:${NAMED_PIN_TEXT}">📍 ${escapeHtml(named.label)}</strong>
            <br/>Patient-labeled location${setOn ? `<br/>Set ${setOn}` : ""}
          </div>
        `;
        overlay.setPosition(e.coordinate);
      } else if (hub) {
        popupRef.current.innerHTML = `
          <div class="hub-popup">
            <strong style="color:${HUB_COLORS[hub.classification]};text-transform:capitalize">${hub.classification}</strong>
            <br/>${formatDwell(hub.totalTimeSeconds)} · ${hub.visitCount} visits
            <br/>${hub.timePercentage}% of tracked time
          </div>
        `;
        overlay.setPosition(e.coordinate);
      } else {
        overlay.setPosition(undefined);
      }
    });

    map.on("pointermove", (e) => {
      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f?.get("hub") || f?.get("namedLocation"));
      map.getTargetElement().style.cursor = hit ? "pointer" : "";
    });

    mapInstanceRef.current = map;
    return () => {
      map.setTarget(null);
      heatmapLayerRef.current = null;
    };
  }, [hubs, points, tracks, namedLocations]);

  // Toggle heatmap visibility without rebuilding the map.
  useEffect(() => {
    heatmapLayerRef.current?.setVisible(showHeatmap);
  }, [showHeatmap]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapRef} className="hub-map-container" />
      {points?.length ? (
        <button
          type="button"
          className="secondary-btn hub-heatmap-toggle"
          onClick={() => setShowHeatmap((v) => !v)}
        >
          {showHeatmap ? "Hide heatmap" : "Show heatmap"}
        </button>
      ) : null}
      <div ref={popupRef} />
    </div>
  );
}
