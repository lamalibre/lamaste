# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-22 18:24:57 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `18:24:57` Current cert fingerprint: sha256 Fingerprint=3D:51:FD:3F:AB:80:8D:7F:CA:36:8E:B6:1F:B6:A9:F4:11:2B:C0:51:D1:96:6A:4F:DD:08:76:EE:34:BA:1B:6D  

## Rotate mTLS certificate

✅ `18:24:57` Rotation response contains p12 password  
✅ `18:24:57` Rotation response contains expiry: 2028-03-21T18:24:57.000Z  
ℹ️ `18:24:57` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `18:24:58` Downloaded client.p12 (HTTP 200)  
✅ `18:24:58` Downloaded file is a valid PKCS12  
ℹ️ `18:24:58` New cert fingerprint: sha256 Fingerprint=53:47:18:76:38:75:43:18:C5:12:F8:8C:C0:61:19:3A:CF:A6:CB:09:9A:A1:3D:24:EB:E1:5F:BD:2D:65:49:D1  
✅ `18:24:58` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `18:24:58` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

