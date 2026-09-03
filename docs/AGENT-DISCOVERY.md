# MANDATE Agent Discovery

Phase 2 makes the merchant discoverable to software agents using a versioned capability document backed by the real merchant implementation.

## Discovery sequence

```text
Buyer Agent
    │
    │ GET /.well-known/agent-commerce
    ▼
Merchant manifest
    │
    │ GET /api/agent/capabilities?version=1.0
    ▼
Versioned capability document
    │
    ├── merchant identity
    ├── agent identity
    ├── commerce capabilities
    ├── protocol support/status
    ├── endpoint descriptors
    └── Razorpay Test Mode capabilities
            │
            ▼
Buyer validates document
            │
            ▼
selects genuinely usable protocol
            │
            ▼
MANDATE checkout / authorization core
```

## Current merchant agent

The current merchant is **Mandate Market** with a stable merchant agent identifier:

```text
mandate-market-agent-v1
```

The public capability surface describes the merchant's actual interfaces for catalog, product lookup, inventory, checkout preview, quote retrieval, recommendations and gateway-authorized order confirmation.

## Protocol status semantics

The capability document deliberately distinguishes protocol maturity:

| Status | Meaning |
|---|---|
| `implemented` | MANDATE can use the capability in the current stack. |
| `compatible` | A usable compatibility surface exists and is exercised. |
| `adapter-ready` | Internal boundary exists, but external interoperability is not claimed. |
| `research` | Protocol concepts are being studied; not offered as executable support. |
| `unsupported` | Explicitly unavailable. |

The buyer's protocol selector only considers `implemented` and `compatible` entries. It will never select an adapter-ready or research-only protocol as though it were interoperable.

## Version negotiation

The capability document currently exposes schema version `1.0`.

```text
GET /api/agent/capabilities?version=1.0
```

A request for an unsupported version returns `406 Not Acceptable` with the supported versions instead of silently returning a different contract.

The legacy `.well-known/agent-commerce` endpoint remains backward compatible and advertises the richer capability endpoint through an HTTP `Link` relation.

## Payment boundary

Capability discovery is descriptive only.

```text
capability discovery
       ≠
payment authorization
```

Discovering that the merchant supports Razorpay does not grant the agent authority to create a payment. The buyer still has to construct a commerce intent and eventually pass through the deterministic MANDATE gateway policy.

## Real-data rule

The capability document is generated from the merchant's actual runtime contract. It does not contain invented products, inventory counts, prices or payment results.

Synthetic data is reserved for the separate security labs where tampering/replay behavior is deliberately exercised.

## Judge surface

The running buyer includes:

```text
/capabilities
```

The page performs the actual discovery handshake through the buyer proxy and displays:

- merchant identity;
- merchant agent identity;
- supported protocol status;
- real commerce endpoints;
- payment capabilities;
- selected protocol;
- explicit separation between discovery and payment authority.

This gives a reviewer a visible demonstration of the same contract consumed programmatically by the buyer backend.
