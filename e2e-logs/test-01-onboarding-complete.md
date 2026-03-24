# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-24 08:11:27 UTC`


## Onboarding status

✅ `08:11:28` Onboarding status is COMPLETED  
✅ `08:11:28` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `08:11:28` Service nginx is active  
✅ `08:11:28` Service chisel is active  
✅ `08:11:28` Service authelia is active  
✅ `08:11:28` Service portlama-panel is active  

## Self-signed certificates exist

✅ `08:11:28` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `08:11:28` Certificate exists: /etc/portlama/pki/ca.key  
✅ `08:11:28` Certificate exists: /etc/portlama/pki/client.crt  
✅ `08:11:28` Certificate exists: /etc/portlama/pki/client.key  
✅ `08:11:28` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `08:11:28` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `08:11:29` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `08:11:29` DNS resolves test.portlama.local to 192.168.2.206  

## Agent VM connectivity

✅ `08:11:29` Agent VM can reach host VM at 192.168.2.206:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `08:11:29` Visitor VM can reach host VM at 192.168.2.206:9292 (HTTP 400)  
✅ `08:11:29` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `08:11:29` **Running: 02-tunnel-traffic.sh**  
