# shellcheck shell=bash
# ============================================================================
# Peers harness — what the three-VM specs 58 to 61 share (slice 8)
# ============================================================================
# Sourced after ../e2e/helpers.sh and app-plugin-harness.sh by the specs that
# prove calls and events between agent-hosted app plugins whose agent halves
# run on **two different agents**:
#
# - the agent VM's agent (e2e-agent, enrolled as test-agent by the tier) and
#   a second agent on the visitor VM (local name e2e-agent2, enrolled as
#   peer-agent2) — ensure_second_agent enrols it once (Node.js and the
#   E2E CA are already there; lamaste-agent from the dev Feria, an
#   enrolment token, `lamaste-agent setup`, the app host helper) and leaves
#   it for the next spec; remove_second_agent (spec 61's cleanup) takes it
#   away again;
# - on_agent2 <command…>: run a harness function against the second agent
#   (it swaps the variables app-plugin-harness.sh reads — AGENT_VM,
#   AGENT_LABEL, HOST_AGENT_LABEL, the sync units — and puts them back);
# - write_peers_fixture: the fixture plugins, a provider (e2e-pdir) and a
#   consumer (e2e-pcons), each one Fastify agent half built on core's peers
#   SDK (peerSurface, peerRoute, createPeerOutbox, createPeers) and
#   identity;
# - peers_setup: everything up to two hosted, approved, identity-ready
#   plugins on their two agents (stand-in Feria, users, push windows,
#   installs, approvals, hosting, the consumer's channel), which every spec
#   starts from; peers_cleanup: what their traps run.
#
# bash 3.2 (macOS): no arrays, no associative arrays.
# ============================================================================

VISITOR_VM="${VISITOR_VM:-lamaste-visitor}"
VISITOR_IP="${VISITOR_IP:-10.13.37.3}"
AGENT2_LABEL_LOCAL="e2e-agent2"
AGENT2_LABEL="peer-agent2"
AGENT2_DIR="/root/.lamalibre/lamaste/agents/${AGENT2_LABEL_LOCAL}"

PROVIDER="e2e-pdir"
CONSUMER="e2e-pcons"
PROVIDER_SERVER="@lamalibre/${PROVIDER}-server"
PROVIDER_AGENT="@lamalibre/${PROVIDER}-agent"
CONSUMER_SERVER="@lamalibre/${CONSUMER}-server"
CONSUMER_AGENT="@lamalibre/${CONSUMER}-agent"
SCOPE_READ="${PROVIDER}:read"
SCOPE_WRITE="${PROVIDER}:write"
EVENT_TYPE="unit.changed"
SHELF_ID="e2e-peers"

# What the second agent's own cleanup restores
AGENT2_PUSH_WINDOW=""

# ---------------------------------------------------------------------------
# The second agent
# ---------------------------------------------------------------------------

visitor_exec() { multipass exec "${VISITOR_VM}" -- sudo bash -c "$1"; }

# on_agent2 <command…> — run a harness function against the visitor VM's
# agent: the variables app-plugin-harness.sh reads are swapped for the call
# and restored after it (whatever the command returns)
on_agent2() {
  local s_vm="${AGENT_VM}" s_ip="${AGENT_IP}" s_label="${AGENT_LABEL}" s_dir="${AGENT_DIR}" \
    s_config="${AGENT_CONFIG}" s_timer="${SYNC_TIMER}" s_service="${SYNC_SERVICE}" \
    s_host_label="${HOST_AGENT_LABEL}" s_status="${APPHOST_STATUS_BEFORE}" rc=0
  AGENT_VM="${VISITOR_VM}"
  AGENT_IP="${VISITOR_IP}"
  AGENT_LABEL="${AGENT2_LABEL_LOCAL}"
  AGENT_DIR="${AGENT2_DIR}"
  AGENT_CONFIG="${AGENT2_DIR}/config.json"
  SYNC_TIMER="lamalibre-lamaste-sync-${AGENT2_LABEL_LOCAL}.timer"
  SYNC_SERVICE="lamalibre-lamaste-sync-${AGENT2_LABEL_LOCAL}.service"
  HOST_AGENT_LABEL="${AGENT2_LABEL}"
  "$@" || rc=$?
  AGENT_VM="${s_vm}"
  AGENT_IP="${s_ip}"
  AGENT_LABEL="${s_label}"
  AGENT_DIR="${s_dir}"
  AGENT_CONFIG="${s_config}"
  SYNC_TIMER="${s_timer}"
  SYNC_SERVICE="${s_service}"
  HOST_AGENT_LABEL="${s_host_label}"
  APPHOST_STATUS_BEFORE="${s_status}"
  return "$rc"
}

# agent2_enrolled — the relay holds a live certificate for the second agent
agent2_enrolled() {
  [ "$(host_api_get "certs/agent" | jq -r "[.agents[]? | select(.label == \"${AGENT2_LABEL}\" and (.revoked // false) == false)] | length" 2>/dev/null || echo 0)" != "0" ]
}

# agent2_set_up — the visitor VM has the second agent's config and sync timer
agent2_set_up() {
  [ "$(visitor_exec "test -f ${AGENT2_DIR}/config.json && XDG_RUNTIME_DIR=/run/user/0 systemctl --user is-active lamalibre-lamaste-sync-${AGENT2_LABEL_LOCAL}.timer 2>/dev/null || true" 2>/dev/null | tr -d '\r\n')" = "active" ]
}

# ensure_second_agent — the visitor VM enrolled as a second Lamaste agent
# with the app host helper enabled and the relay's key pinned; idempotent
# (a spec after the first finds it ready). Asserts and logs what it did.
ensure_second_agent() {
  local token out
  if agent2_enrolled && agent2_set_up; then
    log_pass "The second agent ${AGENT2_LABEL} (visitor VM) is enrolled and syncing"
  else
    visitor_exec "XDG_RUNTIME_DIR=/run/user/0 systemctl --user stop lamalibre-lamaste-sync-${AGENT2_LABEL_LOCAL}.timer lamalibre-lamaste-chisel-${AGENT2_LABEL_LOCAL} > /dev/null 2>&1; rm -rf ${AGENT2_DIR}; true" > /dev/null 2>&1 || true
    if agent2_enrolled; then host_api_delete "certs/agent/${AGENT2_LABEL}" > /dev/null 2>&1 || true; fi
    # The visitor VM resolves the relay's names already (setup-visitor.sh);
    # the tunnel host is the agent's own.
    visitor_exec "grep -q ' tunnel.${DOMAIN} ' /etc/hosts || echo '${HOST_IP}  tunnel.${DOMAIN}  # lamaste-e2e-test' >> /etc/hosts" > /dev/null 2>&1 || true
    out=$(timed_exec 300 multipass exec "${VISITOR_VM}" -- sudo bash -c "npm install -g @lamalibre/lamaste-agent > /tmp/e2e-agent2-install.log 2>&1 && echo INSTALLED; command -v lamaste-agent >/dev/null && lamaste-agent --version 2>/dev/null | head -n 1")
    assert_contains "$out" "INSTALLED" "lamaste-agent installed on the visitor VM from the dev Feria ($(echo "$out" | tail -n 1))" || true
    token=$(host_api_post "certs/agent/enroll" "{\"label\":\"${AGENT2_LABEL}\",\"capabilities\":[\"tunnels:read\",\"tunnels:write\",\"services:read\",\"system:read\"]}" | jq -r '.token // empty' 2>/dev/null || echo "")
    assert_not_eq "$token" "" "An enrolment token for ${AGENT2_LABEL}" || true
    out=$(timed_exec 300 multipass exec "${VISITOR_VM}" -- sudo bash -c "loginctl enable-linger root; for _ in 1 2 3 4 5 6 7 8 9 10; do [ -S /run/user/0/systemd/private ] && break; sleep 1; done; export XDG_RUNTIME_DIR=/run/user/0 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/0/bus; LAMALIBRE_LAMASTE_ENROLLMENT_TOKEN='${token}' lamaste-agent setup --label ${AGENT2_LABEL_LOCAL} --panel-url https://${HOST_IP}:9292 > /tmp/e2e-agent2-setup.log 2>&1 && echo SETUP_OK; tail -n 3 /tmp/e2e-agent2-setup.log")
    token=""
    assert_contains "$out" "SETUP_OK" "lamaste-agent setup on the visitor VM ($(echo "$out" | tail -n 1))" || true
    if agent2_enrolled && agent2_set_up; then
      log_pass "The second agent ${AGENT2_LABEL} is enrolled and its sync timer is active"
    else
      log_fail "The second agent is not enrolled or not syncing"
    fi
  fi
  # The app host helper, the relay's key pinned, the relay told.
  RELAY_KID=$(relay_kid_on_host)
  visitor_exec "lamaste-agent apphost status --json 2>/dev/null | grep -q '\"installed\":true' && lamaste-agent apphost pin --json > /dev/null 2>&1 || lamaste-agent apphost enable --user root --json > /dev/null 2>&1; true" > /dev/null 2>&1 || true
  if on_agent2 wait_for_app_host_facts 120 nudge; then
    log_pass "The second agent's app host helper is enabled and the relay knows it from its host facts"
  else
    log_fail "The relay's host facts of ${AGENT2_LABEL}: $(on_agent2 agent_host_facts)"
  fi
}

# remove_second_agent — the second agent uninstalled from the visitor VM and
# its certificate revoked (spec 61's cleanup: what the suite found, it leaves)
remove_second_agent() {
  timed_exec 240 multipass exec "${VISITOR_VM}" -- sudo bash -c "export XDG_RUNTIME_DIR=/run/user/0; lamaste-agent apphost disable --force > /dev/null 2>&1; lamaste-agent uninstall --label ${AGENT2_LABEL_LOCAL} --yes > /dev/null 2>&1; true" > /dev/null 2>&1
  host_api_delete "certs/agent/${AGENT2_LABEL}" > /dev/null 2>&1 || true
}

# open_agent2_push_install <policy id> — a push window for the second agent
# under the policy open_push_install created (call that first)
open_agent2_push_install() {
  AGENT2_PUSH_WINDOW=1
  host_api_post "plugins/push-install/enable/${AGENT2_LABEL}" "{\"durationMinutes\":60,\"policyId\":\"$1\"}" > /dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------
# The fixture plugins
# ---------------------------------------------------------------------------

# write_peers_fixture <dir> <name> <version> <provider|consumer> <build id>
# An agent-hosted app plugin whose agent half Lamaste installs (slice 3),
# with identity (role viewer, attribute displayName) and a peers block:
#
#   provider (e2e-pdir) provides
#     <name>:read  — GET /units/:unitId, GET /people/:userId/info; events
#                    unit.changed
#     <name>:write — POST /echo
#     and registers, besides, GET /peer/units/export (a static sibling the
#     `:unitId` pattern matches but no endpoint declares) and GET
#     /peer/secret (declared nowhere) — both through peerRoute, so only the
#     endpoint binding and the relay's allowlist stand between them and a
#     caller. Every /peer answer names the verified peer caller.
#     Its outbox (createPeerOutbox, data.db) publishes through
#     POST /admin/e2e/publish {count, tag} (an admin, through the forwarder),
#     each event in a transaction of its own; /admin/e2e/peerlog lists the
#     peer calls that reached a handler.
#   consumer (e2e-pcons) consumes e2e-pdir:read (subscribed to unit.changed)
#     and e2e-pdir:write; createPeers on the relay's channel; its inbox
#     handler records every event it is given in e2e_events (no uniqueness:
#     a duplicate would show), onGap records e2e_gaps. POST /admin/e2e/call
#     {scope, method, path, json?, forge?} makes a call as the plugin (forge:
#     with a made-up delegation, as a plugin inventing a user would) and
#     answers {status, body} or {error: {code, status, reason}};
#     GET /admin/e2e/state answers {connected, events, gaps}; the user
#     surface GET /app/me-via-peer calls the provider's
#     /people/<the user's id>/info on behalf of the user.
#
# Both answer /admin/health, /admin/hooks/* and /admin/identity/* through
# core's handlers and keep a projection (identity.db). Needs this
# workspace's node_modules (esbuild, Fastify) and core build.
write_peers_fixture() {
  local dir="$1" name="$2" version="$3" mode="$4" build_id="$5"
  local server_pkg="@lamalibre/${name}-server" agent_pkg="@lamalibre/${name}-agent" peers here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")/../e2e" && pwd)"
  case "$mode" in
    provider)
      peers="{
    \"provides\": {
      \"${name}:read\": {
        \"description\": \"Read units and people\",
        \"endpoints\": [
          { \"method\": \"GET\", \"path\": \"/units/:unitId\" },
          { \"method\": \"GET\", \"path\": \"/people/:userId/info\" }
        ],
        \"events\": [\"unit.changed\"]
      },
      \"${name}:write\": {
        \"description\": \"Echo what is sent\",
        \"endpoints\": [{ \"method\": \"POST\", \"path\": \"/echo\" }]
      }
    }
  }"
      ;;
    consumer)
      peers="{
    \"consumes\": {
      \"${PROVIDER}:read\": { \"required\": false, \"reason\": \"Units and people\", \"events\": [\"unit.changed\"] },
      \"${PROVIDER}:write\": { \"required\": false, \"reason\": \"Echo\" }
    }
  }"
      ;;
    *)
      echo "write_peers_fixture: unknown mode ${mode}" >&2
      return 2
      ;;
  esac
  mkdir -p "${dir}/server" "${dir}/agent/dist" "${dir}/agent-src"
  cat > "${dir}/server/package.json" <<FIXTURE_EOF
{
  "name": "${server_pkg}",
  "version": "${version}",
  "description": "Lamaste e2e fixture: a peers ${mode} app plugin",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "lamaste-plugin.json"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
  cat > "${dir}/server/index.js" <<FIXTURE_EOF
throw new Error('${name}: agent-hosted plugin code was imported');
FIXTURE_EOF
  cat > "${dir}/server/lamaste-plugin.json" <<FIXTURE_EOF
{
  "name": "${name}",
  "displayName": "E2E Peers ${mode}",
  "version": "${version}",
  "description": "A peers ${mode} whose agent half Lamaste installs",
  "hosting": "agent",
  "agent": {
    "requires": { "node": ">=22", "os": ["linux"], "systemPackages": [] },
    "package": "${agent_pkg}",
    "service": { "entry": "dist/agentd.mjs", "memoryMax": "256M" }
  },
  "modes": ["server"],
  "packages": { "server": "${server_pkg}" },
  "capabilities": ["plugin:${name}:use"],
  "hooks": {
    "agent": {
      "install": { "pre-tunnel": {}, "post-tunnel": {} },
      "uninstall": { "pre-teardown": {}, "post-teardown": {} }
    }
  },
  "identity": { "roles": [{ "id": "viewer", "label": "Viewer" }], "attributes": ["displayName"] },
  "peers": ${peers}
}
FIXTURE_EOF
  cp "${dir}/server/lamaste-plugin.json" "${dir}/agent-src/lamaste-plugin.json"
  cat > "${dir}/agent/package.json" <<FIXTURE_EOF
{
  "name": "${agent_pkg}",
  "version": "${version}",
  "description": "Lamaste e2e fixture: the bundled agent half of ${name} (build ${build_id})",
  "type": "module",
  "files": ["dist"],
  "license": "PolyForm-Noncommercial-1.0.0"
}
FIXTURE_EOF
  cat > "${dir}/agent-src/agentd.mjs" <<'AGENTD_EOF'
// E2E peers fixture — one agent half, provider or consumer (__E2E_MODE__),
// on Fastify and core's peers SDK. Runs under the unit lamaste-apphost
// writes, listening on systemd's socket (descriptor 3).
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import {
  PeerCallError,
  agentHalfListenTarget,
  createAgentHookHandler,
  createCallerAssertionVerifier,
  createHealthHandler,
  createIdentityHandlers,
  createIdentityProjection,
  createPeerOutbox,
  createPeers,
  peerRoute,
  peerSurface,
  responderHeaderFor,
} from '@lamalibre/lamaste/agent';
import MANIFEST from './lamaste-plugin.json';

const ROUTE = __E2E_ROUTE__;
const MODE = __E2E_MODE__;
const configPath = process.env.LAMASTE_APP_CONFIG;
const dataDir = process.env.LAMASTE_APP_DATA_DIR;
if (!configPath || !dataDir) {
  process.stderr.write('LAMASTE_APP_CONFIG and LAMASTE_APP_DATA_DIR are not set\n');
  process.exit(2);
}
const log = (line) => process.stdout.write(`${line}\n`);
const logger = {
  info: (obj, msg) => log(`info ${msg ?? ''} ${JSON.stringify(obj)}`),
  warn: (obj, msg) => log(`warn ${msg ?? ''} ${JSON.stringify(obj)}`),
};

const verifier = createCallerAssertionVerifier({ configPath, plugin: ROUTE, reloadIntervalMs: 1000 });
const PORT = await verifier.port();
const LISTEN = agentHalfListenTarget({ port: PORT });
const health = createHealthHandler({ verifier });
const HOOK_STAGES = ['install:pre-tunnel', 'install:post-tunnel', 'uninstall:pre-teardown', 'uninstall:post-teardown'];
const hooks = createAgentHookHandler({
  verifier,
  hooks: Object.fromEntries(HOOK_STAGES.map((stage) => [stage, () => ({ ok: true, output: { stage } })])),
});
const idDb = new DatabaseSync(path.join(dataDir, 'identity.db'));
const projection = createIdentityProjection({ db: idDb });
const identity = createIdentityHandlers({ verifier, projection, logger });

const dbPath = path.join(dataDir, 'data.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

// --- provider ---------------------------------------------------------------
let outbox = null;
const peerLog = [];
if (MODE === 'provider') outbox = await createPeerOutbox({ db, dbPath, peers: MANIFEST.peers });

// --- consumer ---------------------------------------------------------------
let peers = null;
if (MODE === 'consumer') {
  db.exec('CREATE TABLE IF NOT EXISTS e2e_events (id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL, key TEXT, tag TEXT, n INTEGER, at TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS e2e_gaps (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, reason TEXT NOT NULL, at TEXT NOT NULL)');
  const recordGap = db.prepare('INSERT INTO e2e_gaps (scope, reason, at) VALUES (?, ?, ?)');
  peers = createPeers({
    plugin: ROUTE,
    verifier,
    db,
    logger,
    onGap: ({ scope, reason }) => {
      recordGap.run(scope, reason, new Date().toISOString());
      log(`gap ${scope} ${reason}`);
    },
  });
  peers.on(`${Object.keys(MANIFEST.peers.consumes)[0]}`, 'unit.changed', (event, tx) => {
    tx.prepare('INSERT INTO e2e_events (seq, key, tag, n, at) VALUES (?, ?, ?, ?, ?)').run(
      event.seq,
      event.key,
      String(event.data?.tag ?? ''),
      Number(event.data?.n ?? -1),
      new Date().toISOString(),
    );
  });
}

// Core's handlers take the body as received: those requests never reach Fastify.
async function rawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function answer(res, out) {
  res.writeHead(out.status, out.headers);
  res.end(out.bodyText);
}
async function raw(req, res) {
  const target = req.url ?? '/';
  const method = req.method ?? 'GET';
  const p = target.split('?')[0];
  const request = { method, url: target, headers: req.headers, body: await rawBody(req) };
  if (p === '/admin/health') return answer(res, await health.handle(request));
  if (p.startsWith('/admin/hooks/')) return answer(res, await hooks.handle(request));
  return answer(res, await identity.handle(request));
}
const isRaw = (url) => {
  const p = (url ?? '/').split('?')[0];
  return p === '/admin/health' || p.startsWith('/admin/hooks/') || p === '/admin/identity' || p.startsWith('/admin/identity/');
};

const app = Fastify({
  serverFactory: (handler) =>
    http.createServer((req, res) => {
      if (isRaw(req.url)) {
        raw(req, res).catch((err) => {
          log(`error ${err?.message ?? err}`);
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        return;
      }
      handler(req, res);
    }),
});
await app.register(peerSurface({ verifier, outbox, peers }));
if (peers) peers.attach(app.server);

// An administrator through the forwarder: the `-` responder on every answer.
async function adminCaller(request, reply) {
  const verified = await verifier.verify(request.headers, request.method, request.url);
  if (!verified.ok) {
    reply.code(401).send({ error: verified.reason });
    return null;
  }
  if (verified.payload.caller.type !== 'admin') {
    reply.code(403).headers(responderHeaderFor(verified, 403)).send({ error: 'administrators only' });
    return null;
  }
  return verified;
}
const signed = (reply, verified, status, body) => reply.code(status).headers(responderHeaderFor(verified, status)).send(body);

if (outbox) {
  const seen = (request, caller) => {
    peerLog.push({ route: request.routeOptions.url, method: request.method, caller });
    return caller;
  };
  app.get('/peer/units/:unitId', peerRoute(async (request, caller) => ({ unitId: request.params.unitId, caller: seen(request, caller) })));
  app.get('/peer/units/export', peerRoute(async (request, caller) => ({ exported: true, caller: seen(request, caller) })));
  app.get('/peer/people/:userId/info', peerRoute(async (request, caller) => ({ userId: request.params.userId, caller: seen(request, caller) })));
  app.get('/peer/secret', peerRoute(async (request, caller) => ({ secret: true, caller: seen(request, caller) })));
  app.post('/peer/echo', peerRoute(async (request, caller) => ({ echoed: request.body ?? null, caller: seen(request, caller) })));
  app.post('/admin/e2e/publish', async (request, reply) => {
    const verified = await adminCaller(request, reply);
    if (!verified) return reply;
    const count = Number(request.body?.count ?? 1);
    const tag = String(request.body?.tag ?? 'e2e');
    const seqs = [];
    for (let n = 1; n <= count; n += 1) {
      db.exec('BEGIN IMMEDIATE');
      try {
        seqs.push(outbox.publish({ scope: `${ROUTE}:read`, type: 'unit.changed', key: `${tag}-${n}`, data: { tag, n } }));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
    log(`published ${count} ${tag}`);
    return signed(reply, verified, 200, { seqs, state: outbox.state() });
  });
  app.get('/admin/e2e/peerlog', async (request, reply) => {
    const verified = await adminCaller(request, reply);
    if (!verified) return reply;
    return signed(reply, verified, 200, { calls: peerLog });
  });
}

const callResult = async (fn) => {
  try {
    const res = await fn();
    let body = null;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body };
  } catch (err) {
    if (err instanceof PeerCallError) {
      return { error: { code: err.code, status: err.status, reason: err.reason, retryAfter: err.retryAfter } };
    }
    return { error: { code: 'thrown', message: String(err?.message ?? err) } };
  }
};

if (peers) {
  app.post('/admin/e2e/call', async (request, reply) => {
    const verified = await adminCaller(request, reply);
    if (!verified) return reply;
    const { scope, method, path: target, json, forge } = request.body ?? {};
    const opts = {
      ...(json !== undefined ? { json } : {}),
      ...(forge ? { onBehalfOf: { headers: { 'x-lamalibre-delegation': `${Buffer.from(JSON.stringify({ v: 1, typ: 'lamaste.peer.delegation', holder: ROUTE, userId: '00000000-0000-4000-8000-000000000000' })).toString('base64url')}.${'A'.repeat(43)}` } } } : {}),
    };
    return signed(reply, verified, 200, await callResult(() => peers.call(scope, method, target, opts)));
  });
  app.get('/admin/e2e/state', async (request, reply) => {
    const verified = await adminCaller(request, reply);
    if (!verified) return reply;
    return signed(reply, verified, 200, {
      connected: peers.connected(),
      events: db.prepare('SELECT seq, key, tag, n FROM e2e_events ORDER BY id').all(),
      gaps: db.prepare('SELECT scope, reason FROM e2e_gaps ORDER BY id').all(),
    });
  });
  // The user surface: a user caller only; the call goes on their behalf.
  app.get('/app/me-via-peer', async (request, reply) => {
    const verified = await verifier.verify(request.headers, request.method, request.url);
    if (!verified.ok) return reply.code(401).send({ error: verified.reason });
    const caller = verified.payload.caller;
    if (caller.type !== 'user') return signed(reply, verified, 403, { error: 'users only' });
    const result = await callResult(() =>
      peers.call(`${Object.keys(MANIFEST.peers.consumes)[0]}`, 'GET', `/people/${caller.userId}/info`, { onBehalfOf: request }),
    );
    return signed(reply, verified, 200, { me: { userId: caller.userId, username: caller.username }, delegated: Boolean(request.headers['x-lamalibre-delegation']), result });
  });
}

await app.ready();
app.server.listen(LISTEN, () => log(`${ROUTE} peers ${MODE} on 127.0.0.1:${PORT}`));
AGENTD_EOF
  node "${here}/build-app-agent-half.js" --entry "${dir}/agent-src/agentd.mjs" \
    --outfile "${dir}/agent/dist/agentd.mjs" --route "${name}" --mode "${mode}" > /dev/null
}

# ---------------------------------------------------------------------------
# API helpers of the specs
# ---------------------------------------------------------------------------

# consumer_call <scope> <method> <path> [json body] [forge] — the consumer's
# half makes the call (POST /admin/e2e/call through the forwarder); prints
# {status, body} or {error}
consumer_call() {
  local body
  body=$(jq -cn --arg s "$1" --arg m "$2" --arg p "$3" --argjson j "${4:-null}" --arg f "${5:-}" \
    '{scope: $s, method: $m, path: $p} + (if $j == null then {} else {json: $j} end) + (if $f == "" then {} else {forge: true} end)')
  host_api_post "${CONSUMER}/e2e/call" "$body"
}

consumer_state() { host_api_get "${CONSUMER}/e2e/state"; }
provider_peerlog() { host_api_get "${PROVIDER}/e2e/peerlog"; }
provider_publish() { host_api_post "${PROVIDER}/e2e/publish" "{\"count\":$1,\"tag\":\"$2\"}"; }

# apply_shelf [scopes json] — PUT /api/peers/shelves/e2e-peers; prints status then body
apply_shelf() {
  local scopes="${1:-}"
  if [ -z "$scopes" ]; then
    scopes=$(jq -cn --arg s "${SCOPE_READ}" --arg p "${PROVIDER}" --arg c "${CONSUMER}" '{($s): {provider: $p, consumers: [$c]}}')
  fi
  host_api_call PUT "peers/shelves/${SHELF_ID}" "{\"scopes\":${scopes}}"
}

peers_view() { host_api_get "peers"; }

# audit_action_count <action> — audit entries of <action> since the spec began
audit_action_count() {
  host_api_get "audit?action=$1&limit=500" | jq "[.entries[]? | select(.id > ${AUDIT_BASE} and .action == \"$1\")] | length" 2>/dev/null || echo "0"
}

# edge_state <scope> — the applied shelf's edge consumer → scope: its state
edge_state() {
  peers_view | jq -r --arg s "$1" --arg c "${CONSUMER}" '[.shelves[]?.edges[]? | select(.scope == $s and .consumer == $c) | .state] | first // "none"' 2>/dev/null || echo "none"
}

# consumer_connected — the consumer's half reports its peer channel up
consumer_connected() { [ "$(consumer_state | jq -r '.connected' 2>/dev/null)" = "true" ]; }

# consumer_event_count — how many events the consumer's handler recorded
consumer_event_count() { consumer_state | jq -r '.events | length' 2>/dev/null || echo "-1"; }

# ---------------------------------------------------------------------------
# Setup and cleanup shared by the specs
# ---------------------------------------------------------------------------

# peers_setup <policy id> — both fixtures built and served by the stand-in
# Feria, the second agent ready, push windows on both agents, both plugins
# installed, approved, enabled and hosted (provider on the agent VM,
# consumer on the visitor VM's agent), both identity-ready
peers_setup() {
  local op
  if ! write_peers_fixture "${LOCAL_TMP}/ship/fixtures/pdir" "${PROVIDER}" 1.0.0 provider "r$(date +%s)-$$" ||
    ! write_peers_fixture "${LOCAL_TMP}/ship/fixtures/pcons" "${CONSUMER}" 1.0.0 consumer "r$(date +%s)-$$"; then
    log_fail "The peers fixtures could not be built (npm install at the workspace root, npm run build -w packages/core/lib)"
    end_test
    exit $?
  fi
  log_pass "Fixtures built: ${PROVIDER_SERVER} (provides ${SCOPE_READ}, ${SCOPE_WRITE}) and ${CONSUMER_SERVER} (consumes both)"
  ensure_second_agent
  start_stand_in_feria fixtures/pdir/server fixtures/pdir/agent fixtures/pcons/server fixtures/pcons/agent
  # The second agent installs its agent half from the stand-in too.
  host_exec "ufw status 2>/dev/null | grep -q '^Status: active' && ufw allow from ${VISITOR_IP} to any port ${STUB_PORT} proto tcp > /dev/null || true"
  ensure_app_host_helper
  open_push_install "$1" "[\"${PROVIDER_AGENT}\",\"${CONSUMER_AGENT}\"]" '["install","uninstall"]'
  open_agent2_push_install "$1"

  install_approved "${PROVIDER}" "${PROVIDER_SERVER}@1.0.0" > /dev/null
  install_approved "${CONSUMER}" "${CONSUMER_SERVER}@1.0.0" > /dev/null
  assert_json_field "$(host_api_get "plugins/${PROVIDER}/hooks")" '.approval.state' 'approved' "${PROVIDER} installed and approved (its peers block in the digest)" || true
  assert_json_field "$(host_api_get "plugins/${CONSUMER}/hooks")" '.approval.state' 'approved' "${CONSUMER} installed and approved" || true

  op=$(host_plugin "${PROVIDER}" 300 nudge)
  assert_json_field "$op" '.status' 'succeeded' "${PROVIDER} hosted on ${HOST_AGENT_LABEL} (agent VM) ($(json_get "$op" '.error // .refused.error // ""'))" || true
  op=$(on_agent2 host_plugin "${CONSUMER}" 300 nudge)
  assert_json_field "$op" '.status' 'succeeded' "${CONSUMER} hosted on ${AGENT2_LABEL} (visitor VM) ($(json_get "$op" '.error // .refused.error // ""'))" || true
  if wait_for 120 identity_ready "${PROVIDER}" && wait_for 120 identity_ready "${CONSUMER}"; then
    log_pass "Both halves are identity-ready (their feeds at the head)"
  else
    log_fail "Identity readiness: ${PROVIDER} $(identity_view "${PROVIDER}" | jq -c '.readiness') ${CONSUMER} $(identity_view "${CONSUMER}" | jq -c '.readiness')"
  fi
  if wait_for 90 consumer_connected; then
    log_pass "The relay attached its peer channel to ${CONSUMER}'s half on the visitor VM"
  else
    log_fail "The consumer reports no peer channel: $(consumer_state)"
  fi
}

# peers_cleanup — the shelf removed, then app_plugin_cleanup (both plugins
# uninstalled — their dependents broken on purpose — and their halves
# removed on both agents), the second agent's push window closed
peers_cleanup() {
  host_api_delete "peers/shelves/${SHELF_ID}" > /dev/null 2>&1 || true
  app_plugin_cleanup
  timed_exec 120 multipass exec "${VISITOR_VM}" -- sudo bash -c "if [ -x ${APPHOST_HELPER} ]; then ${APPHOST_HELPER} remove ${AGENT2_LABEL_LOCAL} ${CONSUMER} --purge > /dev/null 2>&1; fi; true" > /dev/null 2>&1
  if [ -n "${AGENT2_PUSH_WINDOW}" ]; then
    host_api_delete "plugins/push-install/enable/${AGENT2_LABEL}" > /dev/null 2>&1 || true
  fi
  timed_exec 60 multipass exec "${HOST_VM}" -- sudo bash -c "ufw delete allow from ${VISITOR_IP} to any port ${STUB_PORT} proto tcp > /dev/null 2>&1; true" > /dev/null 2>&1
}
