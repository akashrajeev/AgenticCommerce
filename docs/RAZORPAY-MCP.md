# MANDATE Razorpay MCP Policy Facade

## Status

**Phase 9 — implemented as an MCP-compatible policy facade.**

This repository does **not** claim to reimplement or certify Razorpay's official MCP server. The MANDATE component is a local MCP-compatible tool endpoint that places an authorization boundary in front of the existing gateway/Razorpay integration.

## Architecture

```text
Buyer / Agent
     |
     | MCP tools/call
     v
MANDATE MCP Policy Facade :4100
     |
     | trusted internal request
     v
MANDATE Gateway :4000
     |
     +-- mandate authorization
     +-- transaction binding
     +-- deterministic policy
     +-- Razorpay adapter
     |
     v
Razorpay Test Mode
```

The model never receives or controls the Razorpay API secret.

## MCP endpoint

```text
POST /mcp
```

The facade supports JSON-RPC requests for:

```text
initialize
tools/list
tools/call
```

It validates the MCP protocol-version header when supplied and advertises the versions supported by the facade.

Authentication is a bearer token:

```text
Authorization: Bearer <MCP_AGENT_TOKEN>
```

Production requires an explicit `MCP_AGENT_TOKEN`. Local development can use the Compose default, which should be replaced outside a local-only environment.

The service validates browser `Origin` values and permits only local origins by default. Agent-to-agent deployment should terminate TLS and apply its own network policy at the edge.

## Tools

### `mandate_razorpay_create_order`

Creates a Razorpay order only when the supplied transaction is already attached to a valid MANDATE authorization.

The tool accepts:

```json
{
  "authorizationId": "auth_...",
  "transactionId": "tx_..."
}
```

There is deliberately **no trusted amount input**. The gateway transaction and merchant quote remain authoritative.

### `mandate_razorpay_fetch_order`

Reads a Razorpay order after proving the supplied order ID belongs to the supplied gateway transaction.

### `mandate_razorpay_fetch_payment`

Reads a Razorpay payment after proving the payment belongs to the supplied gateway transaction.

### `mandate_razorpay_capture_payment`

Captures a Razorpay payment only when:

```text
authorizationId
transactionId
paymentId
```

all resolve to the same trusted transaction and active MANDATE authorization.

The amount is taken from the authoritative gateway transaction rather than the tool caller.

## Security rule

These are intentionally forbidden:

```text
LLM -> Razorpay API
Buyer agent -> Razorpay API
Merchant agent -> Razorpay API
MCP client -> Razorpay directly
```

The permitted path is:

```text
Agent
  -> MANDATE MCP facade
  -> MANDATE gateway
  -> authorization / policy
  -> Razorpay adapter
```

## Local run

The full Compose stack exposes:

```text
Buyer:   http://localhost:3001
Merchant:http://localhost:3000
Gateway: http://localhost:4000
MCP:     http://localhost:4100/mcp
```

Start the stack with:

```bash
docker compose up --build
```

The MCP health endpoint is:

```text
GET http://localhost:4100/health
```

## Example initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "capabilities": {}
  }
}
```

with:

```text
MCP-Protocol-Version: 2026-07-28
Authorization: Bearer <MCP_AGENT_TOKEN>
```

## Judge experiment

The strongest demonstration is not “MCP works.” It is:

```text
Agent calls create-order tool
        |
        v
No valid MANDATE authorization
        |
        v
Gateway blocks the operation
```

Then:

```text
Agent calls create-order tool
        |
        v
Valid MANDATE authorization
        |
        v
Gateway revalidates transaction
        |
        v
Razorpay Test Order created
```

This proves that adding an agent tool interface does not move financial authority into the agent/model layer.

## Relationship to official Razorpay MCP

Razorpay also publishes an official MCP server. MANDATE's Phase 9 implementation is intentionally a **policy facade experiment** rather than a claim that this repository is the official server or a fully interchangeable implementation.

A later integration can place the official Razorpay MCP client behind the same MANDATE authorization layer without changing the core transaction model.
