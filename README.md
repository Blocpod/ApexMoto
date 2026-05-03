# ApexMoto

ApexMoto is a full-stack motorcycle companion app for route planning, group rides, ride tracking, safety workflows, and garage readiness.

It is built as a real working application, not a static concept: the web app talks to a local API, persists data, imports/exports GPX, tracks location with browser geolocation, and broadcasts live group ride state over WebSockets.

## Highlights

- Route planning with geocoding, public OSRM routing, scenic shaping, GPX import, and GPX export.
- Live group ride rooms with invite codes, captain/sweep roles, rider roster, and Socket.IO location updates.
- Ride tracking with high-accuracy browser geolocation, breadcrumbs, refresh recovery, and ride journal saving.
- Safety center with SOS/hazard/breakdown incident logging, incident resolution, and emergency contact call/text actions.
- Garage readiness with bikes, odometer updates, tire wear, service intervals, and maintenance task completion.
- Cinematic dark cockpit UI inspired by premium motorcycle instrumentation.
- Backend validation for critical payloads and clear client-side status/error handling.

## Project Structure

```text
apexmoto/
  apps/
    api/             Express + Socket.IO API
    web/             React + Vite frontend
  docs/
    API.md
    ARCHITECTURE.md
    DEPLOYMENT.md
    REAL_WORLD_READINESS.md
    SECURITY.md
  vercel.json        Vercel Services configuration
```

## Quick Start

Install dependencies:

```bash
npm install
npm --prefix apps/api install
npm --prefix apps/web install
```

Run the full stack:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

API health:

```text
http://localhost:4173/health
```

## Build

```bash
npm run build
```

## Configuration

The frontend uses:

```text
VITE_API_URL
```

If omitted, it defaults to:

```text
http://localhost:4173
```

## Persistence

Local development persists data to:

```text
apps/api/data/apexmoto.json
```

That file is ignored by Git. For production, replace JSON-file storage with a durable database.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [API](docs/API.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Real-World Readiness](docs/REAL_WORLD_READINESS.md)
- [Security Notes](docs/SECURITY.md)

## Safety Note

ApexMoto's current SOS flow logs an incident inside the app and provides call/text actions for saved contacts. It does not dispatch emergency services or guarantee notification delivery. Production emergency workflows should integrate a verified notification provider and be field tested.

## Production Roadmap

Before public launch:

- Add authentication and user-owned data.
- Move persistence to a hosted database.
- Add automated tests and CI.
- Replace public map/routing services with production-grade infrastructure.
- Add emergency contact notifications through a provider such as Twilio or equivalent.
- Add privacy zones, live link expiration, rate limiting, observability, and audit logging.
