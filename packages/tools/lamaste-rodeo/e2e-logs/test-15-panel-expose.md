# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-10-13 11:48:59 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `11:49:02` Admin cert reset and PEM re-extracted from P12  
✅ `11:49:03` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `11:49:03` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `11:49:03` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `11:49:04` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `11:49:04` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `11:49:05` Expose panel returned ok: true  
✅ `11:49:05` Tunnel type is 'panel'  
✅ `11:49:05` Panel subdomain matches agent-<label>  
✅ `11:49:05` Panel tunnel is carried by test-agent  
✅ `11:49:05` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `11:49:05` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 2884232a-897b-4c1b-8119-d817140cf967)  

## Verify mTLS nginx vhost on host

✅ `11:49:05` mTLS panel vhost exists in sites-enabled  
✅ `11:49:05` No Authelia app vhost created for panel tunnel  
✅ `11:49:05` nginx -t passes after panel expose  

## Verify agent-panel-status after expose

✅ `11:49:05` Panel shows as enabled  
✅ `11:49:05` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `11:49:05` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `11:49:08` Panel HTTP server running on agent at port 9393  
ℹ️ `11:49:08` Waiting for the sync timer to carry the panel tunnel...  
✅ `11:49:21` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `11:49:21` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `11:49:22` mTLS vhost serves panel content via FQDN  
✅ `11:49:22` Panel content served through the mTLS vhost  
✅ `11:49:22` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `11:49:22` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `11:49:24` mTLS panel vhost removed after retract  
✅ `11:49:24` nginx -t passes after panel retract  

## Verify status after retract

✅ `11:49:24` Panel shows as disabled after retract  
✅ `11:49:24` Panel content not accessible via FQDN after retract  
✅ `11:49:53` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `11:49:53` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `29` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `29` |

ℹ️ `11:49:53` Cleaning up test resources...  
