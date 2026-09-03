# MANDATE Protocol Status

This page prevents protocol-name drift and over-claiming. Each protocol is classified by what the repository actually implements today.

| Protocol / surface | Current status | What MANDATE currently does | What is not claimed |
|---|---|---|---|
| Native MANDATE | **Implemented** | Shared protocol-neutral commerce and authorization model; deterministic gateway flow; versioned agent capability discovery; bound checkout authorization artifacts; Ed25519 user-mandate verification path. | No external standard certification. |
| ACP | **Adapter target** | Capability document advertises the integration target; a working checkout-session adapter exists with idempotency/versioning and a deterministic MANDATE authorization boundary is available behind the adapter. | No claim of external ACP wire-level authorization interoperability yet. |
| AP2 | **Semantic alignment target** | Checkout/payment mandate concepts, cart binding and gateway authorization artifacts are modeled for a later external credential adapter. | No claim of AP2 credential or signature interoperability yet. |
| NPCI UAP | **Research / adapter-ready** | Delegated authority concepts are modeled and the capability registry can advertise future UAP support without granting it execution authority. | No claim of native UAP implementation; no public authoritative UAP specification was available during the current research pass. |
| x402 | **Adapter target** | Shared payment-authorization boundary is designed so an x402 service-payment adapter can terminate at the same policy core. | No x402 wire-level payment implementation yet. |
| Razorpay Test Mode | **Implemented and exercised** | Orders, Standard Checkout, payment retrieval/capture, server-side verification and webhooks. | Test Mode is not production payment processing. |

## Phase progression

```text
Phase 1  → shared semantic model                    DONE
Phase 2  → agent identity + capabilities             DONE
Phase 3  → ACP checkout adapter                      DONE
Phase 4A → deterministic bound mandate artifacts     DONE
Phase 4B → Ed25519 user credential verification      DONE (gateway/core)
Phase 4C → user-facing credential issuance + UI      NEXT
Phase 5  → autonomous bounded agent                  PLANNED
Phase 6  → buyer ↔ merchant agent negotiation        PLANNED
Phase 7  → campaign orchestrator                     PLANNED
Phase 8  → Razorpay Test Mode UPI golden run          PLANNED
Phase 9  → Razorpay MCP behind MANDATE authorization  PLANNED
Phase 10 → x402 agent-to-service experiment           PLANNED
Phase 11 → UAP adapter-ready / later integration      PLANNED
Phase 12 → unified multi-protocol demo                PLANNED
```

## Phase 2 evidence

The merchant publishes a versioned capability document at:

```text
GET /api/agent/capabilities
GET /.well-known/agent-commerce
```

The buyer performs an actual server-side discovery handshake at:

```text
GET /api/agent/discovery
```

and selects the highest-priority protocol that is genuinely usable. Adapter-ready or research-only protocols are intentionally not selected.

The buyer-facing `/capabilities` surface makes the discovery result inspectable without opening source code.

## Phase 3 / 4 evidence

ACP checkout sessions are exposed through the merchant adapter with versioned requests, required idempotency keys, fresh authoritative quotes, update/cancel lifecycle handling and a completion boundary that refuses to bypass MANDATE authorization.

Phase 4A/4B adds:

```text
apps/gateway/src/mandate-authorization.ts
apps/gateway/src/mandate-authorization.test.ts
apps/gateway/src/mandate-credentials.ts
apps/gateway/src/mandate-credentials.test.ts
docs/MANDATE-AUTHORIZATION.md
```

The signed path verifies an Ed25519 user credential, binds the mandate to a canonical checkout, reruns the gateway's merchant-truth policy checks, and records the resulting authorization artifact in the transaction audit trail. The gateway exposes the internal authorization boundary at `POST /v1/mandates/authorize`.

Phase 4C remains intentionally separate: the repository does not yet claim a production credential-issuance ceremony, hardware-backed key storage, identity-provider integration, or external protocol credential interoperability.

## Rule for upgrading a status

A protocol can move from **target / aligned / ready** to **implemented** only after:

1. the repository contains the relevant wire-format adapter;
2. external payloads are validated at runtime;
3. the adapter maps into the MANDATE authorization core;
4. the integration is exercised with a real compatible endpoint or official test environment; and
5. the result is documented with reproducible evidence.

This keeps the submission ambitious without making claims the code cannot support.
