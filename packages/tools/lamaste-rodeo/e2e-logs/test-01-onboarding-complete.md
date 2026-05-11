# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-04-30 08:55:52 UTC`


## Onboarding status

✅ `08:55:52` Onboarding status is COMPLETED  
✅ `08:55:52` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `08:55:52` Service nginx is active  
✅ `08:55:52` Service chisel is active  
✅ `08:55:53` Service authelia is active  
✅ `08:55:53` Service lamalibre-lamaste-serverd is active  

## Self-signed certificates exist

✅ `08:55:53` Certificate exists: /etc/lamalibre/lamaste/pki/ca.crt  
✅ `08:55:53` Certificate exists: /etc/lamalibre/lamaste/pki/ca.key  
✅ `08:55:53` Certificate exists: /etc/lamalibre/lamaste/pki/client.crt  
✅ `08:55:53` Certificate exists: /etc/lamalibre/lamaste/pki/client.key  
✅ `08:55:53` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed.pem  
✅ `08:55:53` Certificate exists: /etc/lamalibre/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `08:55:53` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `08:56:09` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `08:56:09` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `08:56:09` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `08:56:09` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

