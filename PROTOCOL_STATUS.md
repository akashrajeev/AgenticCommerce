# MANDATE Protocol Status

This page prevents protocol-name drift and over-claiming. Each protocol is classified by what the repository actually implements today.

| Protocol / surface | Current status | What MANDATE currently does | What is not claimed |
|---|---|---|---|
| Native MANDATE | **Implemented** | Shared protocol-neutral commerce and authorization model; deterministic gateway flow; versioned agent capability discovery. | No external standard certification. |
| ACP | **Adapter target** | Capability document advertises the integration target; normalized checkout concepts exist for a future ACP adapter. | No claim of wire-level ACP interoperability yet. |
| AP2 | **Semantic alignment target** | Checkout/payment mandate concepts and cart binding are modeled for the later authorization phase. | No claim of AP2 credential or signature interoperability yet. |
| NPCI UAP | **Research / adapter-ready** | Delegated authority concepts are modeled and the capability registry can advertise future UAP support without granting it execution authority. | No claim of native UAP implementation; no public authoritative UAP specification was available during the current research pass. |
| x402 | **Adapter target** | Shared payment-authorization boundary is designed so an x402 service-payment adapter can terminate at the same policy core. | No x402 wire-level payment implementation yet. |
| Razorpay Test Mode | **Implemented and exercised** | Orders, Standard Checkout, payment retrieval/capture, server-side verification and webhooks. | Test Mode is not production payment processing. |

## Phase progression

```text
Phase 1  → shared semantic model                    DONE
Phase 2  → agent identity + capabilities             DONE
Phase 3  → ACP checkout adapter                      NEXT
Phase 4  → cryptographically bound mandates          PLANNED
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

The merchant now publishes a versioned capability document at:

```text
GET /api/agent/capabilities
GET /.well-known/agent-commerce
```

The buyer performs an actual server-side discovery handshake at:

```text
GET /api/agent/discovery
```

and selects the highest-priority protocol that is genuinely usable. At the current baseline, that is `mandate-native` v1.0. Adapter-ready or research-only protocols are intentionally not selected.

The buyer-facing `/capabilities` surface makes the discovery result inspectable without opening source code.

## Rule for upgrading a status

A protocol can move from **target / aligned / ready** to **implemented** only after:

1. the repository contains the relevant wire-format adapter;
2. external payloads are validated at runtime;
3. the adapter maps into the MANDATE authorization core;
4. the integration is exercised with a real compatible endpoint or official test environment; and
5. the result is documented with reproducible evidence.

This keeps the submission ambitious without making claims the code cannot support.
