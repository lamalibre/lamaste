# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-29 09:08:15 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `09:08:15` Current cert fingerprint: sha256 Fingerprint=14:C1:AC:66:8E:9B:9B:1F:F7:0A:C4:DF:42:B5:03:7B:0D:F6:6D:BF:EA:F0:79:BE:AB:B1:7F:4A:F3:97:7D:AA  

## Rotate mTLS certificate

✅ `09:08:17` Rotation response contains p12 password  
✅ `09:08:17` Rotation response contains expiry: 2028-03-28T09:08:17.000Z  
ℹ️ `09:08:17` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `09:08:17` Downloaded client.p12 (HTTP 200)  
✅ `09:08:17` Downloaded file is a valid PKCS12  
ℹ️ `09:08:17` New cert fingerprint: sha256 Fingerprint=A4:B8:4B:79:9F:68:75:E7:65:F8:0A:1E:10:E5:3A:3C:62:E6:41:F7:C4:49:5C:B3:52:8F:3A:71:C4:62:62:E9  
✅ `09:08:17` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `09:08:17` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

