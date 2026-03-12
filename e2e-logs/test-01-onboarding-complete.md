# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-16 17:22:14 UTC`


## Onboarding status

✅ `17:22:14` Onboarding status is COMPLETED  
✅ `17:22:14` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `17:22:14` Service nginx is active  
✅ `17:22:14` Service chisel is active  
✅ `17:22:14` Service authelia is active  
✅ `17:22:14` Service portlama-panel is active  

## Self-signed certificates exist

✅ `17:22:14` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `17:22:14` Certificate exists: /etc/portlama/pki/ca.key  
✅ `17:22:14` Certificate exists: /etc/portlama/pki/client.crt  
✅ `17:22:14` Certificate exists: /etc/portlama/pki/client.key  
✅ `17:22:15` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `17:22:15` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `17:22:15` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `17:22:15` DNS resolves test.portlama.local to 192.168.2.64  

## Agent VM connectivity

✅ `17:22:15` Agent VM can reach host VM at 192.168.2.64:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `17:22:15` Visitor VM can reach host VM at 192.168.2.64:9292 (HTTP 400)  
✅ `17:22:15` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `17:22:15` **Running: 02-tunnel-traffic.sh**  
