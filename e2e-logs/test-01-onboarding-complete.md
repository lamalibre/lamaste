# Portlama E2E: 01 — Onboarding Complete Verification (Three-VM)

> Started at `2026-03-20 14:34:29 UTC`


## Onboarding status

✅ `14:34:29` Onboarding status is COMPLETED  
✅ `14:34:29` Domain is set in onboarding status: test.portlama.local  

## Core services running

✅ `14:34:29` Service nginx is active  
✅ `14:34:29` Service chisel is active  
✅ `14:34:29` Service authelia is active  
✅ `14:34:29` Service portlama-panel is active  

## Self-signed certificates exist

✅ `14:34:29` Certificate exists: /etc/portlama/pki/ca.crt  
✅ `14:34:29` Certificate exists: /etc/portlama/pki/ca.key  
✅ `14:34:30` Certificate exists: /etc/portlama/pki/client.crt  
✅ `14:34:30` Certificate exists: /etc/portlama/pki/client.key  
✅ `14:34:30` Certificate exists: /etc/portlama/pki/self-signed.pem  
✅ `14:34:30` Certificate exists: /etc/portlama/pki/self-signed-key.pem  

## Panel accessible via domain (mTLS)

✅ `14:34:30` Panel accessible via https://panel.test.portlama.local (HTTP 200)  

## DNS resolution

✅ `14:34:30` DNS resolves test.portlama.local to 192.168.2.100  

## Agent VM connectivity

✅ `14:34:30` Agent VM can reach host VM at 192.168.2.100:9292 (HTTP 400)  

## Visitor VM connectivity

✅ `14:34:31` Visitor VM can reach host VM at 192.168.2.100:9292 (HTTP 400)  
✅ `14:34:31` Visitor VM can reach Authelia at auth.test.portlama.local (HTTP 200)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `17` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `17` |

🔵 `14:34:31` **Running: 02-tunnel-traffic.sh**  
