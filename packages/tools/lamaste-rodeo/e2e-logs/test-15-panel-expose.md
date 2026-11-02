# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-02 15:49:22 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `15:49:27` Admin cert reset and PEM re-extracted from P12  
✅ `15:49:27` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `15:49:27` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `15:49:27` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `15:49:27` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `15:49:27` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `15:49:28` Expose panel returned ok: true  
✅ `15:49:28` Tunnel type is 'panel'  
✅ `15:49:28` Panel subdomain matches agent-<label>  
✅ `15:49:28` Panel tunnel is carried by test-agent  
✅ `15:49:28` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `15:49:28` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 68938ebb-6f9f-452c-a31b-8d73a0384b21)  

## Verify mTLS nginx vhost on host

✅ `15:49:28` mTLS panel vhost exists in sites-enabled  
✅ `15:49:28` No Authelia app vhost created for panel tunnel  
✅ `15:49:29` nginx -t passes after panel expose  
✅ `15:49:29` Panel vhost asks the panel to authorize every request  
✅ `15:49:29` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `15:49:29` Panel shows as enabled  
✅ `15:49:29` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `15:49:29` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `15:49:31` Panel HTTP server running on agent at port 9393  
ℹ️ `15:49:31` Waiting for the sync timer to carry the panel tunnel...  
✅ `15:50:01` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `15:50:01` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `15:50:01` mTLS vhost serves panel content via FQDN  
✅ `15:50:01` Panel content served through the mTLS vhost  
✅ `15:50:01` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `15:50:01` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `15:50:04` mTLS panel vhost removed after retract  
✅ `15:50:04` nginx -t passes after panel retract  

## Verify status after retract

✅ `15:50:04` Panel shows as disabled after retract  
✅ `15:50:04` Panel content not accessible via FQDN after retract  
✅ `15:50:32` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `15:50:32` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `15:50:32` Cleaning up test resources...  
