# Deployment, validation, and recovery on Oracle Cloud

This document supplements the [README](README.md), which contains setup commands,
ports, and limits. The server is not integrated into the game: deploying this
directory does not change player connections.

## 1. Machine and network

Initial lab profile: Ubuntu ARM64 on Ampere A1 Flex, 2 OCPUs, 6 GB RAM, and a
50 GB boot volume. Verify Always Free eligibility and the account's remaining
quotas before creating resources. Do not confuse temporary trial credits with
permanent free resources. Do not use images with additional license requirements.
This profile is not a capacity test.

Use the account's primary region. No region guarantees that a free instance will
remain available: Oracle may reclaim inactive instances, and capacity may not be
available to restart or recreate them. Review the
[current terms](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

- Create a VCN with a public subnet and a `0.0.0.0/0` route to an Internet Gateway.
- Attach a public IPv4 address, preferably reserved so it can be reassigned in
  the same region. This design does not need a load balancer or NAT Gateway.
- Apply the README ports in both OCI Security Lists/NSGs and the Ubuntu firewall.
  Keep the rules required for administration and return traffic.
- `publicIp` is the OCI public IP; `localIp` is the VNIC private IPv4 address
  shown by `ip -4 address`. Do not bind coturn to the NAT public IP.
- Create the two DNS A records and verify them before starting Caddy.
- Install Python 3, Git, and [Docker Engine with Compose v2](https://docs.docker.com/engine/install/ubuntu/).
  Check `docker version` and `docker compose version` as the deployment user.

The coturn, Node, and Caddy images must be available for the selected
architecture. Actual ARM64 image validation remains pending until deployment
on OCI. If a download fails, stop deployment and review the version; do not
automatically replace it with `latest` or force x86 emulation.

## 2. Deploy a specific revision

Clone the official repository and record the SHA to be tested:

```sh
git clone --depth 1 https://github.com/JPTER78/pokesurvivor.git
cd pokesurvivor
git rev-parse HEAD
cd infra/coturn
```

Do not automatically update a production branch. Follow "Prepare the files on
Linux" and "Start the pilot" in the README. Keep `allowAllAuthenticated: false`,
add the pilot account UIDs, and specify the exact HTTPS origin of the test environment.

The public game does not request these credentials yet. For a WebRTC test, the
test client must obtain an ID token from the existing project, call `POST /v1/ice`,
and use the returned `iceServers` when creating both peers. Never put the HMAC
secret in the client or copy tokens into public tools.

## 3. Acceptance checklist before production

Complete this table during deployment review. Publish only summarized results;
keep tokens, player IP addresses, and detailed logs private.

| Check | Result / date / revision |
|---|---|
| SHA, architecture, Docker/Compose versions, and image digests recorded | Pending |
| `docker compose config --quiet`, pull, build, and startup succeed | Pending |
| API healthy, HTTPS valid, and port 8088 accessible only from loopback | Pending |
| Real pilot Firebase token accepted; invalid, anonymous, and excluded UIDs rejected | Pending |
| Two different networks, including mobile: relay candidate selected and data exchanged both ways | Pending |
| TURN over UDP and TCP tested separately; TLS tested if enabled | Pending |
| Long run exceeds initial TTL with renewal/reconnection verified | Pending |
| Service restart, network loss, quotas, and unavailable API tested | Pending |
| Traffic, latency, CPU, and memory measured at target concurrency | Pending |
| Transfer and certificate alerts configured; owner assigned | Pending |
| Private backup and recovery on a clean machine tested | Pending |
| Game integration reviewed: direct connection preferred, ICE renewal, failure behavior | Pending |

A successful HTTP response or an isolated relay candidate does not validate the
transport. If direct access fails, falling back to STUN when the API is unavailable
does not guarantee a connection: the integration must report the failure and
allow a retry. Networks that allow only TLS on port 443 need a different design;
this version uses 443 for the API.

Do not expand the pilot allowlist until relevant tests are complete and the
client integration is approved. Always Free capacity and availability are not
guaranteed. Budget alerts do not automatically stop spending.

## 4. Backup and recovery

Keep an encrypted private backup outside the VPS of `settings.json`,
`runtime/auth-secret`, TURN certificates if used, and their renewal instructions.
Also record the SHA, image digests, DNS, network rules, and OCI resource inventory.
To avoid repeatedly reissuing certificates, securely back up the `caddy_data`
and `caddy_config` volumes with Caddy stopped, and restore them with permissions
preserved. They contain private keys. Do not commit these backups.

If the server goes down:

1. Distinguish API, coturn, network, and instance failures using an external
   HTTPS check and an authenticated TURN test. Do not generate artificial load.
2. If OCI only stopped the machine, try to restart it; preserve the disk and configuration.
3. If it must be replaced, create a compatible machine and repeat Steps 1 and 2.
   Do not delete the old disk until backups are verified. Check quotas because
   retained disks and overlapping instances also consume resources.
4. Reassign the reserved IP if it is still available in that region, following
   the [OCI documentation](https://docs.oracle.com/en-us/iaas/Content/Network/Tasks/managingpublicIPs.htm).
   If the IP changes, update both DNS records and `publicIp`. Always update
   `localIp` to match the new VNIC. A 300-second DNS TTL helps but cannot guarantee
   that all clients immediately discard cached values.
5. Restore the configuration and secret before generating files. Create
   `runtime/` with mode 0700 and `runtime/auth-secret` with mode 0600, owned by
   the deployment user. Restore certificates if `tls` is enabled. Run
   `prepare.py --check`, then `prepare.py`; validate Compose and start services
   as described in the README. Regenerate `.env` on Linux.
6. Repeat the relay test between two networks and restore pilot/general access
   only when it works. Keep an incident record and recovery time.

Coturn does not store game saves, but active allocations exist in memory: no
backup or IP reassignment can recover existing connections. Clients must
reconnect. Keeping the secret allows still-valid credentials to be used; if
compromise is suspected, rotate it and issue new credentials.

This is a reproducible manual procedure, not automatic failover or a Terraform
template. If free capacity is unavailable, wait or use an operator-approved
alternative VPS. Recovery time cannot be guaranteed while capacity is
unavailable; a paid deployment requires an explicit decision by the owner.
