# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-20 14:33:58 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `14:33:58` Current cert fingerprint: sha256 Fingerprint=95:E2:0E:2D:C0:62:F3:5D:5D:41:41:21:B9:72:75:F4:D1:8C:39:69:99:49:14:9F:34:54:8E:77:0C:A0:CE:B3  

## Rotate mTLS certificate

✅ `14:33:59` Rotation response contains p12 password  
✅ `14:33:59` Rotation response contains expiry: 2028-03-19T14:33:59.000Z  
ℹ️ `14:33:59` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `14:33:59` Downloaded client.p12 (HTTP 200)  
✅ `14:33:59` Downloaded file is a valid PKCS12  
ℹ️ `14:33:59` New cert fingerprint: sha256 Fingerprint=27:E5:A0:3A:36:5F:DC:9B:5B:EC:0A:4E:46:CF:8A:BE:5E:14:21:E7:BA:5B:E5:67:E7:08:2B:2A:E1:C9:DE:3B  
✅ `14:33:59` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `14:33:59` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

