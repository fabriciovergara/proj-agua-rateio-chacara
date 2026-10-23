# Rateio da Água

Web app to record the water meter readings (m³) of a group of chácaras and
split the electricity bill of the shared water pump among them, by the water
each one used. It replaces the old Microsoft
Access 2009 app (`Kw.mdb`). The interface is in Portuguese (pt-BR) and is
designed for people who are not used to computers: large type, one obvious
action per screen, and plain words.

## What it does

| Screen | What for |
| --- | --- |
| **Leituras** (home) | Pick the billing period (DD/MM/AAAA to DD/MM/AAAA) with the arrows or the dropdown; "Novo período" starts the next one where the last one ended. Set the period's dates (they apply to every chácara), the pump's electricity bill (can wait until it arrives) and the reserve fund, then type each chácara's reading in m³, like on the meter's counter. "Última leitura" comes from the chácara's previous reading; correcting it corrects that reading too. A chácara read on other days gets its own dates ("Datas diferentes?"). The bill is split as you type: each chácara pays its share by m³ plus the fund. Mark bills as paid. |
| **Chácara** (`/chacaras/:id`) | The spreadsheet of one chácara: Período, Última leitura, Leitura atual, Consumo (m³), Energia, Fundo reserva, Total, Situação. Correct or delete rows, add readings in periods it lacks. |
| **Histórico** | Every bill with filters (chácara, year, paid/pending) and a CSV export that opens in Excel. |
| **Gráficos** | Energy cost per period (by chácara), water used per chácara and payments per period, each with a table view. |
| **Relatórios** | "Cobranças do período": the bill of each chácara (owner, property, reading, how the electricity bill was split, bank details and a **Pix QR code with the amount**, plus a WhatsApp message), and the annual report per owner. Both print or save as PDF. |
| **Cadastros** | Owners (name, document, contact, e-mail) and chácaras (name, address with CEP lookup, meter number, owner). Search by any field. |
| **Configurações** | "Cobranças" (group name and due day), "Dados Bancários" (bank, branch, account, type, Pix key), "Senha de acesso" (the password that unlocks the app, see [Password](#password)) and a database backup download. Unlocked with `APP_PASSWORD`, also "Importar dados" (a backup or the old Access data, see [Backup and restore](#backup-and-restore) and [Importing the old Access data](#importing-the-old-access-data)) and "Apagar todos os dados". |

Safety nets for non-technical users:

- Readings lower than the última leitura are rejected, and readings far above
  the chácara's recent average ask for confirmation (catches an extra digit).
- Leaving the readings screen with unsaved values asks first.
- A chácara's readings are a chain: correcting "Última leitura" corrects the
  reading before it, correcting "Leitura atual" corrects the next one's
  "Última leitura", and the same goes for their dates. An "Última leitura"
  lower than the reading before can only be a new meter: the screen asks
  ("Hidrômetro trocado"), and then the reading before stays as it is.
- Periods never overlap (one may start on the day the other ends); moving a
  period's date moves the neighbour that touches it.
- Unpaid bills follow every change in their period (bill, fund, readings);
  paid bills keep what was charged. A new period starts with the previous
  period's reserve fund.

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
bun run db:seed    # optional: fictitious chácaras and 18 monthly periods
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

Or, in the app, **Configurações → Importar dados** (only when unlocked with
`APP_PASSWORD`): send a `.zip` with the three CSVs (in any folder of it; other
files, like `Kw.mdb`, are ignored). CSVs saved as Windows-1252 instead of
UTF-8 work too.

Each old user becomes an owner and a chácara (the chácara number is taken from
the old address column), and each consumption row becomes a reading that
keeps what it was charged (m³ × the old price per m³, plus the fund). Rows are
grouped into periods by the month their dates end in ("10 Nov 07 / 10 Jan 08"
→ the period ending on 10/01/2008); a period's electricity bill is what its
readings charged for energy, and a chácara read on other dates ("10 Set 08 /
10 Dez 08") keeps them. Rows without readings are skipped and listed.

Importing again, or into a database that already has data, only adds what is
missing, and nothing already there changes. An old user whose chácara is
already in the app keeps it: imported before (the owner's notes keep the old
code), or with the same name or meter number. A period of the app ending in
the same month is the same period, and a chácara that already has a reading
in it keeps it. A name or meter shared by two chácaras in the app is
reported instead of guessed. `--reset` wipes the data first, like
**Apagar todos os dados** in the app; the password stays.

The old data only comes in through these two imports, never on its own (not
even into an empty database), so data wiped with **Apagar todos os dados**
stays wiped through restarts and deploys.

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
  long — and the only one that opens **Importar dados** and **Apagar todos
  os dados** in Configurações.

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
- A session remembers whether `APP_PASSWORD` opened it. Only those sessions
  see **Importar dados** and **Apagar todos os dados** in Configurações, and
  the server refuses both to any other session; wiping also asks for
  `APP_PASSWORD` again. Sessions from before this was added don't count: use
  *Sair deste aparelho* and unlock with `APP_PASSWORD` once.
- Wrong passwords are throttled: 10 attempts per client and 30 in total every
  15 minutes (devices already unlocked are not affected).
- With a password, responses are sent with `Cache-Control: private, no-store`,
  so pages don't stay in the browser after leaving.

Forgot the password? Set `APP_PASSWORD`, restart, unlock with it and change
the password in Configurações. Or remove it directly:
`sqlite3 data/rateio.sqlite "DELETE FROM app_password; DELETE FROM sessions;"`.

### Backup and restore

*Configurações → Cópia de segurança* downloads a consistent copy of the
database (`VACUUM INTO`). The copy keeps the password set in Configurações and
leaves out the sessions.

To restore it in the app, unlocked with `APP_PASSWORD`: **Configurações →
Apagar todos os dados** (it asks for `APP_PASSWORD` again and keeps the
passwords), then send the file in **Importar dados**. The app comes back as
it was in the copy, with the same record numbers in the addresses
(`/chacaras/3`). Passwords never come from a copy.

Without wiping first, **Importar dados** only adds what the app doesn't have
yet, like the old Access data: a chácara with the same name or meter is the
same chácara and only gets the periods it lacks (its owner and readings stay
as they are), a new chácara's owner is the proprietário with the same name if
there is one, a period with the same dates is the same period (one whose dates
overlap a period of the app is left out and reported), and "Cobranças" and
"Dados Bancários" come only when the app has none. A copy made by an older
version of the app is brought up to date with the migrations on the way in
(copies made by month become periods, see below); one made by a newer version
is refused.

Or, with the server stopped, replace `data/rateio.sqlite` with the downloaded
file (delete any `-wal`/`-shm` files next to it). That also brings back the
copy's password, and every device asks for the password again.

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

- Readings are the m³ on each chácara's water meter (hidrômetro).
- **Consumo** = leitura atual − última leitura (m³).
- **Energia** = conta de energia da bomba × consumo ÷ consumo de todas as
  chácaras lidas no período. Shares are whole centavos that add up to the
  bill exactly (the leftover centavos go to the largest remainders).
- **Total** = energia + fundo de reserva.
- A period has default dates for every chácara; a reading may end on its own
  date, and it starts when the chácara's previous reading ended (a chácara
  skipped in a period spans both in the next one).
- One reading per chácara per period (unique constraint). Dates are stored as
  YYYY-MM-DD; "today" follows the São Paulo time zone.
- Money is stored as integers (centavos). Each reading stores its energy
  share and fund: unpaid ones are recalculated whenever the period changes,
  paid ones keep what was charged.
- Bills are due on the configured day of the month after the period ends.

### From months to periods (migration `0004_periods`)

Databases made before periods existed are converted on start: each month
with readings or values becomes a period ending on day 10 (when the old app's
meters were read), starting where the previous one ended when that was at
most three months earlier. Its electricity bill is what its readings charged
for energy (their old price × m³), so every bill keeps its value; the old
history's dates come out exactly as the old app wrote them. If a period typed
in this app before the change used other dates, correct them on the Leituras
screen; if its "preço do kWh" was not really a price per m³, type the real
electricity bill there and the unpaid bills follow.
- The Pix QR code is a static BR Code (Banco Central EMV format with CRC16)
  carrying the bill amount; it needs the Pix key, the beneficiary name and city.
