# MANDATE Protocol Status

This page prevents protocol-name drift and over-claiming. Each protocol is classified by what the repository actually implements today.

| Protocol / surface | Current status | What MANDATE currently does | What is not claimed |
|---|---|---|---|
| Native MANDATE | **Implemented** | Shared protocol-neutral commerce and authorization model; deterministic gateway flow; versioned agent capability discovery; bound checkout authorization artifacts; Ed25519 user-mandate verification path. | No external standard certification. |
| ACP | **Adapter target** | Capability document advertises the integration target; a working checkout-session adapter exists with idempotency/versioning and a deterministic MANDATE authorization boundary is available behind the adapter. | No claim of external ACP wire-level authorization interoperability yet. |
| AP2 | **Semantic alignment target** | Checkout/payment mandate concepts, cart binding and gateway authorization artifacts are modeled for a later external credential adapter. | No claim of AP2 credential or signature interoperability yet. |
| NPCI UAP | **Research / adapter-ready** | Delegated authority concepts are modeled and the capability registry can advertise future UAP support without granting it execution authority. | No claim of native UAP implementation; no public authoritative UAP specification was available during the current research pass. |
| x402 | **Implemented; Phase 10 experiment** | A standalone x402 v2 agent-service resource server emits `PAYMENT-REQUIRED`, accepts `PAYMENT-SIGNATURE`, verifies/settles through a configured facilitator, and enforces a signed MANDATE service authorization before settlement. | No claim that the repository is the x402 reference implementation; no claim of a completed live testnet settlement until configured and exercised. |
| Razorpay Test Mode | **Implemented; Phase 8 UPI golden run in progress** | Real Orders, Standard Checkout, payment retrieval/capture, server-side checkout signature verification and signed webhooks. The flagship buyer flow routes payment-order creation through the mandate-gated gateway boundary. | The repository does not claim that a real UPI success/failure transaction has been executed until the Test Mode flow is exercised with configured credentials. Test Mode is not production payment processing. |
| MANDATE MCP Policy Facade | **Implemented; Phase 9 experiment** | Exposes an MCP-compatible `/mcp` JSON-RPC tool surface for guarded Razorpay order/payment operations, with the current stateless `2026-07-28` transport and explicit 2025 compatibility. Payment-changing tools terminate at MANDATE authorization and call the existing gateway rather than Razorpay directly. | Not the official Razorpay MCP server; no claim of full external MCP certification or direct upstream Razorpay MCP interoperability. |

## Phase progression

```text
Phase 1  → shared semantic model                    DONE
Phase 2  → agent identity + capabilities             DONE
Phase 3  → ACP checkout adapter                      DONE
Phase 4A → deterministic bound mandate artifacts     DONE
Phase 4B → Ed25519 user credential verification      DONE (gateway/core)
Phase 4C → production credential issuance ceremony   PARTIAL / NOT CLAIMED
Phase 5  → autonomous bounded agent                  DONE
Phase 6  → buyer ↔ merchant agent negotiation        DONE
Phase 7  → campaign / growth orchestrator            DONE (growth opportunity loop)
Phase 8  → Razorpay Test Mode UPI golden run          IN PROGRESS
Phase 9  → guarded Razorpay MCP policy facade         IMPLEMENTED EXPERIMENT
Phase 10 → x402 agent-to-service experiment           IMPLEMENTED EXPERIMENT
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

Phase 4C remains intentionally limited to demo-safe issuance and does not claim a production credential-issuance ceremony, hardware-backed key storage, identity-provider integration, or external protocol credential interoperability.

## Phase 5 / 6 / 7 evidence

Delegated mandates support per-purchase and total budgets, merchant/product allow-lists, expiry, revocation, atomic PostgreSQL reservation, autonomous execution and settlement.

Negotiation adds buyer-agent ↔ merchant-agent intent/offer exchange, signed merchant offer attestations, authoritative quote revalidation, durable negotiation sessions and single-writer acceptance idempotency.

Growth opportunities combine merchant-controlled recommendation logic with live bundle quotes and route approved baskets through the same policy/payment authority. Confirmed merchant orders are the source of realized revenue attribution.

## Phase 8 evidence

The flagship `/negotiation` flow now performs:

```text
buyer agent intent
→ merchant-agent offers
→ signed offer verification
→ delegated mandate acceptance
→ mandate-gated Razorpay order
→ Standard Checkout
→ server-side payment signature verification
→ bounded webhook/API reconciliation polling
→ merchant-order confirmation
```

For the real Test Mode UPI proof, use Razorpay's documented test identifiers:

```text
success@razorpay  → successful UPI test payment
failure@razorpay  → failed UPI test payment
```

The repository's synthetic webhook replay lab remains explicitly labeled as a security simulation. It does not stand in for a real Razorpay payment event.

## Phase 9 evidence

The gateway workspace includes:

```text
apps/gateway/src/mcp-server.ts
apps/gateway/src/mcp-server.test.ts
docs/RAZORPAY-MCP.md
```

The facade supports MCP `2026-07-28` stateless requests and explicit compatibility for older 2025 revisions. Modern requests use the protocol-version, method and tool-name headers required by the current transport. It provides:

```text
server/discover
tools/list
tools/call
ping
```

and guarded operations:

```text
mandate_razorpay_create_order
mandate_razorpay_fetch_order
mandate_razorpay_fetch_payment
mandate_razorpay_capture_payment
```

Payment-changing operations require a valid MANDATE authorization ID and transaction binding. The MCP service sends trusted internal requests to the gateway; it does not hold or expose Razorpay API secrets to the agent.

Local Compose exposes the facade at:

```text
http://localhost:4100/mcp
```

with bearer authentication through `MCP_AGENT_TOKEN` in production.

The buyer-facing `/mcp` lab demonstrates unauthenticated rejection, current-protocol discovery, guarded tool enumeration and an authorization-bound payment attempt that fails closed without a MANDATE authorization.

## Phase 10 evidence

The x402 experiment is implemented under `apps/service`:

```text
apps/service/src/x402.ts
apps/service/src/server.ts
apps/service/src/x402.test.ts
docs/X402-AGENT-SERVICE.md
```

The resource server implements the x402 v2 HTTP exchange:

```text
GET /resource without payment
→ HTTP 402
→ PAYMENT-REQUIRED: Base64(PaymentRequired v2)

retry with PAYMENT-SIGNATURE
→ decode + validate x402 v2 payment requirements
→ validate signed MANDATE service authorization
→ facilitator /verify
→ facilitator /settle
→ PAYMENT-RESPONSE
→ HTTP 200 resource
```

MANDATE service authority binds the service ID, network, asset, recipient, maximum atomic amount, expiry and nonce. The replay key is consumed only after successful settlement. The service uses the configured facilitator for actual x402 verification/settlement; it does not pretend an unconfigured local payment is real.

The Compose stack exposes the experimental resource server at:

```text
http://localhost:4021/resource
```

and the buyer-facing `/x402` lab demonstrates the initial 402 challenge. 

## Rule for upgrading a status

A protocol can move from **target / aligned / ready** to **implemented** only after:

1. the repository contains the relevant wire-format adapter;
2. external payloads are validated at runtime;
3. the adapter maps into the MANDATE authorization core;
4. the integration is exercised with a real compatible endpoint or official test environment; and
5. the result is documented with reproducible evidence.

This keeps the submission ambitious without making claims the code cannot support.
