# Portlama E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-03-29 09:13:12 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `09:13:14` Admin cert reset and PEM re-extracted from P12  
✅ `09:13:15` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Create agent cert with panel:expose capability

✅ `09:13:16` Agent cert with panel:expose created  
✅ `09:13:16` Agent cert has a p12 password  
ℹ️ `09:13:16` Created agent cert: panel-expose-e2e  
✅ `09:13:16` Extracted PEM cert and key from .p12 on host  

## Check panel status before expose

✅ `09:13:16` Panel not exposed initially  

## Expose agent panel via API

✅ `09:13:19` Expose panel returned ok: true  
✅ `09:13:19` Tunnel type is 'panel'  
✅ `09:13:19` Panel subdomain matches agent-<label>  
✅ `09:13:19` Panel tunnel has an FQDN  
ℹ️ `09:13:19` Exposed panel tunnel: agent-panel-expose-e2e.test.portlama.local (ID: 9328defb-248a-47e7-8215-e51ea04bbc49)  

## Verify mTLS nginx vhost on host

✅ `09:13:19` mTLS panel vhost exists in sites-enabled  
✅ `09:13:19` No Authelia app vhost created for panel tunnel  
✅ `09:13:19` nginx -t passes after panel expose  

## Verify agent-panel-status after expose

✅ `09:13:19` Panel shows as enabled  
✅ `09:13:19` Status FQDN matches  

## Start panel HTTP server on agent and establish tunnel

✅ `09:13:19` Added agent-panel-expose-e2e.test.portlama.local to agent /etc/hosts  
✅ `09:13:21` Panel HTTP server running on agent at port 9393  
ℹ️ `09:13:26` Waiting for Chisel tunnel to establish for panel...  
✅ `09:13:26` Chisel tunnel established for panel (port 9393 accessible on host)  

## Verify panel content through chisel tunnel (direct)

✅ `09:13:26` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `09:13:26` mTLS vhost serves panel content via FQDN (HTTP 200)  
✅ `09:13:26` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `09:13:28` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `09:13:30` mTLS panel vhost removed after retract  
✅ `09:13:30` nginx -t passes after panel retract  

## Verify status after retract

✅ `09:13:31` Panel shows as disabled after retract  
✅ `09:13:31` Panel content not accessible via FQDN after retract (different server block)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

ℹ️ `09:13:34` Cleaning up test resources...  
🔵 `09:13:39` **Running: 16-agent-json-setup.sh**  
