import cors from "cors";
import express from "express";
import { createServer } from "http";
import { nanoid } from "nanoid";
import { Server } from "socket.io";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const DATA_FILE = path.join(DATA_DIR, "apexmoto.json");
const PORT = process.env.PORT || 4173;
const isString = (value) => typeof value === "string" && value.trim().length > 0;
const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const cleanCode = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

const seed = {
  routes: [
    {
      id: "route-blue-ridge",
      name: "Blue Ridge Dawn Sweep",
      style: "sport-touring",
      distanceMiles: 118,
      durationMinutes: 184,
      difficulty: "Intermediate",
      start: "Asheville, NC",
      finish: "Boone, NC",
      tags: ["twisty", "fuel at 62 mi", "viewpoints", "low traffic"],
      waypoints: [
        [-82.5515, 35.5951],
        [-82.2842, 35.7804],
        [-81.8734, 36.0105],
        [-81.6746, 36.2168]
      ],
      notes: "Morning route optimized for traffic, sweep visibility, and fuel spacing."
    }
  ],
  groups: [
    {
      id: "group-demo",
      code: "APEX24",
      name: "Sunday Ridge Crew",
      routeId: "route-blue-ridge",
      departure: "2026-05-10T13:00:00.000Z",
      captain: "Maya",
      sweep: "Jon",
      pace: "spirited",
      riders: [
        { id: "rider-1", name: "Maya", role: "Captain", bike: "Street Triple RS", status: "ready" },
        { id: "rider-2", name: "Jon", role: "Sweep", bike: "Tracer 9 GT", status: "ready" }
      ]
    }
  ],
  garage: [
    {
      id: "bike-demo",
      name: "Street Triple RS",
      year: 2024,
      odometer: 8420,
      tireFront: 74,
      tireRear: 61,
      chain: "Good",
      insuranceUntil: "2026-11-15",
      nextServiceMiles: 10000,
      tasks: [
        { id: "task-1", label: "Rear tire inspection", dueMiles: 9000, priority: "high", done: false },
        { id: "task-2", label: "Brake fluid check", dueMiles: 9800, priority: "medium", done: false }
      ]
    }
  ],
  rides: [],
  incidents: [],
  contacts: [
    { id: "contact-1", name: "Emergency Contact", phone: "+1 555 0199", relation: "Primary" }
  ],
  live: {}
};

async function loadStore() {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(seed, null, 2));
    return structuredClone(seed);
  }
}

async function saveStore() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(store, null, 2));
}

const store = await loadStore();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json({ limit: "10mb" }));

const list = (key) => (_req, res) => res.json(store[key]);
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get("/health", (_req, res) => res.json({ ok: true, name: "ApexMoto API" }));
app.get("/routes", list("routes"));
app.get("/groups", list("groups"));
app.get("/garage", list("garage"));
app.get("/rides", list("rides"));
app.get("/contacts", list("contacts"));
app.get("/incidents", list("incidents"));
app.get("/groups/:code/live", (req, res) => res.json(store.live[req.params.code.toUpperCase()] || {}));

app.post("/routes", asyncRoute(async (req, res) => {
  if (!isString(req.body.name) || !Array.isArray(req.body.waypoints) || req.body.waypoints.length < 2) {
    return res.status(400).json({ error: "Route requires a name and at least two waypoints" });
  }
  const route = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...req.body,
    distanceMiles: toNumber(req.body.distanceMiles),
    durationMinutes: toNumber(req.body.durationMinutes)
  };
  store.routes.unshift(route);
  await saveStore();
  res.status(201).json(route);
}));

app.post("/groups", asyncRoute(async (req, res) => {
  if (!isString(req.body.name)) return res.status(400).json({ error: "Group ride requires a name" });
  const requestedCode = cleanCode(req.body.code);
  let code = requestedCode || nanoid(6).toUpperCase();
  while (store.groups.some((group) => group.code === code)) code = nanoid(6).toUpperCase();
  const group = {
    id: nanoid(),
    code,
    riders: [],
    createdAt: new Date().toISOString(),
    ...req.body
  };
  group.code = code;
  store.groups.unshift(group);
  await saveStore();
  res.status(201).json(group);
}));

app.post("/groups/:code/join", asyncRoute(async (req, res) => {
  const group = store.groups.find((item) => item.code === req.params.code.toUpperCase());
  if (!group) return res.status(404).json({ error: "Group ride not found" });
  if (!isString(req.body.name)) return res.status(400).json({ error: "Rider name is required" });
  const rider = { id: nanoid(), status: "ready", role: "Rider", ...req.body };
  group.riders = [rider, ...group.riders.filter((item) => item.name !== rider.name)];
  await saveStore();
  io.to(group.code).emit("group:update", group);
  res.status(201).json(rider);
}));

app.patch("/groups/:id", asyncRoute(async (req, res) => {
  const group = store.groups.find((item) => item.id === req.params.id);
  if (!group) return res.status(404).json({ error: "Group ride not found" });
  Object.assign(group, req.body);
  await saveStore();
  io.to(group.code).emit("group:update", group);
  res.json(group);
}));

app.post("/garage", asyncRoute(async (req, res) => {
  if (!isString(req.body.name)) return res.status(400).json({ error: "Bike name is required" });
  const bike = {
    id: nanoid(),
    tasks: [],
    ...req.body,
    year: toNumber(req.body.year, new Date().getFullYear()),
    odometer: toNumber(req.body.odometer),
    tireFront: toNumber(req.body.tireFront, 100),
    tireRear: toNumber(req.body.tireRear, 100),
    nextServiceMiles: toNumber(req.body.nextServiceMiles, toNumber(req.body.odometer) + 3000)
  };
  store.garage.unshift(bike);
  await saveStore();
  res.status(201).json(bike);
}));

app.patch("/garage/:id", asyncRoute(async (req, res) => {
  const bike = store.garage.find((item) => item.id === req.params.id);
  if (!bike) return res.status(404).json({ error: "Bike not found" });
  Object.assign(bike, req.body);
  await saveStore();
  res.json(bike);
}));

app.post("/garage/:id/tasks", asyncRoute(async (req, res) => {
  const bike = store.garage.find((item) => item.id === req.params.id);
  if (!bike) return res.status(404).json({ error: "Bike not found" });
  if (!isString(req.body.label)) return res.status(400).json({ error: "Task label is required" });
  const task = { id: nanoid(), done: false, priority: "medium", ...req.body, dueMiles: toNumber(req.body.dueMiles) };
  bike.tasks.unshift(task);
  await saveStore();
  res.status(201).json(task);
}));

app.patch("/garage/:id/tasks/:taskId", asyncRoute(async (req, res) => {
  const bike = store.garage.find((item) => item.id === req.params.id);
  if (!bike) return res.status(404).json({ error: "Bike not found" });
  const task = bike.tasks.find((item) => item.id === req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  Object.assign(task, req.body);
  await saveStore();
  res.json(task);
}));

app.post("/rides", asyncRoute(async (req, res) => {
  if (!isString(req.body.name)) return res.status(400).json({ error: "Ride name is required" });
  const ride = {
    id: nanoid(),
    createdAt: new Date().toISOString(),
    ...req.body,
    distanceMiles: toNumber(req.body.distanceMiles),
    durationMinutes: toNumber(req.body.durationMinutes)
  };
  store.rides.unshift(ride);
  await saveStore();
  res.status(201).json(ride);
}));

app.post("/incidents", asyncRoute(async (req, res) => {
  if (!isString(req.body.type)) return res.status(400).json({ error: "Incident type is required" });
  const incident = { id: nanoid(), createdAt: new Date().toISOString(), status: "open", ...req.body };
  store.incidents.unshift(incident);
  await saveStore();
  io.emit("incident:new", incident);
  res.status(201).json(incident);
}));

app.patch("/incidents/:id", asyncRoute(async (req, res) => {
  const incident = store.incidents.find((item) => item.id === req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found" });
  Object.assign(incident, req.body);
  await saveStore();
  io.emit("incident:update", incident);
  res.json(incident);
}));

app.post("/contacts", asyncRoute(async (req, res) => {
  if (!isString(req.body.name) || !isString(req.body.phone)) {
    return res.status(400).json({ error: "Contact requires a name and phone" });
  }
  const contact = { id: nanoid(), ...req.body };
  store.contacts.unshift(contact);
  await saveStore();
  res.status(201).json(contact);
}));

io.on("connection", (socket) => {
  socket.on("group:join", ({ code }) => {
    if (!code) return;
    socket.join(code.toUpperCase());
    socket.emit("live:snapshot", store.live[code.toUpperCase()] || {});
  });

  socket.on("rider:position", ({ code, riderId, riderName, bike, coords, speed, heading, battery }) => {
    if (!code || !coords) return;
    const room = code.toUpperCase();
    store.live[room] ||= {};
    store.live[room][riderId || socket.id] = {
      riderId: riderId || socket.id,
      riderName: riderName || "Rider",
      bike,
      coords,
      speed,
      heading,
      battery,
      updatedAt: new Date().toISOString()
    };
    io.to(room).emit("rider:position", store.live[room][riderId || socket.id]);
  });

  socket.on("ride:beacon", (payload) => io.emit("ride:beacon", { ...payload, at: new Date().toISOString() }));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "ApexMoto server error" });
});

httpServer.listen(PORT, () => {
  console.log(`ApexMoto API running on http://localhost:${PORT}`);
});
