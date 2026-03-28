# Portlama E2E: 12 — User Invitations

> Started at `2026-03-28 22:39:06 UTC`


## Pre-flight: check onboarding is complete


## Create invitation

✅ `22:39:06` Invitation creation returned ok: true  
✅ `22:39:06` Invitation username matches  
✅ `22:39:06` Invitation email matches  
✅ `22:39:06` Invitation token is valid 64-char hex  
✅ `22:39:06` Invitation ID is present  
✅ `22:39:06` Invitation createdAt is present  
✅ `22:39:06` Invitation expiresAt is present  

## List invitations

✅ `22:39:06` Invitation appears in GET /api/invitations  
✅ `22:39:06` Token is not exposed in invitation list  
✅ `22:39:06` Invitation status is pending  

## Duplicate invitation

✅ `22:39:06` Duplicate invitation for same username rejected (HTTP 409)  

## Validation: invalid input

✅ `22:39:06` Incomplete invitation data rejected (HTTP 400)  
✅ `22:39:06` Invalid email rejected (HTTP 400)  

## Get invitation details (public endpoint)

✅ `22:39:06` Public invite details show username  
✅ `22:39:06` Public invite details show email  
✅ `22:39:06` Public invite details show expiresAt  

## Invalid token

✅ `22:39:06` Accept with invalid token returns 404  
✅ `22:39:06` Malformed token rejected (HTTP 400)  

## Accept invitation (public endpoint)

✅ `22:39:09` Invitation acceptance returned ok: true  
✅ `22:39:09` Accepted username matches  

## Verify invited user exists

✅ `22:39:09` Invited user appears in GET /api/users  
✅ `22:39:09` Invited user email matches  

## Invitation marked as accepted

✅ `22:39:09` Invitation status changed to accepted  

## Used token rejection

✅ `22:39:09` Reusing accepted token returns 410 Gone  
✅ `22:39:09` GET on used token returns 410 Gone  

## Accept with short password

✅ `22:39:09` Short password rejected on invite accept (HTTP 400)  

## Cleanup: delete invited user

✅ `22:39:11` Invited user deletion returned ok: true  
✅ `22:39:11` Invited user no longer in list after deletion  

---

## Results

| Metric | Count |
|--------|-------|
| **Passed** | `28` |
| **Failed** | `0` |
| **Skipped** | `0` |
| **Total** | `28` |

