# Portlama E2E: 08 — mTLS Rotation

> Started at `2026-03-26 10:46:35 UTC`


## Pre-flight: check onboarding is complete


## Current cert fingerprint (before rotation)

ℹ️ `10:46:35` Current cert fingerprint: sha256 Fingerprint=D2:40:A3:D2:54:D8:AD:D2:32:7B:29:B1:37:7E:E7:7A:CE:78:51:29:32:97:AE:DB:E5:D9:2A:87:7E:AE:28:EF  

## Rotate mTLS certificate

✅ `10:46:36` Rotation response contains p12 password  
✅ `10:46:36` Rotation response contains expiry: 2028-03-25T10:46:36.000Z  
ℹ️ `10:46:36` Rotation warning: Your current browser certificate is now invalid. Download and import the new certificate before closing this page.  

## Download rotated certificate

✅ `10:46:36` Downloaded client.p12 (HTTP 200)  
✅ `10:46:36` Downloaded file is a valid PKCS12  
ℹ️ `10:46:36` New cert fingerprint: sha256 Fingerprint=9E:F6:AC:C6:D9:B3:7D:BB:53:52:A7:06:94:F3:E3:B7:EC:48:F8:7F:65:31:7C:15:32:7F:D6:2B:90:B4:42:EF  
✅ `10:46:36` New cert has different fingerprint than old cert  

## Verify API access with current credentials

✅ `10:46:37` API still accessible after rotation  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `6` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `6` |

