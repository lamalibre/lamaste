# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-10 13:03:29 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `13:03:33` Admin cert reset and PEM re-extracted from P12  
✅ `13:03:33` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `13:03:34` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `13:03:34` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `13:03:34` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `13:03:34` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `13:03:36` Expose panel returned ok: true  
✅ `13:03:36` Tunnel type is 'panel'  
✅ `13:03:36` Panel subdomain matches agent-<label>  
✅ `13:03:36` Panel tunnel is carried by test-agent  
✅ `13:03:36` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `13:03:36` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 0d7b88bf-5a89-4edc-8ad0-a6051fd410dc)  

## Verify mTLS nginx vhost on host

✅ `13:03:36` mTLS panel vhost exists in sites-enabled  
✅ `13:03:36` No Authelia app vhost created for panel tunnel  
✅ `13:03:36` nginx -t passes after panel expose  
✅ `13:03:36` Panel vhost asks the panel to authorize every request  
✅ `13:03:36` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `13:03:37` Panel shows as enabled  
✅ `13:03:37` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `13:03:37` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `13:03:39` Panel HTTP server running on agent at port 9393  
ℹ️ `13:03:39` Waiting for the sync timer to carry the panel tunnel...  
✅ `13:03:46` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `13:03:46` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `13:03:47` mTLS vhost serves panel content via FQDN  
✅ `13:03:47` Panel content served through the mTLS vhost  
✅ `13:03:47` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `13:03:47` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `13:03:49` mTLS panel vhost removed after retract  
✅ `13:03:49` nginx -t passes after panel retract  

## Verify status after retract

✅ `13:03:50` Panel shows as disabled after retract  
✅ `13:03:50` Panel content not accessible via FQDN after retract  
✅ `13:04:19` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `13:04:19` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `13:04:19` Cleaning up test resources...  
