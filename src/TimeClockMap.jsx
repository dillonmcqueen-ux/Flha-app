import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Plain colored-dot divIcons instead of Leaflet's default marker images —
// avoids the well-known Vite/webpack bundling issue where Leaflet's default
// icon URLs resolve relative to its own package, and lets clock-in/clock-out
// be told apart by color at a glance.
function dotIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -8],
  });
}
const clockInIcon = dotIcon("#16A34A");
const clockOutIcon = dotIcon("#DC2626");

function fmtTime(iso) {
  return new Date(iso).toLocaleString("en-CA", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Punch-time GPS only — one pin per clock-in/clock-out that actually
// captured a location. Not a live/continuous location trail.
export default function TimeClockMap({ entries, rosterById }) {
  const pins = [];
  (entries || []).forEach((e) => {
    const name = rosterById[e.roster_id]?.name || "Unknown";
    if (typeof e.clock_in_lat === "number" && typeof e.clock_in_lng === "number") {
      pins.push({ id: `${e.id}-in`, lat: e.clock_in_lat, lng: e.clock_in_lng, accuracy: e.clock_in_accuracy_m, kind: "Clock In", icon: clockInIcon, name, at: e.clock_in });
    }
    if (typeof e.clock_out_lat === "number" && typeof e.clock_out_lng === "number") {
      pins.push({ id: `${e.id}-out`, lat: e.clock_out_lat, lng: e.clock_out_lng, accuracy: e.clock_out_accuracy_m, kind: "Clock Out", icon: clockOutIcon, name, at: e.clock_out });
    }
  });

  if (pins.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "28px 0", color: "#9CA3AF", fontSize: 13 }}>
        No punch locations captured this week yet.
      </div>
    );
  }

  const center = [pins.reduce((s, p) => s + p.lat, 0) / pins.length, pins.reduce((s, p) => s + p.lng, 0) / pins.length];

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", height: 340 }}>
      <MapContainer center={center} zoom={13} scrollWheelZoom={true} style={{ height: "100%", width: "100%" }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {pins.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={p.icon}>
            <Popup>
              <div style={{ fontWeight: 700 }}>{p.name} — {p.kind}</div>
              <div>{fmtTime(p.at)}</div>
              {typeof p.accuracy === "number" && <div style={{ color: "#6B7280" }}>±{Math.round(p.accuracy)}m accuracy</div>}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
