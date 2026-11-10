# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-10 17:46:28 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `17:46:32` Admin cert reset and PEM re-extracted from P12  
✅ `17:46:32` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `17:46:33` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `17:46:33` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `17:46:33` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `17:46:34` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `17:46:35` Expose panel returned ok: true  
✅ `17:46:35` Tunnel type is 'panel'  
✅ `17:46:35` Panel subdomain matches agent-<label>  
✅ `17:46:35` Panel tunnel is carried by test-agent  
✅ `17:46:35` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `17:46:35` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 33c6d288-0500-4eec-9e15-cd3f97e58825)  

## Verify mTLS nginx vhost on host

✅ `17:46:35` mTLS panel vhost exists in sites-enabled  
✅ `17:46:35` No Authelia app vhost created for panel tunnel  
✅ `17:46:35` nginx -t passes after panel expose  
✅ `17:46:35` Panel vhost asks the panel to authorize every request  
✅ `17:46:35` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `17:46:35` Panel shows as enabled  
✅ `17:46:35` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `17:46:36` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `17:46:38` Panel HTTP server running on agent at port 9393  
ℹ️ `17:46:38` Waiting for the sync timer to carry the panel tunnel...  
✅ `17:46:47` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `17:46:47` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `17:46:47` mTLS vhost serves panel content via FQDN  
✅ `17:46:47` Panel content served through the mTLS vhost  
✅ `17:46:48` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `17:46:48` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `17:46:51` mTLS panel vhost removed after retract  
✅ `17:46:51` nginx -t passes after panel retract  

## Verify status after retract

✅ `17:46:51` Panel shows as disabled after retract  
✅ `17:46:51` Panel content not accessible via FQDN after retract  
✅ `17:47:19` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `17:47:20` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `17:47:20` Cleaning up test resources...  
