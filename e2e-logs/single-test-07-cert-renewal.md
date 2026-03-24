# Portlama E2E: 07 — Certificate Renewal

> Started at `2026-03-24 08:10:51 UTC`


## Pre-flight: check onboarding is complete


## List certificates

✅ `08:10:51` GET /api/certs returns 6 certificates  
✅ `08:10:51` Certificate has a type field  
✅ `08:10:51` Certificate has a domain field  
✅ `08:10:51` Certificate has an expiresAt field  
✅ `08:10:51` Certificate has numeric daysUntilExpiry: 89  

## Force renew certificate

⏭️ `08:10:51` Certificate renewal requires real Let's Encrypt — skipping  

## Renew nonexistent certificate

⏭️ `08:10:51` Certbot test requires real infrastructure — skipping  

## Auto-renew timer status

✅ `08:10:51` Certbot auto-renew timer is active  
✅ `08:10:51` Auto-renew has a next run time  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `7` |
| **Failed** | `0` |
| **Skipped** | `2` |
| **Total** | `9` |

