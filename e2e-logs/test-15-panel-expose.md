# Lamaste E2E: 15 — Panel Expose (Three-VM)

> Started at `2026-03-30 13:12:19 UTC`


## Pre-flight: re-extract admin PEM from P12

✅ `13:12:23` Admin cert reset and PEM re-extracted from P12  
✅ `13:12:23` Panel is healthy  

## Pre-flight: verify onboarding is complete


## Create agent cert with panel:expose capability

✅ `13:12:25` Agent cert with panel:expose created  
✅ `13:12:25` Agent cert has a p12 password  
ℹ️ `13:12:25` Created agent cert: panel-expose-e2e  
✅ `13:12:25` Extracted PEM cert and key from .p12 on host  

## Check panel status before expose

✅ `13:12:25` Panel not exposed initially  

## Expose agent panel via API

✅ `13:12:28` Expose panel returned ok: true  
✅ `13:12:28` Tunnel type is 'panel'  
✅ `13:12:28` Panel subdomain matches agent-<label>  
✅ `13:12:28` Panel tunnel has an FQDN  
ℹ️ `13:12:28` Exposed panel tunnel: agent-panel-expose-e2e.test.lamaste.local (ID: a3deb6a9-14cd-477c-8685-bffa9958c80d)  

## Verify mTLS nginx vhost on host

✅ `13:12:28` mTLS panel vhost exists in sites-enabled  
✅ `13:12:28` No Authelia app vhost created for panel tunnel  
✅ `13:12:28` nginx -t passes after panel expose  

## Verify agent-panel-status after expose

✅ `13:12:28` Panel shows as enabled  
✅ `13:12:28` Status FQDN matches  

## Start panel HTTP server on agent and establish tunnel

✅ `13:12:28` Added agent-panel-expose-e2e.test.lamaste.local to agent /etc/hosts  
✅ `13:12:31` Panel HTTP server running on agent at port 9393  
ℹ️ `13:12:37` Waiting for Chisel tunnel to establish for panel...  
✅ `13:12:37` Chisel tunnel established for panel (port 9393 accessible on host)  

## Verify panel content through chisel tunnel (direct)

✅ `13:12:37` Direct tunnel traffic returns panel content  

## Verify mTLS vhost serves panel via FQDN (no Authelia needed)

✅ `13:12:37` mTLS vhost serves panel content via FQDN (HTTP 200)  
✅ `13:12:37` Panel FQDN rejects access without mTLS cert (HTTP 400)  

## Retract panel tunnel

✅ `13:12:40` Retract panel returned ok: true  

## Verify vhost removed after retract

✅ `13:12:42` mTLS panel vhost removed after retract  
✅ `13:12:42` nginx -t passes after panel retract  

## Verify status after retract

✅ `13:12:42` Panel shows as disabled after retract  
✅ `13:12:42` Panel content not accessible via FQDN after retract (different server block)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `26` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `26` |

ℹ️ `13:12:45` Cleaning up test resources...  
🔵 `13:12:50` **Running: 16-agent-json-setup.sh**  
