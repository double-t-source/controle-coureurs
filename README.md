# Contrôle Coureurs

A mandatory gear check management web app for trail running events (UTMB World Series style). Marshals use it on their phones at control points to record whether each runner is carrying all required gear. Supervisors and admins monitor results in real time.

---

## What it does

At ultra-trail events, every runner must carry mandatory safety gear (headlamp, emergency blanket, etc.). Marshals check each runner's gear at control points and record the result in the app. Supervisors watch the dashboard live and can follow up on any runner who failed a check.

**Three panels, three roles:**

| Panel | Who uses it | What it does |
|---|---|---|
| **Checks** (`ControleCoureurs`) | Marshals on the ground | Enter bib numbers, mark OK/KO, note missing gear |
| **Command Center** (`AdminControleCoureurs`) | Race supervisors | Monitor all checks live, manage internal notes, export reports |
| **Admin Panel** (`SuperAdminPanel`) | Event administrators | Create events/races, manage marshals and gear lists, configure email reports |

---

## Architecture

```
Browser (React + Vite)
  └── Supabase (PostgreSQL + Auth-less anon access)
        ├── Edge Functions (Deno)
        │     ├── daily-report  — sends HTML email reports via Resend
        │     └── send-bilan   — sends admin-generated summaries via Resend
        └── Storage — not used (images served from Cloudinary)
```

- **Frontend**: React 18, Vite, Tailwind CSS, i18next (FR/EN)
- **Database**: Supabase (PostgreSQL), accessed directly from the browser via the anon key
- **Maps**: React-Leaflet + OpenStreetMap (for geolocated checks)
- **PDF export**: jsPDF + jspdf-autotable
- **Email**: Resend API, called from Supabase Edge Functions

---

## Database schema

> These tables must exist in your Supabase project before using the app.

| Table | Purpose |
|---|---|
| `events` | Race events (name, date, lock status, geolocation mode, report config) |
| `races` | Races within an event (name, bib range, pacer flag) |
| `controles` | Individual gear check records |
| `marshals` | Officials who perform checks |
| `gear` | Mandatory gear items with FR/EN labels |
| `marshal_event_assignments` | Which marshals are assigned to which event |
| `event_gear` | Which gear items are required for which event |
| `locations` | Named checkpoint locations (optional, used when GPS is off) |
| `commentaires_internes` | Admin-only notes per bib/race (not visible to marshals) |
| `activity_logs` | Audit trail of all admin actions |
| `superadmins` | Super-admin accounts (display_name, password_hash, active) |

### `controles` columns

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `race_id` | int | FK → races |
| `marshal_id` | int | FK → marshals |
| `location_id` | int | FK → locations (nullable) |
| `dossard` | text | Bib number; pacers are prefixed with "P" (e.g. `P42`) |
| `resultat` | text | `"ok"` or `"ko"` |
| `materiel_manquant` | text | Gear code or free text (only for KO checks) |
| `commentaire` | text | Optional marshal comment |
| `latitude` | float8 | GPS latitude at check time (nullable) |
| `longitude` | float8 | GPS longitude at check time (nullable) |
| `created_at` | timestamptz | Auto-set by Supabase |

---

## Environment variables

Create a `.env` file (or set these in Vercel):

```env
# Supabase
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# Admin panel password (Command Center tab)
# Generate: echo -n "yourpassword" | sha256sum
VITE_ADMIN_PW_HASH=sha256_hex_of_your_password

# Supabase Edge Functions (set in the Supabase dashboard, not in .env)
SUPABASE_SERVICE_ROLE_KEY=...
RESEND_API_KEY=...
REPORT_TO_EMAIL=admin@example.com
```

**Note on authentication:** Neither the Check nor the Command Center panels use Supabase Auth. The Command Center is protected by a client-side SHA-256 password check (the hash is baked into the build via `VITE_ADMIN_PW_HASH`). The Super Admin panel uses named accounts stored in the `superadmins` table with hashed passwords, also compared client-side. This is intentional for simplicity — do not expose the admin panels to the public internet without additional network-level protection if you need stronger security.

---

## Running locally

```bash
npm install
npm run dev
# open http://localhost:5173
```

---

## Deployment (Vercel)

```bash
vercel --prod
```

Set the `VITE_*` environment variables in the Vercel project settings. The Edge Functions run on Supabase infrastructure and are deployed separately.

### Deploying Edge Functions

```bash
supabase functions deploy daily-report
supabase functions deploy send-bilan
```

Set the required secrets in the Supabase dashboard (project → Edge Functions → Secrets):
- `RESEND_API_KEY`
- `REPORT_TO_EMAIL`

### Scheduling the daily report

Set up a cron job in the Supabase dashboard (or via the Supabase CLI) to call the `daily-report` function once a day. The function only sends an email if there were checks in the last 24 hours (unless `force: true` is passed).

---

## Panel details

### Check interface (`ControleCoureurs.jsx`)

**Step 1 — Context selection:**
- Choose event, race, and marshal name
- Optionally select a named checkpoint location
- If the event has geolocation enabled, the app requests GPS permission

**Step 2 — Bib entry loop:**
- Enter a bib number (numeric keyboard on mobile)
- Toggle "Pacer" to prefix the bib with `P` (e.g. `P42`)
- Mark OK or KO; if KO, select the missing gear item or type a free-text note
- Submit — the app vibrates briefly on mobile to confirm
- The last 10 checked bibs are shown; duplicate detection warns if a bib was already checked

**Real-time sync:** The list of checked bibs is polled from Supabase every 3 seconds, so all marshals at the same control point see each other's entries.

**Locked events:** When an event is locked by an admin, the form is disabled and a lock icon appears. Existing data remains visible.

### Command Center (`AdminControleCoureurs.jsx`)

Password-protected. The password hash is set at build time via `VITE_ADMIN_PW_HASH`. Session persists across page refreshes but clears when the tab is closed.

**Live dashboard** refreshes every 5 seconds and groups all bibs into three tables:
1. **KO (pending)** — last check was KO, no subsequent OK. These runners still have a gear problem.
2. **KO → OK** — was KO at some point, but re-checked and passed. Full history shown (❌ → ✅).
3. **OK** — only ever checked OK.

**Internal notes:** Admins can add private notes to any bib (stored in `commentaires_internes`). These are never visible to marshals.

**Map view:** When checks have GPS coordinates attached, a side panel shows their positions on an OpenStreetMap map. Clicking a row pans the map to that check.

**Summary (bilan):** Generates a full statistical report (total/OK/KO counts, breakdown by race and marshal, remaining KOs, resolved KOs). Can be downloaded as a PDF or sent by email.

**PDF export:** Raw check-by-check export of all records for the selected race.

### Admin Panel (`SuperAdminPanel.jsx`)

Uses named super-admin accounts from the `superadmins` table (multiple accounts with individual passwords and activity attribution).

**Tabs:**

- **Events & Races** — Create/edit/delete events and their races. Each race can have a bib number range and a pacer flag. Events can be locked (disables new check entries). Each event can have a daily email report configured.
  - Marshal assignments: which marshals are available for each event.
  - Gear assignments: which gear items are required for each event.
  - Purge: delete all check records for a race (requires password re-entry as a confirmation step).

- **Gear** — Manage the global gear item list (code, French label, English label). Gear items are assigned per event.

- **Marshals** — Manage the marshal roster (first/last name, active status). Shows lifetime check counts and events participated in.

- **Activity Log** — Unified chronological timeline of both check records and admin actions (create/edit/delete/lock/assign).

---

## Email reports

The `daily-report` Edge Function sends three kinds of emails depending on how it is called:

| Trigger | Body |
|---|---|
| Cron (no args) | General report of all controls in the last 24 h, grouped by event and race |
| Cron (per-event) | Same, scoped to one event — sent to the event's configured email address |
| `force_event_id` from admin UI | Immediate single-event report regardless of last-24h filter |
| `force: true` from superadmin | General report sent even if no controls were recorded |

Event-specific emails also BCC the main `REPORT_TO_EMAIL` address so nothing slips through.

The `send-bilan` Edge Function is a thin Resend proxy used when the admin sends a bilan summary by email from the Command Center.

---

## Localisation

The app supports French and English. The active language is auto-detected from the browser and persisted in `localStorage`. It can be switched at any time using the FR/EN toggle in the navigation bar.

Translation files live in `src/locales/{fr,en}/translation.json`.

Gear labels stored in the database have separate `label_fr` and `label_en` columns. The gear *code* (language-neutral) is what gets saved into `controles.materiel_manquant`, so the admin view can display it in the user's current language regardless of which language the marshal was using at check time.
