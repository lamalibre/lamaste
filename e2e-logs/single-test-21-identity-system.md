# Lamaste E2E: 21 — Identity System

> Started at `2026-03-30 13:08:09 UTC`


## Pre-flight: check onboarding is complete


## GET /api/identity/users (admin)

✅ `13:08:09` GET /api/identity/users returns { users: [...] } array (count: 2)  
✅ `13:08:09` User object has 'username' field  
✅ `13:08:09` User object has 'displayname' field  
✅ `13:08:09` User object has 'email' field  
✅ `13:08:09` User object has 'groups' field  
✅ `13:08:09` No 'password' field in identity users response  
✅ `13:08:09` No bcrypt hash in identity users response  

## GET /api/identity/users/:username (admin)

✅ `13:08:09` Single user lookup returns correct username  
✅ `13:08:09` Single user lookup returns 200  
✅ `13:08:09` Nonexistent user returns 404  

## GET /api/identity/groups (admin)

✅ `13:08:09` GET /api/identity/groups returns { groups: [...] } array (count: 1)  
ℹ️ `13:08:09` Only 1 group(s) — sort order trivially correct  
✅ `13:08:09` Groups endpoint matches groups extracted from user list  

## GET /api/identity/self (admin, mTLS vhost)

✅ `13:08:09` identity/self returns 400 with appropriate message on mTLS vhost  
✅ `13:08:09` identity/self returns HTTP 400 on mTLS vhost  

## Input validation — invalid username parameter

✅ `13:08:09` Username with special characters returns 400  
✅ `13:08:09` Username with path traversal returns 400  
✅ `13:08:09` Nonexistent identity sub-path returns 404  

## identity:query capability gating

✅ `13:08:10` Agent cert without identity:query created  
✅ `13:08:10` Extracted agent PEM cert and key from .p12  
✅ `13:08:10` Agent without identity:query gets 403 on /api/identity/users  
✅ `13:08:10` Agent without identity:query gets 403 on /api/identity/groups  
✅ `13:08:10` Agent capabilities updated to include identity:query  
✅ `13:08:10` Agent with identity:query gets 200 on /api/identity/users  
✅ `13:08:10` Agent with identity:query gets 200 on /api/identity/groups  

## Reserved API prefix: 'identity' in RESERVED_API_PREFIXES

✅ `13:08:10` 'identity' prefix is reserved (ticket scope registration rejected with HTTP 400)  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `25` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `25` |

ℹ️ `13:08:10` Cleaning up identity test resources...  
