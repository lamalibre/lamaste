# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-24 08:10:51 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `08:10:51` Current cert fingerprint: sha256 Fingerprint=F6:1E:9E:72:BA:0B:80:43:8D:1B:8F:B0:6B:B9:F5:21:B0:D6:E9:C7:71:7D:C8:46:B0:F8:07:7F:B6:96:72:78  

## Rotate mTLS certificate

✅ `08:10:52` Rotation response contains p12 password  
✅ `08:10:52` Rotation response contains expiry: 2028-03-23T08:10:52.000Z  
ℹ️ `08:10:52` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `08:10:52` Downloaded client.p12 (HTTP 200)  
✅ `08:10:52` Downloaded file is a valid PKCS12  
ℹ️ `08:10:52` New cert fingerprint: sha256 Fingerprint=74:20:91:F3:B2:2D:D9:5A:32:9C:57:3B:A0:AC:6E:FB:BF:FB:06:25:9D:BD:10:24:65:1E:4D:BF:71:F8:DA:71  
✅ `08:10:52` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `08:10:52` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

