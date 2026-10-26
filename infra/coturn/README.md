# Coturn prepared for a VPS

**Status: package prepared; not deployed or connected to the game** (PR #227 by
aaronariasperez, merged into `main`). It does not provision resources, change
DNS, or modify Firebase. The operator can deploy and validate it using the
[Oracle guide](ORACLE.md). Enabling it in the game requires the separate
integration and validation described below.

## What's included

- Coturn `4.18.0-r0`, with UDP/TCP 3478 and UDP relay ports 49160–49559. Linux host networking.
- Node 24 credential API and Firebase Admin `14.5.0`, with lockfile.
- Caddy `2.11.7` for API HTTPS; certificates renew automatically.
- Configuration and 256-bit secret generator; private files are Git-ignored.
  No production secret is generated or published now.
- Temporary HMAC credentials; ID-token verification for the existing
  `pokesurvivor-free` project; a closed pilot using an allowlist of UIDs.
- Allocation, rate, memory, and log-rotation limits. Private destinations,
  loopback, provider metadata, and IPv6 destinations are blocked. IPv4 only initially.

Coturn relays data between browsers when they cannot connect directly. The API
only issues credentials; it does not receive game state. Firebase continues to
handle signaling as before. There is no need to enable Identity Platform, create
Cloud Functions, enable additional Firestore features, or use a service-account key.

## Before deployment

With the owner, choose a dedicated Linux VPS (or one without services using
ports 80, 443, 3478, 5349, or 8088) with a stable public IPv4. Install Docker
Engine and Compose v2 using the provider's/Docker's official instructions, and
keep the system clock synchronized. Membership in the Docker group is equivalent
to host administrator privileges.

Create two A records: `turn.<domain>` and `ice.<domain>`, both pointing to the
public IPv4. Use direct DNS, **without Cloudflare's HTTP proxy**, for both in
this configuration. Do not publish AAAA records yet. Check any CAA restrictions.

No size or provider has been selected: estimates are needed for concurrency,
the share of games using TURN, and included transfer. The quotas below are pilot
values, not a capacity promise or monthly spending limit.

### Provider and VPS firewall ports

| Incoming traffic | Source | Purpose |
|---|---|---|
| SSH configured on the VPS | Administration IP/network only | Administration |
| TCP 80 and 443 | Internet | API HTTPS and ACME issue/renewal |
| UDP and TCP 3478 | Internet | Client → coturn |
| UDP 49160–49559 | Internet | Relay ports; honor any range changes |
| TCP 5349 | Internet, only when `tls` is enabled | Optional TURN over TLS |
| TCP 8088 | **Never open** | Internal API bound to 127.0.0.1 |

Outbound traffic must allow DNS, HTTPS to Google/ACME, and UDP to other players'
public ports, not just the local 49160–49559 range. Preserve established return
traffic. Do not apply firewall rules that cut off the current SSH session.
Provider-dependent or destructive firewall commands are not provided.

## Prepare the files on Linux

Copy this directory to the VPS. Run as the deployment user, not root:

```sh
cd infra/coturn
cp settings.example.json settings.json
# Edit settings.json before continuing.
python3 prepare.py --check
python3 prepare.py
docker compose config --quiet
docker compose pull
docker compose build credentials
```

Fields to change:

- `turnHost`, `apiHost`, `acmeEmail`: actual hostnames and operator email.
- `publicIp`: stable public IPv4.
- `localIp`: interface address, verified with `ip -4 address`. On a VPS with a
  directly assigned public IP, it matches `publicIp`. On Oracle/GCP behind NAT,
  it is usually private and `external-ip=PUBLIC/PRIVATE` is generated. NAT must
  preserve ports.
- `allowedUids`: UIDs of Firebase accounts selected for the pilot. With an empty
  list, nobody gets credentials, even with a valid session.
- `origins`: exact authorized HTTPS origins, without a trailing slash or wildcards.
- `allowAllAuthenticated`: keep `false` for the pilot. `true` allows every
  non-anonymous account in the project and increases abuse exposure.

The generator rejects example placeholders, insecure configurations, and
inconsistent ranges. It preserves the secret when run again. Coturn and API
containers use the operator's UID/GID; secret files have mode 0600. Do not copy
`.env` from Windows: regenerate it on Linux. Do not share `runtime/`, `certs/`,
or `settings.json` in a PR. Keep backups only in private storage.

## Start the pilot

```sh
docker compose up -d
docker compose ps
docker compose logs --tail=80 coturn credentials https
curl --fail http://127.0.0.1:8088/healthz
```

Caddy startup requests a real public certificate for `apiHost`. The health
check only verifies that the API responds; **it does not test the relay**.
Check that coturn reports no unknown options, permission errors, or missing
listening addresses. `ss -lntup` must confirm that port 8088 listens only on
loopback and that no administration interfaces are exposed.

The API accepts `POST https://ice.<domain>/v1/ice`, with no body, and these headers:

```text
Origin: https://pokesurvivor.com
Authorization: Bearer <pilot account ID token>
```

It returns `expiresAt` and an `iceServers` array compatible with WebRTC. It
never returns the shared secret. Do not paste tokens or credentials into public
tickets, commands stored in shell history, or third-party websites. Origin/CORS
does not replace authentication: external clients can forge Origin, but still
need a valid token.

The SDK verifies signature, issuer, audience, and expiration. It does not check
revocation/disabled status on every request: an already-issued ID token may
remain accepted until it expires. Removing a UID from the pilot and restarting
the API prevents new credentials for that account; credentials already issued
are not revoked. The Authorization header is not logged. Coturn logs may contain
IP addresses/usernames and must be treated as private operational data.

### Real relay check (pending)

Before enabling it for everyone, test with two browsers/devices on different
networks, including a mobile connection, using pilot credentials and temporarily
setting `iceTransportPolicy: 'relay'` in a test environment. The DataChannel
must open and exchange messages in both directions. Inspect the selected ICE
pair: it must have a `relay` candidate; gathering a candidate alone does not
prove connectivity.

Test UDP and TCP separately, TLS if enabled, reconnection, two players behind
restrictive NATs, expiration/renewal, quota limits, and invalid credentials.
Then restore `iceTransportPolicy: 'all'`: direct connection remains preferred.
Record results using the Oracle guide's acceptance checklist.

## Optional TURN TLS

Caddy's HTTPS protects the API; **it does not turn UDP/TCP TURN into TURN TLS**.
The WebRTC DataChannel still uses end-to-end DTLS encryption, but networks that
require TURN over TLS need these steps:

1. Obtain a certificate for **`turnHost`** using an ACME client, preferably with
   automated DNS validation. Do not use a self-signed certificate in production.
2. Install real `certs/fullchain.pem` and `certs/privkey.pem` files, readable by
   the deployment user; set the private key to mode 0600. Do not mount symlinks
   that point outside the mounted directory.
3. Set `tls: true`, regenerate and recreate coturn and the API. Open TCP 5349.
4. Automate ACME renewal with a hook that copies both PEM files and restarts
   coturn during an agreed maintenance window. Caddy does NOT renew these external files.

The package does not provide TURN/TLS on port 443: that port belongs to API
HTTPS. If target networks also block 5349, use another IP or redesign TLS
termination before claiming support for those networks.

## Later game integration (not enabled here)

Request credentials with `G.DB.fb.auth.currentUser.getIdToken()` from the
approved endpoint before creating each RTCPeerConnection (offer and answer).
Add the returned `iceServers` to the existing STUN servers. Cache them per user
until a few minutes before `expiresAt`, clear them on sign-out, and continue with
direct STUN if the API fails. The HMAC secret must never be in public JavaScript,
Firebase client configuration, or build variables.

Credentials last 55–60 minutes by default (rounded to five-minute intervals).
A connection may outlast the broker token, but do not assume TURN credential
renewal works indefinitely: test long sessions and prepare coordinated renewal
with `setConfiguration` and an ICE restart before expiration. If the game needs
more time, `credentialTtl` can be increased up to 7200 seconds, with the
correspondingly longer lifetime of stolen credentials understood.

The game's current timeouts are short for some networks; test them in the pilot.
Do not enable the Realtime Database relay or force relay in production. This
integration needs a separate review and the owner's approval.

## Operations, limits, and shutdown

Initial values: 200 global allocations, 12 per TURN user, 1 MiB/s per
allocation, and 3 MiB/s configured global capacity (3 MiB/s × 31 days ≈ 8.4 TB,
below Oracle Always Free's 10 TB/month free egress). Coturn treats inbound and
outbound traffic separately. An allocation is not necessarily one player; a
connection may use several. Temporary usernames change by interval: do not
interpret their quota as a permanent per-Firebase-account limit.

The API limits requests to 6/UID/minute, 30/IP/minute, and 300 globally/minute,
with 32 concurrent verifications; local counters reset when the process restarts.
This is a pilot instance, not a distributed abuse-prevention system. Very low
limits can affect shared networks or retries; tune them using real data.

Monitor cumulative and daily outbound transfer, quota errors, CPU, memory, logs,
and certificate expiration using provider metrics. Rate limits do not prevent
many TB/month from being consumed. Define alerts and a shutdown procedure with
the owner before general deployment.

```sh
# Stops issuing new credentials; existing ones remain valid temporarily.
docker compose stop credentials
# Full shutdown: interrupts games using this relay.
docker compose stop
```

For changes to `settings.json`, run `python3 prepare.py` and
`docker compose up -d --force-recreate` during an agreed window; restarting
coturn interrupts allocations. API code changes also require
`docker compose build credentials`. Secret rotation must be coordinated between
coturn and the API: make a private backup, replace `runtime/auth-secret` with
32 random bytes in hexadecimal, regenerate, and recreate both services; old
credentials will stop working. Do not change the secret automatically at every startup.

To update versions, review security notes, pin the new image, and test the pilot.
The Node image uses the maintained `24-alpine` line; record the actual image
digests at deployment to support reproduction/rollback. A rollback must never
restore a version with a known vulnerability.

## Validation on this machine

```sh
node --test infra/coturn/tests/broker.test.mjs
python -m unittest discover -s infra/coturn/tests -p 'test_*.py'
```

All 8 service tests and 5 generator tests pass. They cover HMAC, expiration,
CORS, simulated authentication, the pilot allowlist, rate limits, NAT mapping,
configuration rejection, private-destination blocking, and secret preservation.
The official SDK was loaded and invalid-token rejection checked without a
service account. The lockfile was installed; `npm audit` reported zero
vulnerabilities during preparation.

**Docker is not installed here:** `docker compose config`, images, real coturn,
ACME, real ID-token verification, and WebRTC/NAT testing have not been run. No
desktop control was used. The operational review above is required before
considering this validated for production. No game files are changed, so there
is no need to regenerate the bundle or add a player changelog entry.

## Official references

- [Coturn: official image and host networking](https://github.com/coturn/coturn/blob/master/docker/coturn/README.md)
- [Docker release 4.18.0-r0](https://github.com/coturn/coturn/releases/tag/docker/4.18.0-r0)
- [Pinned configuration options](https://github.com/coturn/coturn/blob/docker/4.18.0-r0/docker/coturn/turnserver.conf)
- [Firebase: verify ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Caddy: automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Docker: host networking](https://docs.docker.com/engine/network/drivers/host/)
