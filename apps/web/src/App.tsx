import { formatDistanceToNow } from "date-fns";
import L from "leaflet";
import type React from "react";
import {
  AlertTriangle,
  Bike,
  CalendarClock,
  Check,
  CircleDot,
  ClipboardCheck,
  Download,
  FileText,
  Fuel,
  Gauge,
  GaugeCircle,
  HeartPulse,
  ListChecks,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Satellite,
  ShieldAlert,
  Siren,
  TrendingUp,
  Upload,
  UserPlus,
  Users,
  Wrench
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import { io, Socket } from "socket.io-client";

type Page = "ride" | "crew" | "safety" | "garage";
type LngLat = [number, number];
type RouteRecord = {
  id: string;
  name: string;
  style: string;
  distanceMiles: number;
  durationMinutes: number;
  difficulty: string;
  start: string;
  finish: string;
  tags: string[];
  waypoints: LngLat[];
  notes: string;
};
type Rider = { id: string; name: string; role: string; bike: string; status: string };
type GroupRide = {
  id: string;
  code: string;
  name: string;
  routeId: string;
  departure: string;
  captain: string;
  sweep: string;
  pace: string;
  riders: Rider[];
};
type GarageTask = { id: string; label: string; dueMiles: number; priority: string; done: boolean };
type BikeRecord = {
  id: string;
  name: string;
  year: number;
  odometer: number;
  tireFront: number;
  tireRear: number;
  chain: string;
  insuranceUntil: string;
  nextServiceMiles: number;
  tasks: GarageTask[];
};
type Incident = { id: string; type: string; status: string; location?: LngLat; note: string; createdAt: string };
type Contact = { id: string; name: string; phone: string; relation: string };
type RideHistory = { id: string; name: string; groupCode: string; distanceMiles: number; durationMinutes: number; createdAt: string };
type LiveRider = {
  riderId: string;
  riderName: string;
  bike?: string;
  coords: LngLat;
  speed?: number;
  heading?: number;
  battery?: number;
  updatedAt: string;
};
type Notice = { type: "ok" | "warn" | "error"; message: string } | null;

const API = import.meta.env.VITE_API_URL || "http://localhost:4173";
const socketUrl = API.replace(/\/$/, "");
const defaultCenter: [number, number] = [35.7804, -82.2842];

const riderIcon = new L.DivIcon({
  html: '<span class="rider-pin"><span></span></span>',
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12]
});

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      return parsed.error || error.message;
    } catch {
      return error.message;
    }
  }
  return "Something went wrong";
}

async function geocode(query: string): Promise<LngLat | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`
  );
  const [first] = await res.json();
  return first ? [Number(first.lon), Number(first.lat)] : null;
}

async function routeBetween(start: LngLat, finish: LngLat, scenic: number): Promise<LngLat[]> {
  const midpoints = scenic > 25 ? shapedMidpoints(start, finish, scenic) : [];
  const coords = [start, ...midpoints, finish].map((point) => point.join(",")).join(";");
  const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
  const json = await res.json();
  return json.routes?.[0]?.geometry?.coordinates || [start, ...midpoints, finish];
}

function shapedMidpoints(start: LngLat, finish: LngLat, scenic: number): LngLat[] {
  const dx = finish[0] - start[0];
  const dy = finish[1] - start[1];
  const bend = Math.min(0.9, scenic / 100) * 0.65;
  return [
    [start[0] + dx * 0.32 - dy * bend, start[1] + dy * 0.32 + dx * bend],
    [start[0] + dx * 0.66 + dy * bend * 0.65, start[1] + dy * 0.66 - dx * bend * 0.65]
  ];
}

function miles(points: LngLat[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += L.latLng(points[i - 1][1], points[i - 1][0]).distanceTo(L.latLng(points[i][1], points[i][0]));
  }
  return total / 1609.344;
}

function toGpx(route: RouteRecord) {
  const pts = route.waypoints.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"></trkpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="ApexMoto"><trk><name>${route.name}</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

function FitBounds({ points }: { points: LngLat[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(points.map(([lon, lat]) => [lat, lon]), { padding: [34, 34] });
  }, [map, points]);
  return null;
}

export default function App() {
  const [page, setPage] = useState<Page>("ride");
  const [routes, setRoutes] = useState<RouteRecord[]>([]);
  const [groups, setGroups] = useState<GroupRide[]>([]);
  const [garage, setGarage] = useState<BikeRecord[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [rides, setRides] = useState<RideHistory[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteRecord | null>(null);
  const [activeGroup, setActiveGroup] = useState("APEX24");
  const [live, setLive] = useState<Record<string, LiveRider>>({});
  const [tracking, setTracking] = useState(false);
  const [track, setTrack] = useState<LngLat[]>([]);
  const [plan, setPlan] = useState({ start: "Asheville, NC", finish: "Boone, NC", scenic: 72 });
  const [rider, setRider] = useState({ name: "Alex", bike: "Tiger 900 Rally" });
  const [groupForm, setGroupForm] = useState({ name: "Mountain Lunch Loop", captain: "Alex", sweep: "Maya", pace: "social" });
  const [contactForm, setContactForm] = useState({ name: "", phone: "", relation: "" });
  const [bikeForm, setBikeForm] = useState({ name: "", year: "2026", odometer: "0" });
  const [taskForm, setTaskForm] = useState({ label: "", dueMiles: "0", priority: "medium" });
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState("");
  const [socketConnected, setSocketConnected] = useState(false);
  const [apiOnline, setApiOnline] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem("apexmoto:rider");
      if (stored) setRider(JSON.parse(stored));
      const storedTrack = localStorage.getItem("apexmoto:track");
      if (storedTrack) setTrack(JSON.parse(storedTrack));
      const storedGroup = localStorage.getItem("apexmoto:activeGroup");
      if (storedGroup) setActiveGroup(storedGroup);
    } catch {
      localStorage.removeItem("apexmoto:rider");
      localStorage.removeItem("apexmoto:track");
      localStorage.removeItem("apexmoto:activeGroup");
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("apexmoto:rider", JSON.stringify(rider));
  }, [rider]);

  useEffect(() => {
    localStorage.setItem("apexmoto:track", JSON.stringify(track));
  }, [track]);

  useEffect(() => {
    localStorage.setItem("apexmoto:activeGroup", activeGroup);
  }, [activeGroup]);

  useEffect(() => {
    Promise.all([
      api<RouteRecord[]>("/routes"),
      api<GroupRide[]>("/groups"),
      api<BikeRecord[]>("/garage"),
      api<Incident[]>("/incidents"),
      api<Contact[]>("/contacts"),
      api<RideHistory[]>("/rides")
    ]).then(([routeData, groupData, bikeData, incidentData, contactData, rideData]) => {
      setRoutes(routeData);
      setGroups(groupData);
      setGarage(bikeData);
      setIncidents(incidentData);
      setContacts(contactData);
      setRides(rideData);
      setSelectedRoute(routeData[0] || null);
      setApiOnline(true);
      setLoading(false);
    }).catch((error) => {
      setApiOnline(false);
      setNotice({ type: "error", message: `Could not load ride data: ${errorMessage(error)}` });
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const socket = io(socketUrl);
    socketRef.current = socket;
    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));
    socket.emit("group:join", { code: activeGroup });
    socket.on("live:snapshot", setLive);
    socket.on("rider:position", (payload: LiveRider) => setLive((prev) => ({ ...prev, [payload.riderId]: payload })));
    socket.on("incident:new", (payload: Incident) => {
      setIncidents((prev) => (prev.some((item) => item.id === payload.id) ? prev : [payload, ...prev]));
    });
    socket.on("incident:update", (payload: Incident) => {
      setIncidents((prev) => prev.map((item) => (item.id === payload.id ? payload : item)));
    });
    socket.on("group:update", (payload: GroupRide) => {
      setGroups((prev) => prev.map((item) => (item.id === payload.id ? payload : item)));
    });
    return () => {
      socket.disconnect();
    };
  }, [activeGroup]);

  useEffect(() => {
    if (!tracking || !navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setTrack((prev) => [...prev, coords]);
        socketRef.current?.emit("rider:position", {
          code: activeGroup,
          riderId: "local-rider",
          riderName: rider.name,
          bike: rider.bike,
          coords,
          speed: pos.coords.speed ? pos.coords.speed * 2.237 : undefined,
          heading: pos.coords.heading,
          battery: 86
        });
      },
      (error) => {
        setTracking(false);
        setNotice({ type: "error", message: `Location unavailable: ${error.message}` });
      },
      { enableHighAccuracy: true, maximumAge: 2500, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activeGroup, rider, tracking]);

  const group = groups.find((item) => item.code === activeGroup) || groups[0];
  const bike = garage[0];
  const mapPoints = track.length > 1 ? track : selectedRoute?.waypoints || [];
  const liveRiders = Object.values(live);
  const rideStats = useMemo(() => ({ miles: miles(track), points: track.length }), [track]);
  const readiness = bike
    ? Math.max(0, Math.min(100, Math.round((bike.tireFront + bike.tireRear) / 2) - bike.tasks.filter((task) => !task.done).length * 7))
    : 0;
  const openIncidents = incidents.filter((item) => item.status !== "resolved");
  const incompleteTasks = garage.flatMap((item) => item.tasks.filter((task) => !task.done));
  const selectedMiles = selectedRoute?.distanceMiles || 0;
  const selectedHours = selectedRoute ? `${Math.floor(selectedRoute.durationMinutes / 60)}h ${selectedRoute.durationMinutes % 60}m` : "0h";
  const localLive = live["local-rider"];
  const currentSpeed = Math.max(0, Math.round(localLive?.speed || 0));
  const rideScore = Math.max(40, Math.min(99, readiness + (tracking ? 6 : 0) - openIncidents.length * 5));
  const maxLeanEstimate = selectedRoute?.difficulty === "Technical" ? 48 : selectedRoute?.difficulty === "Intermediate" ? 38 : 28;
  const routeBusy = busy === "route";
  const rideBusy = busy === "ride";
  const groupBusy = busy === "group";
  const contactBusy = busy === "contact";
  const bikeBusy = busy === "bike";
  const taskBusy = busy === "task";
  const hero = {
    ride: ["Motorcycle command center", "Plan, ride, protect the crew, remember the road."],
    crew: ["Crew operations", "Launch ride rooms, assign roles, and keep everyone accounted for."],
    safety: ["Safety center", "Emergency contacts, incident command, check-ins, and ride history."],
    garage: ["Garage readiness", "Keep the machine ready before the route ever starts."]
  }[page];

  async function runAction(label: string, action: () => Promise<void>, success?: string) {
    setBusy(label);
    setNotice(null);
    try {
      await action();
      if (success) setNotice({ type: "ok", message: success });
    } catch (error) {
      setNotice({ type: "error", message: errorMessage(error) });
    } finally {
      setBusy("");
    }
  }

  async function createRoute() {
    await runAction("route", async () => {
      const start = await geocode(plan.start);
      const finish = await geocode(plan.finish);
      if (!start || !finish) throw new Error("Could not find one of those locations");
      const waypoints = await routeBetween(start, finish, plan.scenic);
      const distanceMiles = Math.round(miles(waypoints));
      const created = await api<RouteRecord>("/routes", {
        method: "POST",
        body: JSON.stringify({
          name: `${plan.start.split(",")[0]} to ${plan.finish.split(",")[0]} Rally Line`,
          style: plan.scenic > 65 ? "curvy" : "touring",
          distanceMiles,
          durationMinutes: Math.round((distanceMiles / 42) * 60),
          difficulty: plan.scenic > 70 ? "Technical" : "All-road",
          start: plan.start,
          finish: plan.finish,
          tags: ["generated", "OSM", "GPX-ready", plan.scenic > 65 ? "twisty" : "efficient"],
          waypoints,
          notes: "Generated with public geocoding/routing and ApexMoto scenic shaping."
        })
      });
      setRoutes((prev) => [created, ...prev]);
      setSelectedRoute(created);
    }, "Route generated and saved");
  }

  async function createGroup() {
    await runAction("group", async () => {
      const created = await api<GroupRide>("/groups", {
        method: "POST",
        body: JSON.stringify({
          ...groupForm,
          code: Math.random().toString(36).slice(2, 8).toUpperCase(),
          routeId: selectedRoute?.id || routes[0]?.id,
          departure: new Date(Date.now() + 86400000).toISOString(),
          riders: []
        })
      });
      setGroups((prev) => [created, ...prev]);
      setActiveGroup(created.code);
    }, "Group ride room created");
  }

  async function joinGroup() {
    if (!group) return;
    await runAction("group", async () => {
      const joined = await api<Rider>(`/groups/${group.code}/join`, {
        method: "POST",
        body: JSON.stringify({ name: rider.name, bike: rider.bike })
      });
      setGroups((prev) => prev.map((item) => (item.id === group.id ? { ...item, riders: [joined, ...item.riders.filter((r) => r.name !== joined.name)] } : item)));
    }, "Joined ride room");
  }

  async function sendSos(type = "SOS") {
    await runAction("incident", async () => {
      const location = track.length ? track[track.length - 1] : undefined;
      const incident = await api<Incident>("/incidents", {
        method: "POST",
        body: JSON.stringify({ type, location, note: `${rider.name} triggered ${type} from group ${activeGroup}` })
      });
      setIncidents((prev) => (prev.some((item) => item.id === incident.id) ? prev : [incident, ...prev]));
    }, `${type} incident logged`);
  }

  async function resolveIncident(id: string) {
    await runAction("incident", async () => {
      const updated = await api<Incident>(`/incidents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "resolved" })
      });
      setIncidents((prev) => prev.map((item) => (item.id === id ? updated : item)));
    }, "Incident resolved");
  }

  async function addContact() {
    if (!contactForm.name || !contactForm.phone) return;
    await runAction("contact", async () => {
      const created = await api<Contact>("/contacts", { method: "POST", body: JSON.stringify(contactForm) });
      setContacts((prev) => [created, ...prev]);
      setContactForm({ name: "", phone: "", relation: "" });
    }, "Emergency contact saved");
  }

  async function saveRide() {
    if (!track.length) return;
    await runAction("ride", async () => {
      const saved = await api<RideHistory>("/rides", {
        method: "POST",
        body: JSON.stringify({
          name: `${rider.name}'s tracked ride`,
          groupCode: activeGroup,
          distanceMiles: Number(rideStats.miles.toFixed(1)),
          points: track,
          durationMinutes: Math.max(1, Math.round(track.length / 2))
        })
      });
      setRides((prev) => [saved, ...prev]);
      setTrack([]);
      setTracking(false);
    }, "Ride saved to journal");
  }

  async function addBike() {
    if (!bikeForm.name) return;
    await runAction("bike", async () => {
      const created = await api<BikeRecord>("/garage", {
        method: "POST",
        body: JSON.stringify({
          name: bikeForm.name,
          year: Number(bikeForm.year),
          odometer: Number(bikeForm.odometer),
          tireFront: 100,
          tireRear: 100,
          chain: "Fresh",
          insuranceUntil: "2027-01-01",
          nextServiceMiles: Number(bikeForm.odometer) + 3000,
          tasks: []
        })
      });
      setGarage((prev) => [created, ...prev]);
      setBikeForm({ name: "", year: "2026", odometer: "0" });
    }, "Bike added to garage");
  }

  async function addTask(bikeId: string) {
    if (!taskForm.label) return;
    await runAction("task", async () => {
      const task = await api<GarageTask>(`/garage/${bikeId}/tasks`, {
        method: "POST",
        body: JSON.stringify({ label: taskForm.label, dueMiles: Number(taskForm.dueMiles), priority: taskForm.priority })
      });
      setGarage((prev) => prev.map((item) => (item.id === bikeId ? { ...item, tasks: [task, ...item.tasks] } : item)));
      setTaskForm({ label: "", dueMiles: "0", priority: "medium" });
    }, "Service task added");
  }

  async function completeTask(bikeId: string, taskId: string) {
    await runAction("task", async () => {
      const updated = await api<GarageTask>(`/garage/${bikeId}/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
      setGarage((prev) =>
        prev.map((item) => (item.id === bikeId ? { ...item, tasks: item.tasks.map((task) => (task.id === taskId ? updated : task)) } : item))
      );
    }, "Service task completed");
  }

  async function updateBike(bikeId: string, patch: Partial<BikeRecord>) {
    await runAction("bike", async () => {
      const updated = await api<BikeRecord>(`/garage/${bikeId}`, { method: "PATCH", body: JSON.stringify(patch) });
      setGarage((prev) => prev.map((item) => (item.id === bikeId ? updated : item)));
    });
  }

  function toggleTracking() {
    if (tracking) {
      setTracking(false);
      setNotice({ type: "warn", message: "Tracking paused. Save the ride when you are done." });
      return;
    }
    if (!navigator.geolocation) {
      setNotice({ type: "error", message: "This browser does not support location tracking" });
      return;
    }
    setNotice({ type: "ok", message: "Requesting high-accuracy location..." });
    setTracking(true);
  }

  return (
    <main className="app-shell">
      <div className="cinema-backdrop" aria-hidden="true" />
      <aside className="side-rail">
        <div className="brand">
          <span className="apex-mark" aria-hidden="true">A</span>
          <span>ApexMoto</span>
        </div>
        <NavButton page="ride" active={page} setPage={setPage} icon={<Navigation size={18} />} label="Ride" />
        <NavButton page="crew" active={page} setPage={setPage} icon={<Users size={18} />} label="Crew" />
        <NavButton page="safety" active={page} setPage={setPage} icon={<ShieldAlert size={18} />} label="Safety" />
        <NavButton page="garage" active={page} setPage={setPage} icon={<Wrench size={18} />} label="Garage" />
      </aside>

      <section className="workspace">
        {notice && (
          <div className={`notice ${notice.type}`} role="status">
            <span>{notice.message}</span>
            <button onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        <header className="topbar">
          <div className="hero-copy">
            <p className="eyebrow">{hero[0]}</p>
            <p className="brandline">Ride. Analyze. Connect.</p>
            <h1>{hero[1]}</h1>
            <div className="hero-metrics">
              <span><strong>{selectedMiles}</strong> route miles</span>
              <span><strong>{selectedHours}</strong> saddle time</span>
              <span><strong>{group?.riders.length || 0}</strong> checked in</span>
            </div>
          </div>
          <div className="status-strip">
            <span><Satellite size={16} /> {apiOnline ? "API live" : "API offline"}</span>
            <span><Radio size={16} /> {socketConnected ? `${liveRiders.length} online` : "offline"}</span>
            <span><Gauge size={16} /> {readiness}% ready</span>
          </div>
        </header>

        {loading && <div className="panel loading-panel"><RefreshCw className="spin" /> Loading ApexMoto...</div>}
        {!loading && page === "ride" && renderRide()}
        {!loading && page === "crew" && renderCrew()}
        {!loading && page === "safety" && renderSafety()}
        {!loading && page === "garage" && renderGarage()}
      </section>
    </main>
  );

  function renderRide() {
    return (
      <section className="main-grid">
        <div className="map-panel">
          <div className="map-chrome">
            <div>
              <p>Active line</p>
              <strong>{selectedRoute?.name || "No route selected"}</strong>
            </div>
            <span>{tracking ? "Recording" : "Standby"}</span>
          </div>
          <MapContainer center={defaultCenter} zoom={8} className="map">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {mapPoints.length > 1 && <Polyline positions={mapPoints.map(([lon, lat]) => [lat, lon])} color="#f35b2f" weight={5} />}
            {liveRiders.map((item) => (
              <Marker key={item.riderId} icon={riderIcon} position={[item.coords[1], item.coords[0]]}>
                <Popup>{item.riderName} · {item.bike || "bike"} · {Math.round(item.speed || 0)} mph</Popup>
              </Marker>
            ))}
            {mapPoints.length > 1 && <FitBounds points={mapPoints} />}
          </MapContainer>
          <div className="telemetry-ribbon">
            <div><span>Lean-ready</span><strong>{plan.scenic}%</strong></div>
            <div><span>Crew spread</span><strong>{liveRiders.length ? "Live" : "Idle"}</strong></div>
            <div><span>Range stop</span><strong>62 mi</strong></div>
          </div>
          <div className="ride-controls">
            <button className={tracking ? "danger" : "primary"} onClick={toggleTracking}>
              <CircleDot size={18} /> {tracking ? "Stop tracking" : "Start ride"}
            </button>
            <button onClick={saveRide} disabled={!track.length || rideBusy}><Check size={18} /> {rideBusy ? "Saving..." : "Save ride"}</button>
            <button onClick={() => sendSos("Road hazard")}><AlertTriangle size={18} /> Mark hazard</button>
            <button className="sos" onClick={() => sendSos()}><ShieldAlert size={18} /> SOS</button>
          </div>
        </div>

        <RoutePlanner />
        <LiveRideRoom />
        <PerformancePanel />
        <SafetySummary />
        <GarageSummary />
        <RideIntel />
      </section>
    );
  }

  function renderCrew() {
    return (
      <section className="page-grid crew-grid">
        <div className="panel panel-feature span-2">
          <div className="panel-title"><UserPlus /> Create group ride</div>
          <div className="form-grid">
            <label>Ride name<input value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} /></label>
            <label>Captain<input value={groupForm.captain} onChange={(event) => setGroupForm({ ...groupForm, captain: event.target.value })} /></label>
            <label>Sweep<input value={groupForm.sweep} onChange={(event) => setGroupForm({ ...groupForm, sweep: event.target.value })} /></label>
            <label>Pace<input value={groupForm.pace} onChange={(event) => setGroupForm({ ...groupForm, pace: event.target.value })} /></label>
          </div>
          <button className="primary" onClick={createGroup} disabled={groupBusy}><Plus size={18} /> {groupBusy ? "Launching..." : "Launch ride room"}</button>
        </div>
        <LiveRideRoom expanded />
        <div className="panel panel-crew span-2">
          <div className="panel-title"><Users /> All ride rooms</div>
          <div className="room-list">
            {groups.map((item) => (
              <button key={item.id} className={`room-card ${item.code === activeGroup ? "selected" : ""}`} onClick={() => setActiveGroup(item.code)}>
                <span><strong>{item.name}</strong><small>{item.code} · {item.pace} · {item.riders.length} riders</small></span>
                <span>{item.captain}/{item.sweep}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="panel panel-intel">
          <div className="panel-title"><Radio /> Live roster</div>
          {liveRiders.length ? liveRiders.map((item) => (
            <div className="rider-row" key={item.riderId}>
              <span>{item.riderName}<small>{item.bike || "Unknown bike"} · {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}</small></span>
              <strong>{Math.round(item.speed || 0)} mph</strong>
            </div>
          )) : <p className="muted">No riders broadcasting location yet.</p>}
        </div>
      </section>
    );
  }

  function renderSafety() {
    return (
      <section className="page-grid safety-grid">
        <div className="panel panel-alert">
          <div className="panel-title"><Siren /> Emergency actions</div>
          <p className="muted">Logs an incident in ApexMoto. Use saved contacts below to call or text for real assistance.</p>
          <button className="sos full" onClick={() => sendSos()}><ShieldAlert size={18} /> Trigger SOS</button>
          <button className="full" onClick={() => sendSos("Mechanical breakdown")}><Wrench size={18} /> Mechanical breakdown</button>
          <button className="full" onClick={() => sendSos("Road hazard")}><AlertTriangle size={18} /> Road hazard</button>
          <div className="metric"><span>Open incidents</span><strong>{openIncidents.length}</strong></div>
          <div className="metric"><span>Breadcrumbs</span><strong>{rideStats.points}</strong></div>
        </div>
        <div className="panel panel-feature">
          <div className="panel-title"><Phone /> Emergency contacts</div>
          <div className="form-grid compact">
            <input placeholder="Name" value={contactForm.name} onChange={(event) => setContactForm({ ...contactForm, name: event.target.value })} />
            <input placeholder="Phone" value={contactForm.phone} onChange={(event) => setContactForm({ ...contactForm, phone: event.target.value })} />
            <input placeholder="Relation" value={contactForm.relation} onChange={(event) => setContactForm({ ...contactForm, relation: event.target.value })} />
          </div>
          <button className="primary full" onClick={addContact} disabled={contactBusy || !contactForm.name || !contactForm.phone}><Plus size={18} /> {contactBusy ? "Saving..." : "Add contact"}</button>
          {contacts.map((item) => (
            <div className="rider-row contact-row" key={item.id}>
              <span>{item.name}<small>{item.relation}</small></span>
              <strong>{item.phone}</strong>
              <a href={`tel:${item.phone}`} aria-label={`Call ${item.name}`}>Call</a>
              <a href={`sms:${item.phone}?&body=${encodeURIComponent(`ApexMoto alert for ${rider.name}. Group ${activeGroup}. Last known track points: ${track.length}.`)}`} aria-label={`Text ${item.name}`}>Text</a>
            </div>
          ))}
        </div>
        <div className="panel panel-alert span-2">
          <div className="panel-title"><ClipboardCheck /> Incident command</div>
          <div className="incident-table">
            {incidents.map((item) => (
              <div className="incident-card" key={item.id}>
                <span><strong>{item.type}</strong><small>{item.note} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</small></span>
                <button onClick={() => resolveIncident(item.id)} disabled={item.status === "resolved"}>{item.status === "resolved" ? "Resolved" : "Resolve"}</button>
              </div>
            ))}
          </div>
        </div>
        <div className="panel panel-intel">
          <div className="panel-title"><FileText /> Ride journal</div>
          {rides.length ? rides.map((item) => (
            <div className="rider-row" key={item.id}>
              <span>{item.name}<small>{item.groupCode} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</small></span>
              <strong>{item.distanceMiles} mi</strong>
            </div>
          )) : <p className="muted">Saved rides will appear here.</p>}
        </div>
      </section>
    );
  }

  function renderGarage() {
    return (
      <section className="page-grid garage-page">
        <div className="panel panel-feature">
          <div className="panel-title"><Bike /> Add bike</div>
          <label>Bike<input placeholder="DesertX Rally" value={bikeForm.name} onChange={(event) => setBikeForm({ ...bikeForm, name: event.target.value })} /></label>
          <div className="two">
            <label>Year<input value={bikeForm.year} onChange={(event) => setBikeForm({ ...bikeForm, year: event.target.value })} /></label>
            <label>Odometer<input value={bikeForm.odometer} onChange={(event) => setBikeForm({ ...bikeForm, odometer: event.target.value })} /></label>
          </div>
          <button className="primary full" onClick={addBike} disabled={bikeBusy || !bikeForm.name}><Plus size={18} /> {bikeBusy ? "Saving..." : "Add to garage"}</button>
        </div>
        <div className="panel panel-garage span-2">
          <div className="panel-title"><HeartPulse /> Fleet readiness</div>
          <div className="fleet-grid">
            {garage.map((item) => (
              <div className="bike-card framed" key={item.id}>
                <h2>{item.year} {item.name}</h2>
                <div className="meter"><span style={{ width: `${Math.max(0, Math.min(100, Math.round((item.tireFront + item.tireRear) / 2) - item.tasks.filter((task) => !task.done).length * 7))}%` }} /></div>
                <div className="garage-grid">
                  <span><Gauge /> {item.odometer.toLocaleString()} mi</span>
                  <span><Fuel /> service {item.nextServiceMiles.toLocaleString()}</span>
                  <span><CalendarClock /> {item.insuranceUntil}</span>
                  <span><Wrench /> chain {item.chain}</span>
                </div>
                <div className="two">
                  <button onClick={() => updateBike(item.id, { odometer: item.odometer + 100 })}>+100 mi</button>
                  <button onClick={() => updateBike(item.id, { tireRear: Math.max(0, item.tireRear - 5) })}>Wear rear tire</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel panel-intel">
          <div className="panel-title"><ListChecks /> Add service task</div>
          <input placeholder="Task" value={taskForm.label} onChange={(event) => setTaskForm({ ...taskForm, label: event.target.value })} />
          <div className="two">
            <input placeholder="Due miles" value={taskForm.dueMiles} onChange={(event) => setTaskForm({ ...taskForm, dueMiles: event.target.value })} />
            <input placeholder="Priority" value={taskForm.priority} onChange={(event) => setTaskForm({ ...taskForm, priority: event.target.value })} />
          </div>
          <button className="primary full" disabled={!bike || taskBusy || !taskForm.label} onClick={() => bike && addTask(bike.id)}><Plus size={18} /> {taskBusy ? "Saving..." : "Add task"}</button>
        </div>
        <div className="panel panel-garage span-2">
          <div className="panel-title"><ClipboardCheck /> Service board</div>
          {garage.map((item) => (
            <div className="service-block" key={item.id}>
              <h2>{item.name}</h2>
              {item.tasks.map((task) => (
                <div className={`task ${task.done ? "done" : ""}`} key={task.id}>
                  <span>{task.label}<small>{task.priority} priority</small></span>
                  <strong>{task.done ? "Done" : `${task.dueMiles.toLocaleString()} mi`}</strong>
                  {!task.done && <button onClick={() => completeTask(item.id, task.id)} disabled={taskBusy}><Check size={16} /> Done</button>}
                </div>
              ))}
            </div>
          ))}
          {!incompleteTasks.length && <p className="muted">No open service tasks. That is the good kind of quiet.</p>}
        </div>
      </section>
    );
  }

  function RoutePlanner() {
    return (
      <div className="planner panel panel-feature">
        <div className="panel-title"><Route /> Route lab</div>
        <label>Start<input value={plan.start} onChange={(event) => setPlan({ ...plan, start: event.target.value })} /></label>
        <label>Finish<input value={plan.finish} onChange={(event) => setPlan({ ...plan, finish: event.target.value })} /></label>
        <label>Scenic bias <strong>{plan.scenic}%</strong><input type="range" min="0" max="100" value={plan.scenic} onChange={(event) => setPlan({ ...plan, scenic: Number(event.target.value) })} /></label>
        <button className="primary full" onClick={createRoute} disabled={routeBusy}><Plus size={18} /> {routeBusy ? "Generating..." : "Generate route"}</button>
        {selectedRoute && (
          <div className="route-card">
            <div className="route-sigil"><GaugeCircle size={20} /> {selectedRoute.style}</div>
            <h2>{selectedRoute.name}</h2>
            <p>{selectedRoute.distanceMiles} mi · {Math.round(selectedRoute.durationMinutes / 60)}h {selectedRoute.durationMinutes % 60}m · {selectedRoute.difficulty}</p>
            <div className="tags">{selectedRoute.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <button onClick={() => download(`${selectedRoute.name}.gpx`, toGpx(selectedRoute))}><Download size={18} /> GPX</button>
          </div>
        )}
      </div>
    );
  }

  function LiveRideRoom({ expanded = false }: { expanded?: boolean }) {
    return (
      <div className={`panel panel-crew ${expanded ? "span-2" : ""}`}>
        <div className="panel-title"><Users /> Live ride room</div>
        <label>Invite code<input value={activeGroup} onChange={(event) => setActiveGroup(event.target.value.toUpperCase())} /></label>
        <div className="two">
          <input value={rider.name} onChange={(event) => setRider({ ...rider, name: event.target.value })} />
          <input value={rider.bike} onChange={(event) => setRider({ ...rider, bike: event.target.value })} />
        </div>
        <button className="full" onClick={joinGroup} disabled={groupBusy || !rider.name}><Radio size={18} /> {groupBusy ? "Joining..." : "Join crew"}</button>
        {group && <p className="muted">{group.name}: {group.pace} pace, captain {group.captain}, sweep {group.sweep}</p>}
        <div className="rider-list">
          {(group?.riders || []).map((item) => (
            <div key={item.id} className="rider-row"><span>{item.name}<small>{item.bike}</small></span><strong>{item.role}</strong></div>
          ))}
        </div>
      </div>
    );
  }

  function SafetySummary() {
    return (
      <div className="panel panel-alert">
        <div className="panel-title"><ShieldAlert /> Safety stack</div>
        <div className="metric"><span>Current track</span><strong>{rideStats.miles.toFixed(1)} mi</strong></div>
        <div className="metric"><span>Breadcrumbs</span><strong>{rideStats.points}</strong></div>
        <div className="metric"><span>Check-in window</span><strong>18 min</strong></div>
        <button className="sos full" onClick={() => sendSos("Crash signal simulation")}><ShieldAlert size={18} /> Simulate crash signal</button>
        <div className="incident-list">
          {incidents.slice(0, 3).map((item) => (
            <p key={item.id}><AlertTriangle size={15} /> {item.type} · {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}</p>
          ))}
        </div>
      </div>
    );
  }

  function PerformancePanel() {
    return (
      <div className="panel panel-performance">
        <div className="panel-title"><TrendingUp /> Ride performance</div>
        <div className="dial-wrap">
          <div className="speed-dial">
            <span>{currentSpeed || (tracking ? 1 : 0)}</span>
            <small>MPH</small>
          </div>
        </div>
        <div className="performance-score">
          <span>Ride score</span>
          <strong>{rideScore}</strong>
          <small>{rideScore > 84 ? "Excellent" : rideScore > 70 ? "Ready" : "Needs prep"}</small>
        </div>
        <div className="mini-stats">
          <div><strong>{maxLeanEstimate}°</strong><span>Est. lean</span></div>
          <div><strong>{openIncidents.length}</strong><span>Alerts</span></div>
          <div><strong>98%</strong><span>Throttle</span></div>
        </div>
      </div>
    );
  }

  function GarageSummary() {
    return (
      <div className="panel garage panel-garage">
        <div className="panel-title"><Wrench /> Garage readiness</div>
        {garage.map((item) => (
          <div key={item.id} className="bike-card">
            <h2>{item.year} {item.name}</h2>
            <div className="meter"><span style={{ width: `${readiness}%` }} /></div>
            <div className="garage-grid">
              <span><Gauge /> {item.odometer.toLocaleString()} mi</span>
              <span><Fuel /> service {item.nextServiceMiles.toLocaleString()}</span>
              <span><CalendarClock /> insurance {item.insuranceUntil}</span>
              <span><Wrench /> chain {item.chain}</span>
            </div>
            {item.tasks.slice(0, 2).map((task) => <p className="task" key={task.id}>{task.label}<strong>{task.done ? "Done" : `${task.dueMiles.toLocaleString()} mi`}</strong></p>)}
          </div>
        ))}
      </div>
    );
  }

  function RideIntel() {
    return (
      <div className="panel intelligence panel-intel">
        <div className="panel-title"><MapPin /> Ride intelligence</div>
        <div className="intel-grid">
          <div><strong>Fuel logic</strong><span>Suggest stops every 95 mi or before remote legs.</span></div>
          <div><strong>Privacy</strong><span>Hide home/work within configurable geofences.</span></div>
          <div><strong>Surface notes</strong><span>Flag gravel, closures, construction, and rider hazards.</span></div>
          <div><strong>Offline</strong><span>Keep route, group brief, contacts, and GPX cached.</span></div>
        </div>
        <label className="upload">
          <Upload size={18} /> Import GPX
          <input type="file" accept=".gpx" onChange={(event) => importGpx(event.currentTarget.files?.[0], setSelectedRoute, setRoutes, setNotice)} />
        </label>
      </div>
    );
  }
}

function NavButton({
  page,
  active,
  setPage,
  icon,
  label
}: {
  page: Page;
  active: Page;
  setPage: (page: Page) => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button className={`nav-pill ${active === page ? "active" : ""}`} onClick={() => setPage(page)}>
      {icon}
      {label}
    </button>
  );
}

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

async function importGpx(
  file: File | undefined,
  setSelectedRoute: (route: RouteRecord) => void,
  setRoutes: React.Dispatch<React.SetStateAction<RouteRecord[]>>,
  setNotice: (notice: Notice) => void
) {
  if (!file) return;
  try {
    const xml = new DOMParser().parseFromString(await file.text(), "application/xml");
    const waypoints: LngLat[] = Array.from(xml.querySelectorAll("trkpt"))
      .map((point) => [Number(point.getAttribute("lon")), Number(point.getAttribute("lat"))] as LngLat)
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (waypoints.length < 2) throw new Error("GPX file needs at least two track points");
    const distanceMiles = Number(miles(waypoints).toFixed(1));
    const route = await api<RouteRecord>("/routes", {
      method: "POST",
      body: JSON.stringify({
        name: file.name.replace(/\.gpx$/i, ""),
        style: "imported",
        distanceMiles,
        durationMinutes: Math.round((distanceMiles / 40) * 60),
        difficulty: "Imported",
        start: "GPX start",
        finish: "GPX finish",
        tags: ["GPX", "imported", "offline-ready"],
        waypoints,
        notes: "Imported and persisted from GPX."
      })
    });
    setRoutes((prev) => [route, ...prev]);
    setSelectedRoute(route);
    setNotice({ type: "ok", message: "GPX route imported and saved" });
  } catch (error) {
    setNotice({ type: "error", message: errorMessage(error) });
  }
}
