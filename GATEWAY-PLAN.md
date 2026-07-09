# GATEWAY PLAN (ТЗ) — openai-cli through own US VPS, no VPN

## ▶ AUTH v2 (2026-07-09) — email+password sessions replace the static token — BUILT, DEPLOYED (dual-auth), awaiting owner login

Static `GW_TOKENS` was rejected (public repo must not leak; a token is losable/untraceable). Replaced with real
**email + password → opaque 90-day server-revocable session** auth on the gateway. Full plan: `~/.claude/plans/lucky-exploring-crane.md`.
- **DONE + committed** (`f92c986`, branch `feature/gateway-auth`): zero-dep stdlib gateway (`gateway/`): `/auth/login`
  + `/auth/logout`, session guard replacing the static check, `node:sqlite` users/sessions store (sha256-at-rest,
  no rotation → multi-process-safe), `admin.mjs` CLI (adduser/passwd/revoke/list), hsk kit lifted verbatim
  (scrypt/rate-limit/errors). Client: `ai login <url>` / `ai logout` (headless + REPL, hidden password prompt),
  session → existing `[gateway] token` slot, `401 → "Run: ai login"`. Validated: gateway auth 10/10, storage 14/14,
  client 401 path, boot-test on the VPS's Node 22.23.
- **DEPLOYED dual-auth 2026-07-09** to `~/gateway/` (old server backed up `server.mjs.bak-static`; `gw.env` +GW_DB
  +GW_SESSION_TTL_DAYS, GW_TOKENS KEPT for the window; `auth.db` chmod 600). Verified: current client uninterrupted
  (`ai cc` streams via the static token), `/auth/login` live over real TLS (401 for wrong creds).
- **OWNER TO DO:** (1) `! bash ~/gwadduser.sh` → pick email+password (creates the account on the VPS). (2) `ai login
  https://gw.timashoff.com:8443` → email+password → `ai cc` should stream via the session. (3) tell the agent to
  cut over → remove GW_TOKENS + restart (session-only) → then delete `~/gateway-new` + `server.mjs.bak-static`.
- **Known limitation:** any 401 on the gateway path prints "Run: ai login" — correct for session expiry; if the
  gateway's own provider key were invalid it would also say this (rare; owner controls the key).

**Date:** 2026-07-06 · **Author:** working session · **Status: ✅ GOAL MET 2026-07-08 — `ai cc` works from China with Clash fully OFF** (deepseek direct 1.7s + gpt-5.4-nano via gateway 7.5s). Root cause was the owner's own **ufw allowlist** on the VPS (8443 never allowed; NOT GFW, NOT the IP, NOT DNS) — fixed with `ufw allow 8443/tcp`, verified check-host 7/7 nodes OPEN worldwide + owner's end-to-end run. **Remaining:** CLI rework COMMITTED (e57b2b5, dead code swept); anthropic ON HOLD — owner's API credits expired (12-month expiry, bought 2025-07; re-fund or re-point doc/gg); **certs CLOSED 2026-07-09**: gateway serves the Porkbun-maintained auto-renewing wildcard `*.timashoff.com` (valid to Sep 22, Porkbun re-issues it themselves); `~/gateway/fetch-cert.sh` on the VPS re-fetches the bundle weekly (cron Mon 04:07, log `fetch-cert.log`, restarts gw only on change; Porkbun keys in `~/gateway/porkbun.env` chmod 600); acme.sh cron + gw cert RETIRED. No manual cert work ever again. CF & clean-VPS tracks = moot.

## ⚠ DEVIATION (2026-07-07 evening) — Cloudflare vetoed by owner; DECISION PENDING

Preflight ran first (3 parallel agents, all live-verified):
- **VPS healthy:** gw.service active, node on `*:8443`, journal clean, self-probe 401. LE cert (CN=gw.timashoff.com)
  valid to **Oct 5 2026**. TCP 443 held by another process (presumed x-ui) → CF would have needed the port-rewrite.
  `gw.env` still has NO `ANTHROPIC_API_KEY` (names present: GW_PORT, GW_TOKENS, OPENAI_API_KEY, GW_TLS_CERT/KEY).
- **DNS census (full Porkbun zone, verified via DoH — Clash fake-ip hijacks even `dig @1.1.1.1`):** only `app` and
  `gw` → 154.38.179.248; apex A (52.33.207.7 / 44.230.85.241) + wildcard `*.timashoff.com` CNAME → uixie.porkbun.com
  are Porkbun parking/URL-forwarding; MX fwd1/fwd2.porkbun.com + SPF TXT = Porkbun email forwarding (it SURVIVES
  foreign NS if MX+SPF are copied — kb.porkbun.com article 47); stale `_acme-challenge.gw` TXT; no DMARC/DKIM.
- **CF facts (live docs 2026-07-07):** Origin Rules port-override IS on Free (10 rules); 8443 IS default-proxied;
  Full (strict) OK with our LE cert; token perms would be Zone>DNS/Origin Rules/Zone Settings/SSL Edit. So CF was
  FEASIBLE — but its China verdict stayed "best-effort, overseas PoPs, intermittent throttling of shared edge IPs".

**Owner vetoed CF:** unreliable in RF (RKN throttling since 2024, ECH incident) and not trusted from CN. Additional
real cons surfaced by the census: NS migration moves the WHOLE zone (mail forwarding, parking) for one subdomain.
Rejection recorded as a legitimate measured result.

**Owner's counter-question "why not a full app-server on the VPS":** answered — server richness is ORTHOGONAL to
reachability: whatever kills the CLI→gateway hop acts at the DNS/TCP/TLS layer, before a single protocol byte is
read, so a richer server protocol cannot fix it. Full app-server = right long-term direction (existing Phase 5/6:
sessions, Responses API, multi-client message API; current server.mjs is the seed — auth/key-custody/streaming
already there), but a separate decision from THIS blocker.

**⚠ SECOND DEVIATION (same evening) — owner challenged "the IP is flagged", and he is right:** that claim is the
PREVIOUS session's inference (the "⇒" in the superseded plan below), NOT a measurement — and this session repeated
it as fact. Actually measured: Clash OFF → `ai cc` 30s Connection error; Clash ON → works; VPS-side healthy. That
does NOT isolate the cause. **Counter-evidence already in hand:** the owner's Clash tunnels run over Hysteria
UDP443 on THE SAME IP and work from China — a genuinely flagged IP would normally be dead wholesale, VPN included.
**Untested alternative:** DNS/TUN leftovers — this session's census measured that Clash fake-ip hijacks ALL port-53
traffic (even `dig @1.1.1.1` returned 198.18.x.x); the original Clash-OFF test never checked what gw.timashoff.com
resolved to at that moment (a stale fake-ip / poisoned answer → connect to a dead address → the exact same timeout).

**✔ EXPERIMENT RAN (owner, 2026-07-07 23:53 CST, Clash fully off; gwprobe.sh) + external probes (check-host.net,
2026-07-08) — ROOT CAUSE FOUND. It is NOT the GFW, NOT China, NOT the IP, NOT DNS:**
- Owner's line, Clash off: DNS resolves 154.38.179.248 correctly (system + @223.5.5.5; no fake-ip leftovers);
  raw TCP to 443/30010/22446 all connect; fresh SSH handshake OK; ONLY 8443 times out at SYN (before any TLS);
  `ai cc` deepseek-direct half streamed fine (local network healthy).
- External vantage (check-host.net): 8443 dead from all valid nodes (CY/IN/PL/SE/UA/US; the lone "ua3 2.6ms
  success" is a transparent-proxy artifact — physically impossible RTT to a US box, discarded). A FRESH test
  listener on 20443 equally dead externally. Meanwhile 22446, 80, 30000, 30011 are OPEN from every node tested.
- ⇒ **The gateway was NEVER reachable from outside.** All prior "VERIFIED" runs were same-host vantage: "from
  the VPS" and "from the Mac via Clash" both exit on the VPS itself. (LESSON: Clash-path tests prove nothing
  about this box's external reachability.)
- Open-port pattern = {22446, 80, 443, 30000–30011, UDP443} = exactly the ports that existed when the VPN box
  was set up; everything bound AFTER (8443 gateway, 20443 throwaway) is dropped → an inbound ALLOWLIST snapshot.
  Host shows NO firewall machinery on disk (nftables.service disabled + stock empty config, no ufw/firewalld/
  fail2ban processes, no /etc/iptables, no rc.local) → rules are either runtime kernel state invisible without
  root (classic one-click x-ui/VPN-script firewall) or at the provider edge (Contabo panel). One sudo look discriminates.

**FIX (one owner sudo session; agent orchestrates the rest):**
1. CONFIRMED (2026-07-08, no-root recon + owner's own memory "возможно я настраивал фаервол"): it IS host-side
   **ufw** — ufw.service enabled+active, /etc/ufw/ufw.conf ENABLED=yes, user.rules last edited 2026-04-09 by the
   owner. Prior session's "no active ufw seen" was a no-root artifact (ufw has no daemon). Contabo panel NOT involved.
2. Owner runs ONE command in this session:
   `! ssh -t contabo-usa-east "sudo ufw status numbered; sudo ufw allow 8443/tcp comment 'ai gateway'; sudo ufw status | grep 8443"`
   — shows the allowlist, adds the rule (takes effect instantly). NEVER touch the VPN inbounds/configs themselves.
3. Agent re-verifies externally (check-host 8443 open worldwide) → owner: itdog.cn tcping 8443 (Clash stays ON)
   → final 30-sec Clash-off `ai cc привет` as the end-to-end proof.
4. Persistence: handled by ufw natively — the allow rule survives reboots. Nothing else to do.

**✅ VERIFIED END-TO-END (2026-07-08 ~00:4x CST):** owner ran `sudo ufw allow 8443/tcp` (rule added v4+v6) →
external re-probe: check-host **7/7 nodes OPEN** (CA/CH/HU/NL/PL/PL/US) → owner, Clash fully OFF: `ai cc привет`
→ **both models streamed**: deepseek-v4-flash direct (1.7s) + gpt-5.4-nano through the gateway (7.5s). The
project's goal #1 (no VPN / no Clash) is MET. itdog check unnecessary.

**Plan B (MOOT — the "block" turned out to be a local/provider port allowlist, not censorship; kept for
reference only): move the gateway to a clean-IP VPS (gateway-only, never VPN).**
- No DNS drama: ONE A-record change (`gw` → new IP); NS/mail/parking untouched (vs CF's full-zone NS migration).
- LE cert moves as-is (per-hostname, not per-IP); `server.mjs` + `gw.env` + systemd unit copy over in minutes.
- Fresh box comes with root → gateway can bind **443** directly (systemd `AmbientCapabilities=CAP_NET_BIND_SERVICE`);
  on the current box 443 is taken by x-ui. Port 443 on a clean IP = most GFW-boring possible traffic.
- Zero-downtime test BEFORE any DNS change: deploy, then owner (Clash OFF) runs
  `curl --resolve gw.timashoff.com:443:<NEW_IP> https://gw.timashoff.com/openai/v1/models -H "Authorization: Bearer <token>"`
  (valid cert, DNS untouched). 401/200 = IP is clean → flip the A-record + drop `:8443` from config.toml.
- Candidates: hourly-billed box for IP-roulette testing (Vultr ~$2.5–6/mo), RackNerd promo (~$11–25/yr),
  Oracle Always-Free tier ($0), BWG CN2-GIA (~$50–90/yr premium China routes). Honest risk: "China-popular" cheap
  ranges are partly pre-flagged (mass proxy abuse) → the ONLY reliable predictor is testing the specific IP from
  the owner's line; hourly billing makes that cheap. Evening cross-border congestion on direct US routes is
  possible but usually tolerable for token streams; IP cleanliness > geography (US-west also keeps gateway→OpenAI fast).
- Isolation bonus: VPN box never touched; the clean box is the right future home for the Phase 5/6 app-server.

**Waiting on owner:** ONE command — see FIX step 2 (`sudo ufw allow 8443/tcp ...`) — then the agent re-verifies
externally; final proof = itdog click + 30-sec Clash-off `ai cc`. CF and clean-VPS tracks are MOOT.
**Pending (updated 2026-07-08):** CLI rework COMMITTED (`e57b2b5`); ANTHROPIC on hold — owner's API credits
expired (Anthropic prepaid credits die 12 months after purchase; his 2025-07 $5 just lapsed); all four
claude-bound commands (doc/gg/kg/wtf) re-pointed to deepseek in commands.toml 2026-07-08, verified live;
`~/key.sh` stays ready if he ever re-funds; cert story DONE 2026-07-09:
gateway switched to Porkbun's auto-renewing wildcard (SAN `*.timashoff.com` + apex); weekly re-fetch cron on
the VPS (`~/gateway/fetch-cert.sh`, Mon 04:07, restart-on-change); acme.sh cron uninstalled, gw cert removed
from its management, leftovers deleted; verified end-to-end from the Mac (s_client shows the wildcard; live
`gg` streamed through the gateway). Porkbun API keys (global API access enabled by owner) live ONLY in
`~/gateway/porkbun.env` (600); local pkey.sh deleted after use.

## ▶ PREVIOUS PLAN (superseded unless owner picks CF) — China reachability via Cloudflare

**State:** the gateway is BUILT, DEPLOYED, and WORKING end-to-end **except** it is not reachable from China
with the VPN off. All claims below are measured — do NOT re-litigate them.

**The blocker (measured 2026-07-07):** `ai cc` with Clash OFF fails on the openai model with `Connection error`
(30s timeout). This is the **CLI→gateway** hop, NOT OpenAI:
- config confirmed: openai `baseURL = https://gw.timashoff.com:8443/openai/v1` (routes to the gateway, not direct).
- gateway→OpenAI is healthy: from the VPS, `api.openai.com` → 401 (0.2s); full path VPS→gateway→OpenAI → 200 (0.8s).
- Clash ON → CLI reaches the gateway fine (openai streams "Добрый вечер", `ai cc` = 2/2). Clash OFF → times out.
- ⇒ GFW blocks the plain HTTPS endpoint on 8443 at the VPS IP (154.38.179.248 is a known VPN node; Hysteria
  UDP443 / Reality TCP30010 evade DPI, a plain gateway does not). It is NOT a 403 and NOT OpenAI restricting China.

**Fix — Cloudflare (free plan is enough, no cost):** hide the gateway behind CF so China hits CF's clean edge
(443) and the flagged VPS IP is hidden. Steps:
1. Add `timashoff.com` to a Cloudflare account (free); change its nameservers at **Porkbun** → the CF ones.
   Re-create records in CF; keep VPN records (`app.timashoff.com` Hysteria, Reality) **DNS-only (grey)** so the
   VPN is untouched. `gw.timashoff.com` → **proxied (orange)** → 154.38.179.248.
2. Origin gateway is on **8443**, CF connects to origin on 443 by default → add a free **Origin Rule** rewriting
   `gw.timashoff.com` origin port to **8443**. SSL mode **Full (strict)** (origin has a valid LE cert).
   (Alt: **Cloudflare Tunnel** `cloudflared` on the VPS — outbound, no origin rule, fully hides IP; also free.)
3. Edit `~/.openai-cli/config.toml`: change both baseURLs from `https://gw.timashoff.com:8443/...` →
   `https://gw.timashoff.com/...` (CF edge is 443; drop `:8443`).
4. **TEST from China, Clash OFF:** `curl https://gw.timashoff.com/openai/v1/models -H "Authorization: Bearer <token>"`
   → 200 = goal met; then `ai cc привет`.
5. **Honest caveat:** free CF from China is sometimes throttled by ISP/time. If it won't work from his network →
   fallback: keep Clash **running** (no global-TUN toggling); the gateway is reachable via Clash (proven).

**Access / facts the next agent needs:**
- SSH `ssh contabo-usa-east` (alias → 154.38.179.248:22446, user timashoff). Key `~/.ssh/contabo-usa-east` is
  **passphrase-protected** → owner runs `ssh-add ~/.ssh/contabo-usa-east` once so the agent's shell shares the
  agent. **NO passwordless sudo** (deploy is all non-root, user-systemd + linger).
- Gateway: `export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user status gw.service`. Files in `~/gateway/`
  (server.mjs, cert.pem, key.pem, gw.env chmod 600). Listens `*:8443`. `gateway/server.mjs` in the repo = deployed code.
- Token: NOT in git — lives in `~/.openai-cli/config.toml` (client side) and in `GW_TOKENS` inside `~/gateway/gw.env` on the VPS.
- Also pending: `ANTHROPIC_API_KEY` → `~/gateway/gw.env` + restart (for doc/gg); **commit the CLI rework**
  (uncommitted); cert auto-renew needs a Porkbun API key (currently manual DNS-01, ~60-day life).
- CLI rework is DONE + verified (proxy layer deleted, overlay = baseURL+token). Do NOT redo it.

## WORKING (2026-07-07)
Real Let's Encrypt cert issued (manual DNS-01, acme.sh on the VPS) and installed → `~/gateway/{cert,key}.pem`,
`gw.service` restarted. `ai cc привет` now streams BOTH models with **no 403 and no `-k`**: deepseek direct,
gpt-5.4-nano through the gateway. The CLI trusts the cert natively (no `NODE_EXTRA_CA_CERTS`).
- **Still open:** owner's Clash-OFF end-to-end test (the actual "no VPN" proof); put `ANTHROPIC_API_KEY` on the
  VPS (`~/gateway/gw.env`) so anthropic commands (doc/gg) work; commit the CLI rework; cert auto-renews only if
  a Porkbun API key is added later (currently manual DNS-01 → ~60-day manual renewal). Gateway token is in the
  session scratchpad + `~/.openai-cli/config.toml`.

## DEPLOYED (2026-07-07)
- Gateway `gateway/server.mjs` copied to `~/gateway/server.mjs` on `contabo-usa-east` (154.38.179.248).
- **Node 22** installed non-root at `~/node`. **No root** on the box (sudo needs a password) — everything runs
  as user `timashoff`.
- Runs as a **user systemd** service `gw.service` (`~/.config/systemd/user/gw.service`), `Restart=always`.
  **`loginctl enable-linger` succeeded WITHOUT sudo** → service survives logout + reboot + crash. (The earlier
  background-launch failures were systemd killing non-linger session processes — classic modern-Ubuntu gotcha.)
- Env `~/gateway/gw.env` (chmod 600): `GW_PORT=8443`, `GW_TOKENS=<token>`, `OPENAI_API_KEY=<owner key>`,
  `GW_TLS_CERT/KEY` → `~/gateway/{cert,key}.pem`. Token saved in the session scratchpad (`gw-token.txt`).
- **Cert is SELF-SIGNED for now** (openssl, CN=gw.timashoff.com) → clients need `-k` until the real cert lands.
- DNS `gw.timashoff.com → 154.38.179.248` live (Porkbun). Port 8443 open (no host firewall).
- VERIFIED: from the VPS AND from the Mac (via Clash) → no-token 401, with-token 200, streaming "Привет". 
- **Anthropic route:** deployed but `ANTHROPIC_API_KEY` not set yet → owner must supply it.
- **CLI REWORKED TO THE GATEWAY (2026-07-07):** the local-proxy layer is gone (`utils/providers/proxy.js`
  deleted, `undici` dep removed). The overlay now takes `baseURL` + `token` per provider (not `proxy`);
  `base.getCredential()` = token-or-env-key; availability counts a token (`configService.availableProviders`),
  so keys can live only on the gateway. `~/.openai-cli/config.toml` points openai/anthropic at
  `https://gw.timashoff.com:8443/{openai,anthropic}/v1` with the token; deepseek direct. VERIFIED: openai
  routes through the gateway → "Добрый вечер" (no 403), deepseek still direct, using `NODE_EXTRA_CA_CERTS`
  to trust the self-signed cert in-test.
- **Remaining:** real cert via acme.sh (installed on the VPS, Let's Encrypt, **manual DNS-01 issued** — owner
  must add TXT `_acme-challenge.gw.timashoff.com` at Porkbun; then `acme.sh --renew` completes + install cert +
  restart `gw.service`). Once the cert is real, the CLI drops `NODE_EXTRA_CA_CERTS` and `ai cc` works with no
  VPN. Then: Clash-OFF end-to-end test; supply `ANTHROPIC_API_KEY` to the VPS env; later automate cert renewal
  with a Porkbun API key.

## Goal (one line)
The CLI/GUI sends **only** openai/anthropic requests to the owner's **US VPS**; the VPS forwards them to
`api.openai.com` / `api.anthropic.com` with its **own** API keys and streams the answer back. **Clash / VPN is
NOT required.** DeepSeek stays direct (reachable from China).

This replaces the wrong "local Clash proxy" build (which still needed Clash running → failed the #1 goal).

---

## Verified facts (2026-07-06, checked live)
- **Deploy target:** `contabo-usa-east` = `154.38.179.248` (owner-confirmed). Same box already runs the
  **Hysteria2** node (`app.timashoff.com`, port 443) and **VLESS Reality** (`:30010`). Since Hysteria on this
  IP works from China, **this IP is already reachable from China** — the biggest reachability risk is largely
  pre-cleared.
- **DNS is on Porkbun** (`*.ns.porkbun.com`). The gateway subdomain A-record is added there.
- `app.timashoff.com` is an existing subdomain → the US box (Hysteria uses it). We will NOT reuse it; a new
  subdomain (e.g. `gw.timashoff.com`) is added for the gateway.
- Clash is currently in **fake-ip / TUN mode** (DNS returns `198.18.0.x` for everything, intercepts raw-IP
  connections too). Consequence: the "works without VPN" test can only be run by the owner with **Clash off**.
- SSH key `~/.ssh/contabo-usa-east` exists but the **ssh-agent is empty** → automated SSH is blocked until
  `ssh-add ~/.ssh/contabo-usa-east` is run (key is passphrase-protected).

## VPS inventory (CONFIRMED 2026-07-06 via SSH)
- **OS:** Ubuntu 24.04.4 LTS · **CPU:** 3 · **RAM:** 7.8 GB (7.1 free) — plenty for a tiny gateway.
- **Ports in use:** TCP **80** + TCP **443** are held by **x-ui / Xray** (`/etc/x-ui`, inbounds on 30000–30011);
  UDP **443** = **Hysteria2** (`hysteria-server.service`, `/etc/hysteria`). SSH on 22446.
- **TCP 8443 is FREE** → the gateway goes here. We do NOT touch 80/443 or the VPN stack.
- **Not installed:** node, caddy, nginx, docker (only git + python3.12). Runtime must be installed.
- **Outbound OK (premise confirmed):** from the VPS, `api.openai.com` and `api.anthropic.com` both return
  **401** (reachable, just need a key) — so this box can forward to the providers.
- **Firewall:** no active ufw seen; Contabo has no default cloud firewall — still verify 8443 is reachable
  externally during deploy (curl from the Mac with Clash OFF).

---

## Architecture
```
                         China  |  (Great Firewall)  |  USA
  ai rr  ──────────────── direct ─────────────────────────────►  api.deepseek.com      (unchanged)

  ai <openai cmd> ─┐
  ai <claude cmd> ─┤ HTTPS + Bearer <GW_TOKEN>
                   └──►  https://gw.timashoff.com  (Fastify gateway on 154.38.179.248)
                                     │  validates token, swaps in the REAL provider key
                                     ├──►  https://api.openai.com/...      (US IP → no 403)
                                     └──►  https://api.anthropic.com/...
                                     ◄──  streams SSE straight back
```
No Clash anywhere. The gateway box is US-based, so OpenAI/Anthropic see a US IP.

---

## Components

### 1. Gateway service — ZERO external dependencies (owner rule: minimal deps, no Caddy/framework)
A ~80-line script using ONLY the standard library. **No Caddy, no framework, no npm/pip packages.** Language:
- **Pure Node stdlib** (`node:http`/`node:https` + built-in `fetch`) — owner's language; needs installing the
  Node *runtime* once (`apt`), but zero libraries.
- **Pure Python stdlib** (`http.server` + `ssl` + `http.client`) — Python 3.12 is ALREADY on the box → zero
  installs at all. Downside: not the owner's language for future edits.

What it does (either language, identical behaviour):
- **Auth (mandatory):** require `Authorization: Bearer <token>` matching one of the configured gateway tokens,
  else `401`. **Without this it is an open relay → anyone drains the credits.**
- **Key injection:** replace the token with the REAL provider key from a VPS env file (openai → `Authorization`,
  anthropic → `x-api-key` + `anthropic-version`).
- **Forward + stream:** `/openai/*`→`api.openai.com`, `/anthropic/*`→`api.anthropic.com`; pass method/path/
  query/body; stream the SSE response straight back (no buffering).
- Runs under `systemd` (auto-restart); env file `chmod 600`; never logs secrets.

### 2. TLS certificate — the ONLY unavoidable external bit (because 80/443 are busy)
The gateway serves HTTPS on 8443, so it needs a cert. Two ways, owner picks:
- **(A) Real cert via `acme.sh`** — a single self-contained shell SCRIPT (not a server, no runtime deps),
  issues a real Let's Encrypt cert through **Porkbun DNS-01** and auto-renews via cron. Clients then need
  NOTHING special (standard trust) — best for Apple Shortcuts / future apps. Needs a Porkbun API key.
- **(B) Self-signed cert** (`openssl`, already present) — ZERO external anything, but every client app must be
  told to trust it (`NODE_EXTRA_CA_CERTS`), which does not survive Apple Shortcuts cleanly.
Recommendation: **(A)** if Shortcuts/multi-app matter; **(B)** if you want absolute zero-external and only the CLI.

### 3. DNS (Porkbun)
- Add `A gw.timashoff.com → 154.38.179.248`. (Owner does this in the Porkbun panel; ~2 min.)

### 4. Process management
- `systemd` unit for the Fastify gateway (auto-restart on boot/crash).
- Keys + `GW_TOKEN` in a root-owned `EnvironmentFile`, `chmod 600`. **Do NOT touch the Hysteria/VLESS configs.**

### 5. CLI side (re-melt the current proxy build — most of it is reused)
- **Reuse:** `services/config/` overlay, `getProviderConfig`, the single `createProviderInstance`, the
  `config` command, entry bootstrap.
- **Change:** in `config.toml`, per provider set `baseURL = "https://gw.timashoff.com/openai"` (+ anthropic),
  and the CLI sends the **gateway token** as its credential (keys live on the VPS). Uniform gateway auth =
  `Authorization: Bearer <GW_TOKEN>` (openai SDK sends it as the apiKey; anthropic-provider sends it explicitly).
- **Remove:** `utils/providers/proxy.js`, the `undici` dep, the dispatcher injection in both providers.
- **DeepSeek:** no `baseURL` override → stays direct to `api.deepseek.com`.
- Net CLI change is SMALLER than the current proxy diff.

---

## Security model
- Bearer token is non-negotiable (open-relay = credit theft). Rotatable (env var on the VPS).
- Real provider keys live ONLY on the VPS (`chmod 600` env, systemd `EnvironmentFile`).
- The CLI/Shortcuts carry ONE token (this also solves the old "Shortcuts have no shell env for keys" problem).
- Never log keys or the token. HTTPS end-to-end (Let's Encrypt).

## Multi-client — you do NOT need gw1..gw10
ONE gateway (`gw.timashoff.com`) serves **any number of apps**. They are told apart by their **token**, not by
a subdomain:
- openai-cli → token A · WoW-addon → token B · future app → token C — all hit the same gateway, each token
  revocable independently.
- Providers are selected by **path** (`/openai`, `/anthropic`), not by host.
- So: **one subdomain, many tokens, many provider paths.** This is exactly what the planned 2nd client (the
  WoW Classic translator addon) will reuse. Name the subdomain generically (not app-specific).

## How to verify the goal is met (owner, from China, **with Clash OFF**)
1. Turn Clash **fully off** (TUN + system proxy).
2. `curl https://gw.timashoff.com/openai/v1/models -H "Authorization: Bearer <GW_TOKEN>"` → `200` + model list
   ⇒ reachable from China with no VPN, gateway forwards, key injection works.
3. `ai <openai cmd> "..."` (via gateway) and `ai rr "..."` (deepseek direct) both work with Clash off.

## Risks & mitigations
- **China reachability:** the IP already serves Hysteria from China, so it is reachable. If the *subdomain*
  gets SNI-blocked later → swap subdomain, or front with Cloudflare (note: Cloudflare-from-China is less
  reliable, so direct A-record is the default).
- **Shared IP with the VPN node:** if GFW ever blocks `154.38.179.248`, Hysteria dies too regardless of the
  gateway — the gateway does not meaningfully add to that. To isolate, the gateway could later move to the
  Minecraft box or a fresh VPS. For now, co-locating is simplest and reuses a proven-reachable IP.
- **TCP 443 contention:** resolved by the VPS inventory above; vhost-share or 8443 fallback if needed.
- **Do not break Hysteria/VLESS:** the gateway is an additive service (own port/process/vhost); VPN configs
  are never modified.

---

## Work order
0. **VPS inventory** (owner `ssh-add`s the key so this session can SSH, or runs the command above and pastes).
1. **DNS:** add `gw.timashoff.com → 154.38.179.248` at Porkbun.
2. **Gateway:** write Fastify service + env + systemd + Caddy vhost; deploy to the VPS.
3. **Test from China with Clash OFF** (curl the gateway).
4. **CLI:** re-melt config to `baseURL` + token; drop undici/proxy; test.
5. **Commit** (`feat: VPS gateway ...`).

## Open decisions / what the owner provides
1. **Subdomain name:** ONE generic subdomain for ALL apps (per-app tokens, not per-app subdomains — see
   Multi-client). Suggest `gw.timashoff.com` or `api.timashoff.com`. (`app.` is taken by Hysteria.)
2. **Porkbun API key+secret** (domain-scoped): needed for auto-TLS via DNS-01 (80/443 are busy so no other
   ACME method works). This is the only new credential beyond the provider keys.
3. **DNS record:** `A <subdomain> → 154.38.179.248` in Porkbun (owner adds it, or Caddy/API can once it has
   the key above).
4. **Deployment:** SSH now works for this session — it can install Caddy + deploy the gateway on 8443 itself,
   or emit a step-by-step guide for the owner to run. (Gateway = Caddy-only Caddyfile for v1.)
5. **Provider keys:** owner supplies `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` to live on the VPS (env file,
   `chmod 600`), plus one or more **gateway tokens** (one per client app).
