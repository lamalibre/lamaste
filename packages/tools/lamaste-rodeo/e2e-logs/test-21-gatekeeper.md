# Lamaste E2E: 21 — Gatekeeper Authorization (Three-VM)

> Started at `2026-11-09 12:43:34 UTC`


## Pre-flight

✅ `12:43:34` Onboarding is complete  
✅ `12:43:34` Gatekeeper proxy available  
✅ `12:43:34` Gatekeeper service healthy on port 9294  
✅ `12:43:34` Gatekeeper API secret file exists  
✅ `12:43:34` Gatekeeper secret file has 0600 permissions  

## 1. Group CRUD

✅ `12:43:34` Create group three-vm-devs  
✅ `12:43:34` Create group three-vm-ops  
✅ `12:43:35` Group three-vm-devs has 2 members  

## 2. Grant CRUD and Access Checks

✅ `12:43:35` Create user grant (alice → tunnel-001)  
✅ `12:43:35` Create group grant (three-vm-ops → tunnel-002)  
✅ `12:43:35` Alice has access via direct grant  
✅ `12:43:35` Charlie has access via group grant  
✅ `12:43:35` Bob denied (not in three-vm-ops)  

## 3. Settings and Cache

✅ `12:43:35` Access logging enabled  
✅ `12:43:36` Cache bust  

## 4. Group Cascade Delete

✅ `12:43:36` Cascade deleted 1 grant(s) on group deletion  
✅ `12:43:36` Charlie denied after group deletion  

## 5. Gatekeeper API Secret Enforcement

✅ `12:43:36` Direct gatekeeper API access without secret rejected  

## 6. Cleanup

ℹ️ `12:43:36` Cleanup complete  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `18` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `18` |

