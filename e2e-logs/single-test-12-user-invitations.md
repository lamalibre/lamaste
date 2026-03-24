# Portlama E2E: 12 — User Invitations

> Started at `2026-03-24 09:37:59 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `09:37:59` Invitation creation returned ok: true  
✅ `09:37:59` Invitation username matches  
✅ `09:37:59` Invitation email matches  
✅ `09:37:59` Invitation token is valid 64-char hex  
✅ `09:37:59` Invitation ID is present  
✅ `09:37:59` Invitation createdAt is present  
✅ `09:37:59` Invitation expiresAt is present  

## List invitations

✅ `09:37:59` Invitation appears in GET /api/invitations  
✅ `09:37:59` Token is not exposed in invitation list  
✅ `09:37:59` Invitation status is pending  

## Duplicate invitation

✅ `09:37:59` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `09:38:00` Incomplete invitation data rejected (HTTP 400)  
✅ `09:38:00` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `09:38:00` Public invite details show username  
✅ `09:38:00` Public invite details show email  
✅ `09:38:00` Public invite details show expiresAt  

## Invalid token

✅ `09:38:00` Accept with invalid token returns 404  
✅ `09:38:00` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `09:38:02` Invitation acceptance returned ok: true  
✅ `09:38:02` Accepted username matches  

## Verify invited user exists

✅ `09:38:02` Invited user appears in GET /api/users  
✅ `09:38:02` Invited user email matches  

## Invitation marked as accepted

✅ `09:38:02` Invitation status changed to accepted  

## Used token rejection

✅ `09:38:02` Reusing accepted token returns 410 Gone  
✅ `09:38:02` GET on used token returns 410 Gone  

## Accept with short password

✅ `09:38:02` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `09:38:04` Invited user deletion returned ok: true  
✅ `09:38:04` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

