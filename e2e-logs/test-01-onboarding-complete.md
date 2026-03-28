# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-28 22:39:59 UTC`


## Onboarding status

✅ `22:39:59` Onboarding status is COMPLETED  
✅ `22:39:59` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `22:40:00` Service nginx is active  
✅ `22:40:00` Service chisel is active  
✅ `22:40:00` Service authelia is active  
✅ `22:40:00` Service portlama-panel is active  

## Self-signed certificates exist

✅ `22:40:00` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `22:40:00` Certificate exists: /etc/portlama/pki/ca.key  
✅ `22:40:00` Certificate exists: /etc/portlama/pki/client.crt  
✅ `22:40:00` Certificate exists: /etc/portlama/pki/client.key  
✅ `22:40:00` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `22:40:00` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `22:40:00` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `22:40:00` DNS resolves test.portlama.local to 192.168.2.9  

## Agent VM connectivity

✅ `22:40:01` Agent VM can reach host VM at 192.168.2.9:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `22:40:01` Visitor VM can reach host VM at 192.168.2.9:9292 (HTTP 400)  
✅ `22:40:01` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `22:40:01` **Running: 02-tunnel-traffic.sh**  
