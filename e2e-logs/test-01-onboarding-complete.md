# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-29 09:09:36 UTC`


## Onboarding status

✅ `09:09:37` Onboarding status is COMPLETED  
✅ `09:09:37` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `09:09:37` Service nginx is active  
✅ `09:09:37` Service chisel is active  
✅ `09:09:37` Service authelia is active  
✅ `09:09:37` Service portlama-panel is active  

## Self-signed certificates exist

✅ `09:09:37` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `09:09:37` Certificate exists: /etc/portlama/pki/ca.key  
✅ `09:09:37` Certificate exists: /etc/portlama/pki/client.crt  
✅ `09:09:37` Certificate exists: /etc/portlama/pki/client.key  
✅ `09:09:37` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `09:09:37` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `09:09:37` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `09:09:37` DNS resolves test.portlama.local to 192.168.2.15  

## Agent VM connectivity

✅ `09:09:38` Agent VM can reach host VM at 192.168.2.15:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `09:09:38` Visitor VM can reach host VM at 192.168.2.15:9292 (HTTP 400)  
✅ `09:09:38` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `09:09:38` **Running: 02-tunnel-traffic.sh**  
