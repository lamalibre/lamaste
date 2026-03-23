# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-23 12:10:01 UTC`


## Onboarding status

✅ `12:10:02` Onboarding status is COMPLETED  
✅ `12:10:02` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `12:10:02` Service nginx is active  
✅ `12:10:02` Service chisel is active  
✅ `12:10:02` Service authelia is active  
✅ `12:10:02` Service portlama-panel is active  

## Self-signed certificates exist

✅ `12:10:02` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `12:10:02` Certificate exists: /etc/portlama/pki/ca.key  
✅ `12:10:02` Certificate exists: /etc/portlama/pki/client.crt  
✅ `12:10:02` Certificate exists: /etc/portlama/pki/client.key  
✅ `12:10:03` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `12:10:03` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `12:10:03` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `12:10:03` DNS resolves test.portlama.local to 192.168.2.187  

## Agent VM connectivity

✅ `12:10:03` Agent VM can reach host VM at 192.168.2.187:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `12:10:04` Visitor VM can reach host VM at 192.168.2.187:9292 (HTTP 400)  
✅ `12:10:04` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `12:10:04` **Running: 02-tunnel-traffic.sh**  
