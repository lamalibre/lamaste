# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-26 10:47:53 UTC`


## Onboarding status

✅ `10:47:53` Onboarding status is COMPLETED  
✅ `10:47:53` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `10:47:53` Service nginx is active  
✅ `10:47:53` Service chisel is active  
✅ `10:47:53` Service authelia is active  
✅ `10:47:54` Service portlama-panel is active  

## Self-signed certificates exist

✅ `10:47:54` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `10:47:54` Certificate exists: /etc/portlama/pki/ca.key  
✅ `10:47:54` Certificate exists: /etc/portlama/pki/client.crt  
✅ `10:47:54` Certificate exists: /etc/portlama/pki/client.key  
✅ `10:47:54` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `10:47:54` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `10:47:54` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `10:47:54` DNS resolves test.portlama.local to 192.168.2.2  

## Agent VM connectivity

✅ `10:47:54` Agent VM can reach host VM at 192.168.2.2:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `10:47:55` Visitor VM can reach host VM at 192.168.2.2:9292 (HTTP 400)  
✅ `10:47:55` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `10:47:55` **Running: 02-tunnel-traffic.sh**  
