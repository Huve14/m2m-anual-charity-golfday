# M2M Annual Charity Golf Day

Full-stack registration and booking system for the M2M Annual Charity Golf Day.

## Stack

- Backend: FastAPI, SQLAlchemy, Alembic, Pydantic v2, Celery
- Frontend: React 18, Vite, TypeScript, Tailwind CSS, TanStack Query
- Platform: Supabase Postgres, Auth, Storage, Realtime
- Integrations: SendGrid, Twilio WhatsApp, WeasyPrint, openpyxl

## Layout

- `backend/` Python API and workers
- `frontend/` React SPA
- `supabase/` database migrations and local config
- `docker-compose.yml` local services

## Local development

1. Copy `.env.example` to `.env` and fill in any real service secrets.
2. Start local infrastructure:

   ```bash
   docker compose up -d
   ```

3. Install backend dependencies:

   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate
   python -m pip install -e ".[dev]"
   ```

4. Install frontend dependencies:

   ```bash
   cd frontend
   npm install
   ```

5. Run the API from `backend/`:

   ```bash
   uvicorn app.main:app --reload --port 8000
   ```

6. Run the web app from `frontend/`:

   ```bash
   npm run dev
   ```

The API health check is available at `http://localhost:8000/api/health`.
The frontend runs at `http://localhost:5173`.

## Validation

Cheapest useful checks for this scaffold:

```bash
(cd backend && python -c "from app.main import app; print(app.title)")
(cd frontend && npm run build)
python - <<'PY'
from pathlib import Path
sql = Path("supabase/migrations/0001_init.sql").read_text()
tables = [line for line in sql.splitlines() if line.startswith("create table if not exists public.")]
rls = [line for line in sql.splitlines() if line.startswith("alter table public.") and "enable row level security" in line]
assert len(tables) == len(rls), f"{len(tables)} tables but {len(rls)} RLS statements"
print(f"{len(tables)} public tables have RLS enabled")
PY
```

## Notes

This repository is scaffolded from the PRD and architecture brief. The first pass focuses on the core application structure and configuration; business workflows, approval logic, draw management, and event-day tooling will be filled in next.
