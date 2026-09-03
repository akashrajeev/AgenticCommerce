# Unified Protocol Control Plane

## Purpose

Phase 12 makes the protocol layer inspectable as one product surface. The goal is not to claim that every protocol is production-integrated; it is to show that different agent-payment entry points terminate at one deterministic MANDATE authority boundary.

## Demo

Start the Compose stack:

```bash
docker compose up --build
```

Open:

```text
http://localhost:3001/protocols
```

The page shows the shared protocol registry and runtime state for the executable adapters.

## Four routes

### Merchant checkout

```text
merchant checkout
→ MANDATE Native
→ MANDATE policy core
→ Razorpay Test Mode
```

Use `/negotiation` to run the full merchant-agent negotiation and Razorpay flow.

### Paid agent service

```text
agent service
→ x402 v2
→ PAYMENT-REQUIRED
→ PAYMENT-SIGNATURE
→ MANDATE service authorization
→ facilitator verify/settle
```

Use `/x402` to inspect the x402 challenge.

### Payment tool

```text
agent tool
→ MCP 2026-07-28
→ guarded Razorpay tool
→ MANDATE transaction + authorization
```

Use `/mcp` to show unauthorized requests failing closed before payment-changing work can proceed.

### Delegated UPI

```text
delegated UPI request
→ NPCI delegation profile reference
→ MANDATE Native authority boundary
```

The UAP profile is intentionally visible but not executable because no authoritative public UAP wire specification is claimed. The profile captures verified NPCI delegation constraints as an adapter boundary.

## Judge-facing message

The important result is architectural:

```text
                Agent / Model
                      |
              protocol selection
                      v
              protocol adapter
                      |
                      v
             +----------------+
             | MANDATE CORE   |
             | identity       |
             | policy         |
             | limits         |
             | cart binding   |
             | authorization  |
             +-------+--------+
                     |
             +-------+----------+
             |                  |
          Razorpay             x402
            / UPI             service
```

Protocol choice changes transport and evidence format. It does not change who controls the final payment authority.

## Evidence policy

The registry distinguishes:

```text
IMPLEMENTED
EXPERIMENT
TARGET
ALIGNED
ADAPTER-READY
```

An external protocol is never promoted to executable solely because its name appears in a capability document. Native execution requires an actual adapter, runtime validation, mapping into the MANDATE core and compatible test evidence.
