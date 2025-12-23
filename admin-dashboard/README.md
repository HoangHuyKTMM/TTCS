# Admin Dashboard (local)

This admin dashboard is a minimal, local scaffold to manage content for the Reader mobile app.
It provides:
- A simple REST API (Express) to store books and chapters in a JSON file.
- A lightweight React + Vite frontend to create books and add chapters.

This is intentionally minimal so you can run locally and adapt it to your production backend.

## Structure

- server/: Node + Express API
- frontend/: Vite + React admin UI

## Run (PowerShell)

# From project root `admin-dashboard/server`
npm install
node index.js

# From `admin-dashboard/frontend`
npm install
npm run dev

The frontend expects the server at http://localhost:4000 by default.


## Endpoints (server)
- GET /books
- POST /books { title, author, description }
- GET /books/:id
- POST /books/:id/chapters { title, content }

MySQL support
----------------
If you prefer to use MySQL instead of the default `data.json` file, follow these steps:

1. Create a database and run the schema:

	 - Create database:

		 ```sql
		 CREATE DATABASE reader_admin CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
		 ```

	 - Run the schema file located at `admin-dashboard/server/schema.sql` (it includes sample seed rows):

		 ```powershell
		 mysql -u root -p reader_admin < e:\TTCS\Appdoctruyen\Reader_app\admin-dashboard\server\schema.sql
		 ```

2. Copy `.env.example` to `.env` in `admin-dashboard/server` and fill in your DB credentials. Set `USE_MYSQL=true`.

3. Install server dependencies and start server (from `admin-dashboard/server`):

	 ```powershell
	 npm install
	 node index.js
	 ```

When `USE_MYSQL=true`, the server will use MySQL for books & chapters. If not set or false, it will continue using `data.json` as before.

Admin creation helper
---------------------
To create an initial admin user (so you can log in to the admin UI), use the helper script in `server/scripts/create_admin.js`:

```powershell
cd e:\TTCS\Appdoctruyen\Reader_app\admin-dashboard\server
node scripts/create_admin.js admin@example.com yourPassword "Admin Name"
```

The script will hash the password and insert a user into your `users` table using the project's existing MySQL helper. Ensure your `.env` is configured and the DB is reachable before running.

Web admin pages
----------------
The frontend serves two standalone pages useful for admin onboarding:

- `/login.html` — admin login page. On success it stores the JWT in `localStorage` key `admin_token` and redirects to the dashboard.
- `/register.html` — admin registration page. It requires the admin secret (see `.env` variable `ADMIN_REG_SECRET`) to create an admin user. On success it automatically logs in and redirects to the dashboard.

Make sure to set `ADMIN_REG_SECRET` in `admin-dashboard/server/.env` before using `/register.html`.

Frontend login page
-------------------
The admin frontend includes a standalone `login.html` at the project root of the frontend. Open it in the browser (e.g. http://localhost:5173/login.html) to sign in. On success it stores the JWT in localStorage as `admin_token`.


## Notes
- Data is stored in `server/data.json`.
- For production, replace with a real database and authentication.
