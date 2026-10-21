# Rateio da Água

Web app to record the monthly meter readings of a group of chácaras and split
the electricity cost of the shared water pump. It replaces the old Microsoft
Access 2009 app (`Kw.mdb`). The interface is in Portuguese (pt-BR) and is
designed for people who are not used to computers: large type, one obvious
action per screen, and plain words.

## What it does

| Screen | What for |
| --- | --- |
| **Leituras** (home) | Pick the month with the arrows or the month and year dropdowns. Set the month's kWh price and reserve fund (each month has its own; a calculator, always open, derives the kWh price from the pump's electricity bill), then type the reading of every chácara, like on the meter's counter. Consumption and bill (kWh × price + reserve fund) are calculated as you type, from the previous month's reading; only a chácara's first reading asks for the previous one. Mark bills as paid. |
| **Chácara** (`/chacaras/:id`) | The spreadsheet of one chácara from the requirements: Ano, Mês, Leitura Atual, Leitura Anterior, Consumo, Preço kWh, Custo Energia, Fundo Reserva, Total, Status. Correct or delete rows, add readings. |
| **Histórico** | Every bill with filters (chácara, year, paid/pending) and a CSV export that opens in Excel. |
| **Gráficos** | Energy cost per month (by chácara), consumption per chácara and payments per month, each with a table view. |
| **Relatórios** | Monthly bill per chácara (owner, property, reading, calculation, bank details and a **Pix QR code with the amount**, plus a WhatsApp message) and the annual report per owner. Both print or save as PDF. |
| **Cadastros** | Owners (name, document, contact, e-mail) and chácaras (name, address with CEP lookup, meter number, owner). Search by any field. |
| **Configurações** | "Cobranças" (group name and due day), "Dados Bancários" (bank, branch, account, type, Pix key), "Senha de acesso" (the password that unlocks the app, see [Password](#password)), a database backup download and the import of the old Access data from a `.zip` (see [Importing the old Access data](#importing-the-old-access-data)). |

Safety nets for non-technical users:

- Readings lower than the previous one are rejected, and readings far above
  the chácara's recent average ask for confirmation (catches an extra digit).
- Leaving the readings screen with unsaved values asks first.
- Correcting a month also fixes the "leitura anterior" of the following month.
- Each month has its own kWh price and reserve fund, and each reading keeps
  the values it was billed with. Changing a month's values re-prices only that
  month's unpaid bills; paid bills never change. A new month starts with the
  previous month's values.

## Stack

- [Bun](https://bun.sh) runtime and package manager
- [TanStack Start](https://tanstack.com/start) (React 19, file-based routes,
  server functions) on Vite
- [Drizzle ORM](https://orm.drizzle.team) with SQLite through `bun:sqlite`
- [shadcn/ui](https://ui.shadcn.com) components on Tailwind CSS v4, Recharts
  (via shadcn charts), `qrcode.react`, Zod for validation
- Biome for lint/format, `bun test` for tests

## Getting started

```bash
bun install
bun run db:seed    # optional: fictitious chácaras and 18 months of readings
bun run dev        # http://localhost:3000
```

The SQLite database is created on first start at `data/rateio.sqlite` and
migrations run automatically.

### Scripts

| Script | Description |
| --- | --- |
| `bun run dev` | Development server (Vite, running on Bun) |
| `bun run build` / `bun run start` | Production build and Bun server (`server.ts`) |
| `bun run test` | Unit and repository tests |
| `bun run typecheck` / `bun run check` | TypeScript and Biome |
| `bun run db:generate` | New migration after changing `src/db/schema.ts` |
| `bun run db:migrate` | Create/upgrade the database without starting the app |
| `bun run db:seed [--reset]` | Demo data (refuses to run on a non-empty database without `--reset`) |
| `bun run db:import-legacy <folder> [--reset]` | Import the old Access data (adds what's missing; `--reset` wipes the data first) |
| `bun run db:studio` | Drizzle Studio |

### Environment variables

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | Production server port |
| `DATABASE_PATH` | `data/rateio.sqlite` | SQLite file |
| `MIGRATIONS_PATH` | `drizzle` | Folder with the SQL migrations |
| `APP_PASSWORD` | *(none)* | Password that unlocks the app (see [Password](#password)); also the secret of the backup export for scripts |
| `LEGACY_DATA_PATH` | *(none)* | Folder with the old Access app's CSV export: an empty database is filled with it on start (see [below](#on-a-server)) |

## Importing the old Access data

Export the three tables of `Kw.mdb` to CSV (for example with
[mdbtools](https://github.com/mdbtools/mdbtools)) into a folder **outside the
repository or under `legacy/`** (git-ignored — the data has personal
information and this repository is public):

```bash
mdb-export Kw.mdb T_Usuarios > legacy/T_Usuarios.csv
mdb-export Kw.mdb T_Fatura   > legacy/T_Fatura.csv
mdb-export Kw.mdb T_Cosumo   > legacy/T_Consumo.csv
bun run db:import-legacy legacy
```

Or, in the app, **Configurações → Dados do sistema antigo**: send a `.zip`
with the three CSVs (in any folder of it; other files, like `Kw.mdb`, are
ignored). CSVs saved as Windows-1252 instead of UTF-8 work too.

Each old user becomes an owner and a chácara (the chácara number is taken from
the old address column), and each consumption row becomes a reading with the
price and fund it was billed with. The billing month is the month the reading
period ends in ("10 Nov 07 / 10 Jan 08" → January 2008). Rows without readings
are skipped and listed. Each month's kWh price and reserve fund are the values
most used in that month's bills.

Importing again, or into a database that already has data, only adds what is
missing, and nothing already there changes. An old user whose chácara is
already in the app keeps it: imported before (the owner's notes keep the old
code), or with the same name or meter number. Months that already have a
reading keep it. A name or meter shared by two chácaras in the app is
reported instead of guessed. `--reset` (script only) wipes the data first;
the password stays.

### On a server

To start a server with the old history, give it the three CSVs — never through
the repository or the image, since the repository is public — and point
`LEGACY_DATA_PATH` at their folder. When the app opens a database without
owners or chácaras, it imports them first and logs the summary; once there is
data, it leaves the files alone. A password or settings already saved are
kept.

```bash
docker run -d -p 3000:3000 -v rateio-data:/app/data \
  -v "$PWD/legacy:/app/legacy:ro" -e LEGACY_DATA_PATH=/app/legacy \
  -e APP_PASSWORD=… rateio
```

On Dokploy: one *File Mount* per CSV (`/app/legacy/T_Usuarios.csv`,
`/app/legacy/T_Fatura.csv`, `/app/legacy/T_Consumo.csv`) and
`LEGACY_DATA_PATH=/app/legacy` in the environment, then deploy.

## Production

```bash
bun install
bun run build
PORT=3000 bun run start
```

`server.ts` serves `dist/client` (with path-traversal protection and gzip) and
hands everything else to TanStack Start. Keep `data/` on persistent storage.

Set a password (below) before the app is reachable by anyone else, and use
HTTPS when it is reachable from the internet (e.g. behind Caddy, nginx or
Cloudflare). Behind a reverse proxy, forward `X-Forwarded-Proto` (so the
session cookie gets the `Secure` flag) and append the client address to
`X-Forwarded-For`.

### Docker

The `Dockerfile` builds the production image: `server.ts` on port 3000,
running as the unprivileged `bun` user. The database is in `/app/data` —
mount a volume there, or it is lost every time the container is replaced
(every deploy). The container starts as root just to hand `/app/data` to
`bun`, so files left there by root (an older image, a restore, a database
copied in by hand) don't make the database read-only.

```bash
docker build -t rateio .
docker run -d -p 3000:3000 -v rateio-data:/app/data -e APP_PASSWORD=… rateio
```

On [Dokploy](https://dokploy.com): build type *Dockerfile*, a volume mount
at `/app/data`, the domain on port 3000, and `APP_PASSWORD` in the
environment.

### Password

Without a password, anyone who can open the app sees and changes the data
(Configurações warns about it). There are two passwords, and either one
unlocks the app:

- **Configurações → Senha de acesso**: created, changed or removed in the app
  (changing or removing it asks for the current password). Stored as an
  argon2id hash.
- **`APP_PASSWORD`**: set by whoever runs the server. It can't be changed from
  the app, so it is also the way back in when the other one is forgotten. It
  is also the secret of the [backup export](#scheduled-backups) — make it
  long.

How the lock works:

- `src/start.ts` checks every request. While locked, pages redirect to the
  unlock page (`/desbloquear`, which carries no data), `/api/*` answers 401 and
  every server function answers with a redirect, whether called by a page or
  directly over HTTP. Requests that change something, and the `/api` routes
  such as the backup download, must come from the app's own pages (CSRF
  check).
- Unlocking creates a session: a random token in an `HttpOnly`,
  `SameSite=Lax` cookie, kept on the server only as a SHA-256 hash, valid for
  60 days on that device. *Sair deste aparelho* ends it. Changing or removing
  a password signs all devices out, except the one that did it in
  Configurações.
- Wrong passwords are throttled: 10 attempts per client and 30 in total every
  15 minutes (devices already unlocked are not affected).
- With a password, responses are sent with `Cache-Control: private, no-store`,
  so pages don't stay in the browser after leaving.

Forgot the password? Set `APP_PASSWORD`, restart, unlock with it and change
the password in Configurações. Or remove it directly:
`sqlite3 data/rateio.sqlite "DELETE FROM app_password; DELETE FROM sessions;"`.

### Backup and restore

*Configurações → Cópia de segurança* downloads a consistent copy of the
database (`VACUUM INTO`). To restore, stop the server and replace
`data/rateio.sqlite` with the downloaded file (delete any `-wal`/`-shm` files
next to it). The copy keeps the password set in Configurações and leaves out
the sessions, so after a restore every device asks for the password again.

#### Scheduled backups

`GET /api/exportar` returns the same file for scripts. It needs `APP_PASSWORD`
as a bearer token (the session cookie doesn't work there, so other sites
can't trigger it), and it is off when `APP_PASSWORD` isn't set:

```bash
curl -fsS -H "Authorization: Bearer $APP_PASSWORD" \
  -o "rateio-$(date +%F).sqlite" https://your-server/api/exportar
```

| Status | Meaning |
| --- | --- |
| `200` | The database file (`application/vnd.sqlite3`) |
| `401` | Missing or wrong secret |
| `404` | `APP_PASSWORD` isn't set on the server |
| `429` | Too many wrong secrets: same brake as the unlock page (`Retry-After`) |

Only send it over HTTPS (or inside the server), since the secret travels in
the request. For a daily copy with cron, keep the header in a file only you
can read, so the secret doesn't show up in the command line (`ps`):

```bash
(umask 077 && printf 'Authorization: Bearer %s\n' "$APP_PASSWORD" > ~/.rateio-export)
```

```cron
0 3 * * * curl -fsS -H @$HOME/.rateio-export -o "$HOME/backups/rateio-$(date +\%F).sqlite" https://your-server/api/exportar
```

(`%` must be escaped in crontab.)

## Project structure

```
drizzle/                 SQL migrations (generated by drizzle-kit)
scripts/                 migrate, demo seed, legacy import
server.ts                production Bun server
src/
  start.ts               request/server-function middleware: password lock, CSRF
  db/                    schema + bun:sqlite client (auto-migrates)
  lib/                   pure logic: money, billing, periods, Pix BR Code,
                         masks, CSV, zod schemas (all unit tested)
  server/                *.server.ts repositories (Drizzle) and
                         *.functions.ts server functions (createServerFn)
  components/ui/         shadcn/ui components (generated, not linted)
  components/            app components built on shadcn
  routes/                TanStack Router file routes
  styles.css             shadcn theme variables + Tailwind
```

## Business rules

- **Consumo** = leitura atual − leitura anterior (kWh).
- **Custo energia** = consumo × preço do kWh, rounded half-up to the centavo.
- **Total** = custo energia + fundo reserva.
- Money is stored as integers: centavos, and the kWh price in millionths of a
  real (up to 4 decimals are accepted, e.g. R$ 0,8743).
- One reading per chácara per month (unique constraint); the "current" month
  follows the São Paulo time zone.
- Bills are due on the configured day of the month after the reading.
- The Pix QR code is a static BR Code (Banco Central EMV format with CRC16)
  carrying the bill amount; it needs the Pix key, the beneficiary name and city.
