# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-19 12:17:58 UTC`


## Onboarding status

✅ `12:17:58` Onboarding status is COMPLETED  
✅ `12:17:58` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `12:17:58` Service nginx is active  
✅ `12:17:59` Service chisel is active  
✅ `12:17:59` Service authelia is active  
✅ `12:17:59` Service portlama-panel is active  

## Self-signed certificates exist

✅ `12:17:59` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `12:17:59` Certificate exists: /etc/portlama/pki/ca.key  
✅ `12:17:59` Certificate exists: /etc/portlama/pki/client.crt  
✅ `12:17:59` Certificate exists: /etc/portlama/pki/client.key  
✅ `12:17:59` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `12:17:59` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `12:17:59` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `12:17:59` DNS resolves test.portlama.local to 192.168.2.85  

## Agent VM connectivity

✅ `12:18:00` Agent VM can reach host VM at 192.168.2.85:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `12:18:00` Visitor VM can reach host VM at 192.168.2.85:9292 (HTTP 400)  
✅ `12:18:00` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `12:18:00` **Running: 02-tunnel-traffic.sh**  
