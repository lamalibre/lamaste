# Portlama E2E: 12 — User Invitations

> Started at `2026-03-20 14:34:13 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `14:34:13` Invitation creation returned ok: true  
✅ `14:34:13` Invitation username matches  
✅ `14:34:13` Invitation email matches  
✅ `14:34:13` Invitation token is valid 64-char hex  
✅ `14:34:13` Invitation ID is present  
✅ `14:34:13` Invitation createdAt is present  
✅ `14:34:13` Invitation expiresAt is present  

## List invitations

✅ `14:34:13` Invitation appears in GET /api/invitations  
✅ `14:34:13` Token is not exposed in invitation list  
✅ `14:34:13` Invitation status is pending  

## Duplicate invitation

✅ `14:34:13` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `14:34:13` Incomplete invitation data rejected (HTTP 400)  
✅ `14:34:13` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `14:34:13` Public invite details show username  
✅ `14:34:13` Public invite details show email  
✅ `14:34:13` Public invite details show expiresAt  

## Invalid token

✅ `14:34:13` Accept with invalid token returns 404  
✅ `14:34:13` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `14:34:15` Invitation acceptance returned ok: true  
✅ `14:34:15` Accepted username matches  

## Verify invited user exists

✅ `14:34:15` Invited user appears in GET /api/users  
✅ `14:34:15` Invited user email matches  

## Invitation marked as accepted

✅ `14:34:15` Invitation status changed to accepted  

## Used token rejection

✅ `14:34:15` Reusing accepted token returns 410 Gone  
✅ `14:34:15` GET on used token returns 410 Gone  

## Accept with short password

✅ `14:34:16` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `14:34:18` Invited user deletion returned ok: true  
✅ `14:34:18` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

