"use client";

import { useEffect, useRef } from "react";
import Map from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import OSM from "ol/source/OSM";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import Overlay from "ol/Overlay";
import { fromLonLat } from "ol/proj";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import { HUB_COLORS, formatDwell } from "@/lib/hubComputation";

export default function LocationHubsMap({ hubs }) {
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const mapInstanceRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current || !hubs?.length) return;

    const maxTime = Math.max(...hubs.map((h) => h.totalTimeSeconds));

    const features = hubs.flatMap((hub) => {
      const coord = fromLonLat([hub.centerLon, hub.centerLat]);
      const intensity = maxTime > 0 ? hub.totalTimeSeconds / maxTime : 0;
      const radius = 8 + 16 * intensity;
      const color = HUB_COLORS[hub.classification];

      const glowFeature = new Feature({ geometry: new Point(coord) });
      glowFeature.setStyle(
        new Style({
          image: new CircleStyle({
            radius: radius * 1.5,
            fill: new Fill({ color: color + "33" }),
          }),
        })
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

    const vectorSource = new VectorSource({ features });

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
        new VectorLayer({ source: vectorSource }),
      ],
      overlays: [overlay],
      view: new View({ center: [0, 0], zoom: 2 }),
    });

    const nonTransient = hubs.filter((h) => h.classification !== "transient");
    const fitHubs = nonTransient.length > 0 ? nonTransient : hubs;
    const coords = fitHubs.map((h) => fromLonLat([h.centerLon, h.centerLat]));

    if (coords.length === 1) {
      map.getView().animate({ center: coords[0], zoom: 16, duration: 500 });
    } else {
      const extent = vectorSource.getExtent();
      map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 17, duration: 500 });
    }

    map.on("click", (e) => {
      const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f);
      const hub = feature?.get("hub");
      if (hub) {
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
      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f?.get("hub"));
      map.getTargetElement().style.cursor = hit ? "pointer" : "";
    });

    mapInstanceRef.current = map;
    return () => map.setTarget(null);
  }, [hubs]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={mapRef} className="hub-map-container" />
      <div ref={popupRef} />
    </div>
  );
}
