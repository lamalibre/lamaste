# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-22 18:25:33 UTC`


## Onboarding status

✅ `18:25:34` Onboarding status is COMPLETED  
✅ `18:25:34` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `18:25:34` Service nginx is active  
✅ `18:25:34` Service chisel is active  
✅ `18:25:34` Service authelia is active  
✅ `18:25:34` Service portlama-panel is active  

## Self-signed certificates exist

✅ `18:25:34` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `18:25:34` Certificate exists: /etc/portlama/pki/ca.key  
✅ `18:25:34` Certificate exists: /etc/portlama/pki/client.crt  
✅ `18:25:34` Certificate exists: /etc/portlama/pki/client.key  
✅ `18:25:34` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `18:25:34` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `18:25:34` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `18:25:34` DNS resolves test.portlama.local to 192.168.2.154  

## Agent VM connectivity

✅ `18:25:35` Agent VM can reach host VM at 192.168.2.154:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `18:25:35` Visitor VM can reach host VM at 192.168.2.154:9292 (HTTP 400)  
✅ `18:25:35` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `18:25:35` **Running: 02-tunnel-traffic.sh**  
