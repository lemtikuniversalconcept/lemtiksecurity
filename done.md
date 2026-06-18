# Done Trace

Conservative trace of spec items that are actually present in code today.

## Foundation
- React 19 + TypeScript + Vite app is wired and builds successfully.
- TanStack Router route tree is present and app boots through `src/routes/__root.tsx`, `src/router.tsx`, and `src/start.ts`.
- Supabase auth middleware exists and is used by server functions.
- The app has a working login page, forgot-password page, and reset-password page.
- `/app` requires an authenticated user and an active organisation before rendering the shell.
- `/app` now resolves the active membership and derives a spec-aligned access role before rendering.
- `lemtik_admin` is now handled inside the unified shell instead of a separate dashboard tree.
- The unified `/app` dashboard now renders a dynamic platform console for `lemtik_admin`.
- The platform console now shows organisation totals, active subscriptions, 30-day incident totals, uptime, service health, recent client activity, subscription overview, and recent signups.
- Platform service health data now includes the seven spec services: OSINT Brain, Inventory Service, Route Calculator, Proximity Finder, Autonomous Control, Master Agent, and Relationship API.
- Platform organisation management is now available in the unified shell at `/app/admin/organisations` for `lemtik_admin`.
- The organisations table now supports search, type/tier/status filters, row actions, and per-organisation metrics.
- The create-organisation flow now provisions the org, first location, and admin invite from live Supabase data.
- The single organisation page now shows profile details, users, locations, subscription data, usage metrics, recent activity, and danger-zone actions.
- Billing and subscriptions are now available in the unified shell at `/app/admin/billing` for `lemtik_admin`.
- The billing console now shows total MRR, MRR by tier, a 12-month MRR trend, active subscriptions, overdue accounts, and tier pricing configuration.
- Tier pricing is now editable from live Supabase data and stores the tier feature unlocks alongside the monthly amount.
- System health is now available in the unified shell at `/app/admin/system` for `lemtik_admin`.
- The system health page now shows live Render service status, a response-time trend, Supabase database health, EMQX broker status, Upstash Redis status, third-party integration readiness, and restart-trigger logging.
- Restart-trigger requests are recorded in the immutable platform audit trail and platform event feed.
- Platform audit is now available in the unified shell at `/app/admin/audit` for `lemtik_admin`.
- The platform audit view now supports organisation, user, action, and date filters with CSV and JSON export.
- The platform audit view reads from the immutable audit log and does not expose edit or delete actions.
- The root document now links a web manifest and PWA-oriented metadata.
- The app registers a minimal service worker and caches the shell for offline revisits.
- A separate `/officer/*` route tree now exists for the field officer PWA surface.

## Existing App Surfaces
- Overview dashboard route exists at `/app`.
- Live map route exists at `/app/map`.
- Incidents list route exists at `/app/incidents`.
- Incident detail route exists at `/app/incidents/$id`.
- Patrols list route exists at `/app/patrols`.
- Patrol detail route exists at `/app/patrols/$id`.
- Alerts route exists at `/app/alerts`.
- Reports route exists at `/app/reports`.
- Users route exists at `/app/users`.
- User detail route exists at `/app/users/$id`.
- Locations route exists at `/app/locations`.
- Organisation settings route exists at `/app/org`.
- Audit route exists at `/app/audit`.
- Route guards now enforce section-level access on the command dashboard surfaces that exist in the app.

## Dashboard / Operations
- There is a working command shell with sidebar navigation, header, org switcher, search input, and sign-out handling.
- The overview page renders live incident and patrol summaries from server data.
- The unified `/app` overview now renders a live command dashboard for `security_manager` and `operator`, with a read-only simplified view for `client_admin`.
- The command dashboard home now shows live stat cards for open incidents, critical incidents, officers on shift, patrol compliance, vehicles available, fuel status, area risk score, and average response time.
- The command dashboard home now includes a live incident map, active incident list, OSINT alerts feed, inventory alerts, and active patrols strip backed by live Supabase data and realtime invalidation.
- The command dashboard live map now uses Mapbox GL JS with incident markers, patrol markers, geofence polygons, selected-incident focus, and a token fallback state.
- The full-screen live map at `/app/map` now includes operational incidents, OSINT threat signals, officer positions, patrol routes, heatmap overlay with opacity control, zone boundaries, and smart infrastructure markers for managers.
- The live map now includes layer toggles, search, current-location, fullscreen, and right-click actions for logging incidents, drafting zones, and viewing area intelligence.
- The incident report modal now accepts prefetched map-originated drafts so map context actions can seed the incident creation flow.
- The location editor now accepts prefetched map-originated zone drafts so map context actions can seed a new zone workflow.
- The incident detail page now includes the B3 AI Command Panel with confidence scoring, plain-English situation summaries, threat assessment, historical context, and a live incident timeline.
- The AI Command Panel now drives proximity-based officer recommendations, patrol/vehicle recommendations, autonomous action approvals, escalation shortcuts, medical alerts, and override reverts from live incident data.
- AI panel actions now write durable incident activity records through a generic incident action logger so dispatch pings, route pushes, approvals, denials, and reversions are traceable.
- AI panel dispatch actions now create real alert rows for the targeted officer, and the officer home, notifications, and navigation surfaces now consume those live dispatch alerts.
- The incident list now matches the B4 spec surface with totals, role-aware create controls, CSV export, status/type/location/zone/officer/date filters, sortable columns, per-row actions, bulk actions, and 50-row pagination.
- `client_admin` now sees the incident list in read-only mode while manager/operator roles keep log, assign, and status controls.
- The single incident detail page now uses a spec-aligned tabbed layout with Overview, AI Analysis, Activity Log, Evidence, Escalation History, and Related Incidents panels.
- The incident detail page now enforces field-officer access by ownership check and exposes reporter/assignee/time metadata in the unified header.
- The evidence workflow now persists custody metadata, chain-of-custody entries, and legal evidence flags on incident records.
- The related-incidents tab now includes a coordinate-based cluster preview in addition to linked and suggested cases.
- The command dashboard incident intake now uses a five-step wizard for basic info, location, people, evidence, and review/submit.
- The new incident flow now supports GPS capture, manual pin placement, saved locations, indoor floor notes, rich-text-style description entry, drag-and-drop evidence uploads, and voice note recording.
- Submitting a new incident now routes the user into the incident detail page and opens the AI analysis tab automatically.
- Incident list supports search, sorting, filtering, bulk actions, offline queueing, and create incident flow.
- Patrols list and detail pages exist with route management, shifts, check-ins, archive/restore, and duplicate actions.
- Alerts page has history and alert-preference configuration sections.
- Reports page generates summary analytics, CSV export, and print/PDF output.
- Locations page supports create, edit, delete, and GeoJSON geofence storage.
- Organisation page supports profile edits, emergency contacts, and org settings.
- Users page supports member list, role changes, invites, bulk invites, activation toggles, and user detail pages.
- Audit page shows a read-only action log view.
- Officer routes now include home, patrol, report, schedule, notifications, and incident detail views.
- Officer landing includes an install-first intro screen and mobile-first shell navigation.
- A dedicated officer dispatch/navigation view now exists.
- Officer quick incident reporting now sources org context and saved locations from Supabase, then supports offline queueing, auto-sync on reconnect, and a visible pending-sync state.
- Officer SOS flow now exists as a dedicated emergency screen.
- Officer notifications now include settings toggles and quiet-hours handling.
- Officer navigation now uses live incident data and device GPS, with Mapbox route preview, cached Mapbox resources for offline revisits, a stored route snapshot fallback, offline route recalculation, and arrival logging.

## State / Realtime
- The app has realtime invalidation hooks for incidents, patrols, alerts, and audit-related data.
- Offline incident queueing exists for incident creation.

## Build / Verification
- TypeScript typecheck passes.
- Production build passes.
