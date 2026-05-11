# Lamaste E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-30 13:08:21 UTC`


## Onboarding status

✅ `13:08:21` Onboarding status is COMPLETED  
✅ `13:08:21` Domain is set in onboarding status: test.lamaste.local  

## Core services running

✅ `13:08:21` Service nginx is active  
✅ `13:08:21` Service chisel is active  
✅ `13:08:21` Service authelia is active  
✅ `13:08:21` Service lamaste-panel is active  

## Self-signed certificates exist

✅ `13:08:21` Certificate exists: /etc/lamaste/pki/ca.crt  
✅ `13:08:21` Certificate exists: /etc/lamaste/pki/ca.key  
✅ `13:08:21` Certificate exists: /etc/lamaste/pki/client.crt  
✅ `13:08:21` Certificate exists: /etc/lamaste/pki/client.key  
✅ `13:08:21` Certificate exists: /etc/lamaste/pki/self-signed.pem  
✅ `13:08:21` Certificate exists: /etc/lamaste/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `13:08:22` Panel accessible via https://panel.test.lamaste.local (HTTP 200)  

## DNS resolution

✅ `13:08:37` DNS resolves test.lamaste.local to 10.13.37.1 (from host VM)  

## Agent VM connectivity

✅ `13:08:37` Agent VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `13:08:37` Visitor VM can reach host VM at 10.13.37.1:9292 (HTTP 400)  
✅ `13:08:37` Visitor VM can reach Authelia at auth.test.lamaste.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `13:08:37` **Running: 02-tunnel-traffic.sh**  
