# NPCI / UAP Readiness

## Position

**Phase 11 — research / adapter-ready.**

MANDATE does not claim to implement NPCI's Unified Agent Protocol (UAP) because a public authoritative UAP wire specification was not available in the current research pass.

The repository instead implements a typed delegation profile that can be mapped into the MANDATE authority core when an authoritative UAP specification and test environment are available.

## Verified NPCI delegation behavior

NPCI's UPI Circle IoT addendum describes delegation to software/device profiles and states that debit transactions using IoT are initiated only by explicit user action. It also specifies a maximum monthly limit of INR 15,000 per delegation and a maximum per-transaction limit of INR 5,000 for the IoT device/app/software profile.

MANDATE encodes those verified policy constraints in:

```text
apps/gateway/src/uap-profile.ts
apps/gateway/src/uap-profile.test.ts
```

## Adapter boundary

```text
UAP credential / request
        |
        v
NPCI delegation profile
  identity
  merchant scope
  domestic P2M context
  explicit user action
  per-transaction limit
  monthly limit
        |
        v
MANDATE authority core
        |
        v
existing delegated-mandate / gateway execution boundary
```

The profile deliberately returns `adapter-ready-not-native` and routes the execution authority to `mandate-native`. It does not fabricate UAP headers, signatures, endpoints or certification claims.

## Current executable status

The Phase 12 protocol registry therefore reports:

```text
NPCI UAP Profile → research-adapter-ready → not executable
```

The unified protocol resolver will not silently select it for a live payment.

## Evidence source

The current policy profile is derived from NPCI/UPI/2024-25/OC-201B, the addendum covering IoT devices/software under UPI Circle. The repository should only upgrade this profile to a native UAP adapter after an authoritative public UAP technical specification and a compatible test environment are available.
