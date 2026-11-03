# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-03 09:29:27 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `09:29:32` Admin cert reset and PEM re-extracted from P12  
✅ `09:29:32` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `09:29:32` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `09:29:32` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `09:29:32` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `09:29:33` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `09:29:33` Expose panel returned ok: true  
✅ `09:29:33` Tunnel type is 'panel'  
✅ `09:29:33` Panel subdomain matches agent-<label>  
✅ `09:29:33` Panel tunnel is carried by test-agent  
✅ `09:29:33` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `09:29:33` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: f591fbf1-a2b2-4d1f-ae57-1e158741ba4e)  

## Verify mTLS nginx vhost on host

✅ `09:29:34` mTLS panel vhost exists in sites-enabled  
✅ `09:29:34` No Authelia app vhost created for panel tunnel  
✅ `09:29:34` nginx -t passes after panel expose  
✅ `09:29:34` Panel vhost asks the panel to authorize every request  
✅ `09:29:34` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `09:29:34` Panel shows as enabled  
✅ `09:29:34` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `09:29:34` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `09:29:37` Panel HTTP server running on agent at port 9393  
ℹ️ `09:29:37` Waiting for the sync timer to carry the panel tunnel...  
✅ `09:29:48` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `09:29:48` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `09:29:48` mTLS vhost serves panel content via FQDN  
✅ `09:29:48` Panel content served through the mTLS vhost  
✅ `09:29:48` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `09:29:49` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `09:29:51` mTLS panel vhost removed after retract  
✅ `09:29:51` nginx -t passes after panel retract  

## Verify status after retract

✅ `09:29:51` Panel shows as disabled after retract  
✅ `09:29:51` Panel content not accessible via FQDN after retract  
✅ `09:30:19` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `09:30:20` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `09:30:20` Cleaning up test resources...  
