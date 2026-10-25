# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-10-25 17:19:04 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `17:19:09` Admin cert reset and PEM re-extracted from P12  
✅ `17:19:09` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Grant test-agent panel:expose

ℹ️ `17:19:09` test-agent capabilities before the test: ["tunnels:read","tunnels:write","services:read","services:write","system:read","identity:read","identity:query"]  
✅ `17:19:09` test-agent granted panel:expose  

## Extract test-agent's certificate on the agent VM

✅ `17:19:10` Extracted certificate is test-agent's (CN=agent:test-agent)  

## Check panel status before expose

✅ `17:19:10` Panel not exposed initially  

## Expose agent panel via API (agent's own certificate)

✅ `17:19:10` Expose panel returned ok: true  
✅ `17:19:10` Tunnel type is 'panel'  
✅ `17:19:10` Panel subdomain matches agent-<label>  
✅ `17:19:10` Panel tunnel is carried by test-agent  
✅ `17:19:10` Panel tunnel FQDN is agent-test-agent.test.lamaste.local  
ℹ️ `17:19:10` Exposed panel tunnel: agent-test-agent.test.lamaste.local (ID: 0368c03a-c10e-4ebf-9cd9-6229ea0da890)  

## Verify mTLS nginx vhost on host

✅ `17:19:10` mTLS panel vhost exists in sites-enabled  
✅ `17:19:11` No Authelia app vhost created for panel tunnel  
✅ `17:19:11` nginx -t passes after panel expose  
✅ `17:19:11` Panel vhost asks the panel to authorize every request  
✅ `17:19:11` Panel vhost forwards the relay assertion  

## Verify agent-panel-status after expose

✅ `17:19:11` Panel shows as enabled  
✅ `17:19:11` Status FQDN matches  

## Start panel HTTP server on agent — the sync timer carries it

✅ `17:19:11` Added agent-test-agent.test.lamaste.local to agent /etc/hosts  
✅ `17:19:14` Panel HTTP server running on agent at port 9393  
ℹ️ `17:19:14` Waiting for the sync timer to carry the panel tunnel...  
✅ `17:19:14` Panel tunnel carried within 60 seconds with no lamaste-agent update  

## Verify panel content through chisel tunnel (direct)

✅ `17:19:14` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `17:19:14` mTLS vhost serves panel content via FQDN  
✅ `17:19:14` Panel content served through the mTLS vhost  
✅ `17:19:14` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `17:19:14` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `17:19:17` mTLS panel vhost removed after retract  
✅ `17:19:17` nginx -t passes after panel retract  

## Verify status after retract

✅ `17:19:17` Panel shows as disabled after retract  
✅ `17:19:17` Panel content not accessible via FQDN after retract  
✅ `17:19:46` Agent's chisel client no longer carries the retracted panel's remote (sync timer)  
✅ `17:19:46` Panel port closed on the host after retract  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `31` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `31` |

ℹ️ `17:19:46` Cleaning up test resources...  
