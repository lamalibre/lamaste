# Lamaste E2E: 08 — mTLS Rotation

> Started at `2026-03-30 13:06:45 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `13:06:45` Current cert fingerprint: sha256 Fingerprint=8D:54:F0:97:FC:BF:FB:24:E2:08:79:4D:32:97:91:21:E3:8B:5E:A0:19:60:5F:41:99:B2:9B:D5:1A:F3:8D:D9  

## Rotate mTLS certificate

✅ `13:06:46` Rotation response contains p12 password  
✅ `13:06:46` Rotation response contains expiry: 2028-03-29T13:06:46.000Z  
ℹ️ `13:06:46` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `13:06:46` Downloaded client.p12 (HTTP 200)  
✅ `13:06:46` Downloaded file is a valid PKCS12  
ℹ️ `13:06:46` New cert fingerprint: sha256 Fingerprint=07:F9:91:82:D0:73:CA:C0:2E:35:1C:D1:BA:FA:72:3D:5C:F6:0F:30:5C:45:EB:53:0C:59:10:4D:3F:9A:28:0B  
✅ `13:06:46` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `13:06:46` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

