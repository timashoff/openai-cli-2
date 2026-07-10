---
name: verify
description: E2E-verify openai-cli changes — local gateway harness + driving the real CLI via expect/pty
---

# Verify openai-cli / gateway changes

## Gateway (HTTPS API surface)
- Self-signed cert (node fetch requires a SAN, CN alone fails):
  `openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 2 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"`
- Boot: `GW_PORT=8790 GW_DB=<tmp>/auth.db GW_EMAIL_DEV=true GW_TLS_CERT=cert.pem GW_TLS_KEY=key.pem node gateway/server.mjs`
- `GW_EMAIL_DEV=true` prints every rendered email (login/reset codes) to stdout — harvest codes with grep on the log.
- Create users headlessly via `node --input-type=module -e` + gateway repos (`admin.mjs` needs a TTY for its hidden prompt).
- Rate limiters are in-memory: 10/15min per IP AND a shared `'global'` key per endpoint group — budget test calls per boot; restart the server to reset windows.
- curl: `--cacert cert.pem`; the node CLI: `NODE_EXTRA_CA_CERTS=cert.pem`.
- sqlite is WAL — a second process can stage DB state (e.g. `UPDATE action_codes SET expires_at = <past>`) while the server runs.

## CLI (terminal surface)
- One-shot system commands (`ai login|logout|whoami|reset`) are interactive → drive with `expect(1)`; piped stdin (no TTY) triggers one-shot chat mode, never the REPL.
- Isolate from the real user config: `HOME=<tmp>` plus `OPENAI_CLI_GATEWAY_URL=https://127.0.0.1:8790`.
- The REPL needs a pty: `script -q /dev/null node bin/app.js` or expect.

## Gotchas
- No test infra by owner's choice ("tests only when stable for production") — verification is always a live drive.
- Flows worth re-driving after auth changes: login → verify → whoami → logout; request-reset → reset (cooldown, attempt-cap burn, TTL expiry, session revocation, old/new password logins).
