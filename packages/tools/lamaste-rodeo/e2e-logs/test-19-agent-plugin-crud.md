# Lamaste E2E: 19 — Agent Plugin CRUD

> Started at `2026-10-13 11:51:03 UTC`


## Pre-flight: check onboarding is complete

✅ `11:51:03` Onboarding is complete  

## Start agent panel service

✅ `11:51:04` lamaste-agentd is installed on the agent VM  
✅ `11:51:05` Agent panel started on port 9393  

## GET /plugins — empty list

✅ `11:51:05` Plugin list is initially empty  

## Install validation — missing body

✅ `11:51:05` Install without packageName returns 400  

## Install validation — non-lamalibre scope

✅ `11:51:05` Install with non-@lamalibre/ scope returns 400  

## Plugin name validation — reserved names

✅ `11:51:05` Reserved name 'plugins' rejected  
✅ `11:51:06` Reserved name 'agents' rejected  

## Plugin name validation — invalid characters

✅ `11:51:06` Name with dots rejected  
✅ `11:51:06` Name with slashes rejected  
✅ `11:51:06` Uppercase name rejected  

## Operations on nonexistent plugin

✅ `11:51:06` Enable nonexistent plugin returns 400  
✅ `11:51:06` Disable nonexistent plugin returns 400  
✅ `11:51:06` Delete nonexistent plugin returns 400  

## Check-update and bundle for nonexistent plugin

✅ `11:51:07` Check-update nonexistent returns 400  
✅ `11:51:07` Bundle nonexistent returns 404  

## Auth validation — requests without credentials

✅ `11:51:07` Request without credentials returns 401  
✅ `11:51:07` Health endpoint accessible without auth  

## Auth validation — wrong agent label

✅ `11:51:07` Request with wrong agent label returns 403  
✅ `11:51:07` Admin cert is allowed to access agent panel  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `20` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `20` |

