# Portlama E2E: 07 — Certificate Renewal

> Started at `2026-03-20 14:33:58 UTC`


## Pre-flight: check onboarding is complete


## List certificates

✅ `14:33:58` GET /api/certs returns 6 certificates  
✅ `14:33:58` Certificate has a type field  
✅ `14:33:58` Certificate has a domain field  
✅ `14:33:58` Certificate has an expiresAt field  
✅ `14:33:58` Certificate has numeric daysUntilExpiry: 89  

## Force renew certificate

⏭️ `14:33:58` Certificate renewal requires real Let's Encrypt — skipping  

## Renew nonexistent certificate

⏭️ `14:33:58` Certbot test requires real infrastructure — skipping  

## Auto-renew timer status

✅ `14:33:58` Certbot auto-renew timer is active  
✅ `14:33:58` Auto-renew has a next run time  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `7` |
| **Failed** | `0` |
| **Skipped** | `2` |
| **Total** | `9` |

