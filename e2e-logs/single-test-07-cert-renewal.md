# Portlama E2E: 07 — Certificate Renewal

> Started at `2026-03-22 18:24:57 UTC`


## Pre-flight: check onboarding is complete


## List certificates

✅ `18:24:57` GET /api/certs returns 6 certificates  
✅ `18:24:57` Certificate has a type field  
✅ `18:24:57` Certificate has a domain field  
✅ `18:24:57` Certificate has an expiresAt field  
✅ `18:24:57` Certificate has numeric daysUntilExpiry: 89  

## Force renew certificate

⏭️ `18:24:57` Certificate renewal requires real Let's Encrypt — skipping  

## Renew nonexistent certificate

⏭️ `18:24:57` Certbot test requires real infrastructure — skipping  

## Auto-renew timer status

✅ `18:24:57` Certbot auto-renew timer is active  
✅ `18:24:57` Auto-renew has a next run time  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `7` |
| **Failed** | `0` |
| **Skipped** | `2` |
| **Total** | `9` |

