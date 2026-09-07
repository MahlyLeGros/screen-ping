# Contributing

Thanks for helping with Screen Ping.

## Before you send a change

- Do **not** commit secrets: `.env`, `deploy/deploy.config.ps1`, passwords, API keys, SMTP credentials.
- Do **not** commit real emails, usernames, avatars, or database dumps. Tests should use fake values such as `user-a` or `you@example.com`.
- Keep deploy examples as placeholders (`YOUR_VPS_HOST`, `YOUR_VPS_USER`).

## Local setup

See the root `README.md`. Typical flow:

1. `setup-server.bat` then `start-local.bat`
2. `cd web && npm install && npm run dev`
3. `cd desktop && npm install && npm run dev`

## Tests

```bash
cd server
.venv\Scripts\python -m pytest
```

```bash
cd web
npm test
```
