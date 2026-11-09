# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-09 12:41:26 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `12:41:29` Admin cert reset and PEM re-extracted from P12  
✅ `12:41:29` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `12:41:30` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `12:41:30` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `12:41:30` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `12:41:30` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `12:41:31` Expose panel returned ok: true  
✅ `12:41:31` Tunnel type is 'panel'  
✅ `12:41:31` Panel subdomain matches agent-<label>  
✅ `12:41:31` Panel tunnel is carried by test-agent  
✅ `12:41:31` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `12:41:31` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: d0acd51b-4508-4f58-bd26-b3d8dd252a0e)  

## Verify mTLS nginx vhost on host

✅ `12:41:31` mTLS panel vhost exists in sites-enabled  
✅ `12:41:31` No Authelia app vhost created for panel tunnel  
✅ `12:41:31` nginx -t passes after panel expose  
✅ `12:41:31` Panel vhost asks the panel to authorize every request  
✅ `12:41:32` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `12:41:32` Panel shows as enabled  
✅ `12:41:32` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `12:41:32` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `12:41:34` Panel HTTP server running on agent at port 9393  
ℹ️ `12:41:34` Waiting for the sync timer to carry the panel tunnel...  
✅ `12:41:50` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `12:41:50` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `12:41:50` mTLS vhost serves panel content via FQDN  
✅ `12:41:50` Panel content served through the mTLS vhost  
✅ `12:41:50` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `12:41:50` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `12:41:52` mTLS panel vhost removed after retract  
✅ `12:41:53` nginx -t passes after panel retract  

## Verify status after retract

✅ `12:41:53` Panel shows as disabled after retract  
✅ `12:41:53` Panel content not accessible via FQDN after retract  
✅ `12:42:22` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `12:42:23` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `12:42:23` Cleaning up test resources...  
