# Portlama E2E: 07 — Certificate Renewal

> Started at `2026-03-16 17:21:46 UTC`


## Pre-flight: check onboarding is complete


## List certificates

✅ `17:21:46` GET /api/certs returns 6 certificates  
✅ `17:21:46` Certificate has a type field  
✅ `17:21:46` Certificate has a domain field  
✅ `17:21:46` Certificate has an expiresAt field  
✅ `17:21:46` Certificate has numeric daysUntilExpiry: 89  

## Force renew certificate

⏭️ `17:21:46` Certificate renewal requires real Let's Encrypt — skipping  

## Renew nonexistent certificate

⏭️ `17:21:46` Certbot test requires real infrastructure — skipping  

## Auto-renew timer status

✅ `17:21:46` Certbot auto-renew timer is active  
✅ `17:21:46` Auto-renew has a next run time  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `7` |
| **Failed** | `0` |
| **Skipped** | `2` |
| **Total** | `9` |

