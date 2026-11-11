# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-11-11 09:02:28 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `09:02:32` Admin cert reset and PEM re-extracted from P12  
✅ `09:02:32` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `09:02:32` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `09:02:32` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `09:02:33` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `09:02:33` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `09:02:34` Expose panel returned ok: true  
✅ `09:02:34` Tunnel type is 'panel'  
✅ `09:02:34` Panel subdomain matches agent-<label>  
✅ `09:02:34` Panel tunnel is carried by test-agent  
✅ `09:02:34` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `09:02:34` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 6e30fdc2-4abb-4a3f-b4df-be5b3cac36e1)  

## Verify mTLS nginx vhost on host

✅ `09:02:34` mTLS panel vhost exists in sites-enabled  
✅ `09:02:34` No Authelia app vhost created for panel tunnel  
✅ `09:02:35` nginx -t passes after panel expose  
✅ `09:02:35` Panel vhost asks the panel to authorize every request  
✅ `09:02:35` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `09:02:35` Panel shows as enabled  
✅ `09:02:35` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `09:02:35` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `09:02:38` Panel HTTP server running on agent at port 9393  
ℹ️ `09:02:38` Waiting for the sync timer to carry the panel tunnel...  
✅ `09:02:45` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `09:02:45` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `09:02:45` mTLS vhost serves panel content via FQDN  
✅ `09:02:45` Panel content served through the mTLS vhost  
✅ `09:02:45` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `09:02:46` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `09:02:48` mTLS panel vhost removed after retract  
✅ `09:02:48` nginx -t passes after panel retract  

## Verify status after retract

✅ `09:02:49` Panel shows as disabled after retract  
✅ `09:02:49` Panel content not accessible via FQDN after retract  
✅ `09:03:15` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `09:03:16` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `09:03:16` Cleaning up test resources...  
