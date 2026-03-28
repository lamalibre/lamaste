# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-28 16:09:22 UTC`


## Onboarding status

✅ `16:09:22` Onboarding status is COMPLETED  
✅ `16:09:22` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `16:09:22` Service nginx is active  
✅ `16:09:23` Service chisel is active  
✅ `16:09:23` Service authelia is active  
✅ `16:09:23` Service portlama-panel is active  

## Self-signed certificates exist

✅ `16:09:23` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `16:09:23` Certificate exists: /etc/portlama/pki/ca.key  
✅ `16:09:23` Certificate exists: /etc/portlama/pki/client.crt  
✅ `16:09:23` Certificate exists: /etc/portlama/pki/client.key  
✅ `16:09:23` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `16:09:23` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `16:09:23` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `16:09:23` DNS resolves test.portlama.local to 192.168.2.9  

## Agent VM connectivity

✅ `16:09:24` Agent VM can reach host VM at 192.168.2.9:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `16:09:24` Visitor VM can reach host VM at 192.168.2.9:9292 (HTTP 400)  
✅ `16:09:24` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `16:09:24` **Running: 02-tunnel-traffic.sh**  
