# Contributing to CodeCity

Thanks for taking a look at CodeCity. This guide is for small, focused changes that keep the existing app behavior and visual style intact unless a change specifically calls for otherwise.

## Project map

- `backend/server.js` exposes the API and runs repository analysis jobs.
- `backend/lib/repo.js` validates repository input and handles remote clones.
- `backend/engine/` replays Git history, builds file histories, and calculates the city layout.
- `frontend/src/` contains the Three.js scene, city, timeline, shared insights, and the Files, History, and Health views.
- `frontend/public/city.json` is the bundled example city.
- `site/` is a separate static landing page; it does not use the Vite app.

## Run the app locally

Use Node.js 18 or newer and Git. MongoDB is optional.

In one terminal:

```bash
cd backend
npm install
npm start
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (the default is `http://localhost:3000`). The Vite config forwards API requests to the backend on port 3001.

To build the frontend bundle, run `npm run build` from `frontend/`.

## Make a focused change

1. Find the smallest relevant module before editing. Keep repository analysis in the backend engine and presentation behavior in the frontend.
2. Preserve the current API response shape when changing backend internals, since the frontend consumes the generated city data.
3. Keep the static `site/` page separate from the Vite app unless the change explicitly connects them.
4. Describe the user-visible or developer-visible result in the commit message.
5. Include reproduction steps when reporting a bug or submitting a change.

There is no automated test script currently defined in the package manifests. For frontend changes, run the production build. For backend changes, describe the scenario you checked and any local requirements such as a reachable repository or MongoDB.
