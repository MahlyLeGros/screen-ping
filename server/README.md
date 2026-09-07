# Server (FastAPI)

API + Socket.IO + static web (`SERVE_SPA=true`).

```
server/
  app/           Application code (routes, auth, realtime…)
  run.py         Uvicorn entry
  run-local.bat  Local start on :8000
  uploads/       User media (local)
  requirements.txt
```

First time from repo root: `setup-server.bat`  
Then: `run-local.bat` or root `start-local.bat`.
