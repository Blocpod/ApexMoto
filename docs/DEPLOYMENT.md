# Deployment

## Local Development

Install dependencies:

```bash
npm install
npm --prefix apps/api install
npm --prefix apps/web install
```

Run both services:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

API:

```text
http://localhost:4173
```

## Production Build

```bash
npm run build
```

## Environment Variables

Frontend:

```text
VITE_API_URL=<api base url>
```

If omitted, the web app defaults to:

```text
http://localhost:4173
```

## Vercel Services

The repository includes `vercel.json` with two services:

- `web` from `apps/web`
- `api` from `apps/api/src/server.js`

Set the Vercel framework preset to Services. After deployment, configure `VITE_API_URL` for the frontend if the API is not available at the same origin.

## Data Storage

Local development persists data to:

```text
apps/api/data/apexmoto.json
```

This is not suitable as the long-term production store. Use a hosted database for production.

## Validation

Before deploying, run:

```bash
npm run build
curl -s http://localhost:4173/health
```
