# ScottShelf

ScottShelf is a local manga, manhwa, and manhua reader with browsing, chapter reading, and local bookmarks.

## Run

Install dependencies separately from the terminal you plan to use. If you are running from Windows PowerShell, run these commands in PowerShell so native packages like Rollup and esbuild install for Windows.

```bash
cd backend
npm install
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

The React app proxies `/api` requests to the local Express API on `http://localhost:4174`.

The root folder also has convenience scripts after both folders have been installed:

```bash
npm run dev
npm run typecheck
npm run build
```

## Accounts

The API uses MySQL for accounts. The connection settings live in `backend/.env`. Update them if your MySQL server is not available at `127.0.0.1:3306` with `root` and no password.

On startup, the API creates the `mangass` database, the `users` table, and the default admin account:

- Username: `Scott`
- Password: `password`

## Sources

Enabled sources:

- MangaDex through its public API.
- Flame Comics through its public server-rendered pages.
- Comix.to through its public app data and image endpoints.

Scraping support is intentionally isolated behind `server/sources/types.ts` and `server/sources/scraperTemplate.ts` so each website can be implemented as a separate adapter.

Only add adapters for sources you have permission to access and whose terms allow automated access. Prefer official APIs or licensed catalogs when available.
