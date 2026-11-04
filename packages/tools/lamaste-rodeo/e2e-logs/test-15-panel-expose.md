# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-04 13:33:52 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `13:33:56` Admin cert reset and PEM re-extracted from P12  
✅ `13:33:57` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `13:33:57` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `13:33:57` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `13:33:58` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `13:33:59` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `13:34:00` Expose panel returned ok: true  
✅ `13:34:00` Tunnel type is 'panel'  
✅ `13:34:00` Panel subdomain matches agent-<label>  
✅ `13:34:00` Panel tunnel is carried by test-agent  
✅ `13:34:00` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `13:34:00` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 691ad82a-7df1-481c-8e24-f82584de940e)  

## Verify mTLS nginx vhost on host

✅ `13:34:00` mTLS panel vhost exists in sites-enabled  
✅ `13:34:00` No Authelia app vhost created for panel tunnel  
✅ `13:34:01` nginx -t passes after panel expose  
✅ `13:34:01` Panel vhost asks the panel to authorize every request  
✅ `13:34:01` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `13:34:01` Panel shows as enabled  
✅ `13:34:01` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `13:34:01` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `13:34:04` Panel HTTP server running on agent at port 9393  
ℹ️ `13:34:04` Waiting for the sync timer to carry the panel tunnel...  
✅ `13:34:29` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `13:34:29` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `13:34:29` mTLS vhost serves panel content via FQDN  
✅ `13:34:30` Panel content served through the mTLS vhost  
✅ `13:34:30` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `13:34:30` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `13:34:33` mTLS panel vhost removed after retract  
✅ `13:34:33` nginx -t passes after panel retract  

## Verify status after retract

✅ `13:34:34` Panel shows as disabled after retract  
✅ `13:34:34` Panel content not accessible via FQDN after retract  
✅ `13:35:01` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `13:35:02` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `13:35:02` Cleaning up test resources...  
