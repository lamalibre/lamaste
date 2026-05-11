# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-04-30 09:01:47 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `09:01:50` Admin cert reset and PEM re-extracted from P12  
✅ `09:01:50` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Create agent cert with panel:expose capability

✅ `09:01:51` Agent cert with panel:expose created  
✅ `09:01:51` Agent cert has a p12 password  
ℹ️ `09:01:51` Created agent cert: panel-expose-e2e  
✅ `09:01:52` Extracted PEM cert and key from .p12 on host  

## Check panel status before expose

✅ `09:01:52` Panel not exposed initially  

## Expose agent panel via API

✅ `09:01:54` Expose panel returned ok: true  
✅ `09:01:54` Tunnel type is 'panel'  
✅ `09:01:54` Panel subdomain matches agent-<label>  
✅ `09:01:54` Panel tunnel has an FQDN  
ℹ️ `09:01:54` Exposed panel tunnel: agent-panel-expose-e2e.test.lamaste.local (ID: 2ed0f96b-3817-4697-b96b-7bbfc051a848)  

## Verify mTLS nginx vhost on host

✅ `09:01:54` mTLS panel vhost exists in sites-enabled  
✅ `09:01:54` No Authelia app vhost created for panel tunnel  
✅ `09:01:55` nginx -t passes after panel expose  

## Verify agent-panel-status after expose

✅ `09:01:55` Panel shows as enabled  
✅ `09:01:55` Status FQDN matches  

## Start panel HTTP server on agent and establish tunnel

✅ `09:01:55` Added agent-panel-expose-e2e.test.lamaste.local to agent /etc/hosts  
✅ `09:01:57` Panel HTTP server running on agent at port 9393  
ℹ️ `09:02:04` Waiting for Chisel tunnel to establish for panel...  
✅ `09:02:05` Chisel tunnel established for panel (port 9393 accessible on host)  

## Verify panel content through chisel tunnel (direct)

✅ `09:02:05` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `09:02:05` mTLS vhost serves panel content via FQDN (HTTP 200)  
✅ `09:02:05` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `09:02:07` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `09:02:09` mTLS panel vhost removed after retract  
✅ `09:02:09` nginx -t passes after panel retract  

## Verify status after retract

✅ `09:02:10` Panel shows as disabled after retract  
✅ `09:02:10` Panel content not accessible via FQDN after retract (different server block)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

ℹ️ `09:02:13` Cleaning up test resources...  
