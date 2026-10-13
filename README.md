# Orbit

Orbit is a polished, demo-ready student productivity SaaS prototype. It is intentionally dependency-light so it can run immediately in a browser while keeping the product architecture easy to migrate to a real API.

## Run locally

For the browser-only demo, from this folder run:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`.

## MongoDB backend

The project now includes an Express + Mongoose backend. Copy `.env.example` to `.env`, set `MONGODB_URI` to a local MongoDB instance or MongoDB Atlas connection string, then install and run:

```powershell
npm install
npm run dev
```

The API is available under `/api` and the frontend is served by the same process. Useful endpoints include:

- `POST /api/auth/register` and `POST /api/auth/login`
- `GET /api/me`
- `GET/POST /api/courses`
- `GET/POST /api/assignments`
- `PATCH/DELETE /api/assignments/:id`
- `GET /api/recommendations/next`
- `GET /api/analytics`
- `POST /api/focus-sessions`

Every organization-owned collection includes `organizationId`, and every authenticated query scopes through the organization in the JWT. Course ownership is validated when assignments are created, and member roles are checked for destructive actions.

## Demo path

1. Click **Try the live demo** or **Explore demo workspace**.
2. Start on Overview to see the recommendation engine, workload, priorities, deadlines, and progress.
3. Use **Assignment planner** to search, filter, complete, and add work.
4. Open **Weekly roadmap** to see the transparent rule-based plan.
5. Start a session in **Focus mode**; the timer is functional and persists in the current session.
6. Visit Courses, Analytics, and Settings to see the broader SaaS surface.

## Architecture notes

- `app.js` contains the UI shell, seeded demo data, view renderers, and interactions.
- `server.js` contains the MongoDB models, authentication, tenant-scoped API routes, recommendation logic, and static frontend serving.
- Data is stored in `localStorage` under `orbit_state` and every seeded record is structurally scoped through the organization-owned state (`org`, with `course` and task references). This keeps the prototype tenant-aware without pretending a browser-only demo is secure multi-tenant infrastructure.
- The recommendation score is transparent and replaceable: deadline urgency, difficulty, time estimate, and incomplete progress are combined in `score()`, while `reason()` explains the result.
- The current browser demo remains usable without MongoDB through `localStorage`; the backend is ready for the frontend API client to replace that adapter. Suggested entities are represented: organizations, users, memberships/roles, courses, assignments, subtasks, focus sessions, and subscription/usage fields.

## Deliberate limitations

Authentication, invitations, payments, browser blocking, drag-and-drop calendar scheduling, and server-side tenant isolation are represented at the product/UI layer but need a backend integration (e.g. Postgres + an auth provider + Stripe) for production use. The demo makes those future seams explicit in Settings and the pricing surface.
