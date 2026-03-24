# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-24 09:38:19 UTC`


## Onboarding status

✅ `09:38:20` Onboarding status is COMPLETED  
✅ `09:38:20` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `09:38:20` Service nginx is active  
✅ `09:38:20` Service chisel is active  
✅ `09:38:20` Service authelia is active  
✅ `09:38:20` Service portlama-panel is active  

## Self-signed certificates exist

✅ `09:38:20` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `09:38:20` Certificate exists: /etc/portlama/pki/ca.key  
✅ `09:38:20` Certificate exists: /etc/portlama/pki/client.crt  
✅ `09:38:20` Certificate exists: /etc/portlama/pki/client.key  
✅ `09:38:20` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `09:38:20` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `09:38:20` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `09:38:20` DNS resolves test.portlama.local to 192.168.2.217  

## Agent VM connectivity

✅ `09:38:21` Agent VM can reach host VM at 192.168.2.217:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `09:38:21` Visitor VM can reach host VM at 192.168.2.217:9292 (HTTP 400)  
✅ `09:38:21` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `09:38:21` **Running: 02-tunnel-traffic.sh**  
