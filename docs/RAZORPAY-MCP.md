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

The facade supports the current stateless MCP `2026-07-28` transport plus explicit compatibility for older 2025 protocol revisions. MCP 2026-07-28 removed the `initialize`/`initialized` handshake and uses self-describing requests with `MCP-Protocol-Version` and `Mcp-Method`; tool calls additionally carry `Mcp-Name`. Tool listings include cache hints. The facade implements `server/discover`, `tools/list`, `tools/call`, `ping`, and legacy `initialize` only for older protocol versions. citeturn991088view0

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

Reads gateway-authoritative evidence after proving the supplied order ID belongs to the supplied transaction.

### `mandate_razorpay_fetch_payment`

Reads gateway-authoritative evidence after proving the payment ID belongs to the supplied gateway transaction.

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

## Modern 2026 request example

```http
POST /mcp HTTP/1.1
Content-Type: application/json
Authorization: Bearer <MCP_AGENT_TOKEN>
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: mandate_razorpay_create_order
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "mandate_razorpay_create_order",
    "arguments": {
      "authorizationId": "auth_...",
      "transactionId": "tx_..."
    },
    "_meta": {
      "io.modelcontextprotocol/clientInfo": {
        "name": "mandate-buyer",
        "version": "1.0"
      }
    }
  }
}
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

The buyer-facing MCP lab demonstrates the first half without giving the browser access to the gateway secret. The full successful path is exercised from `/negotiation` after a real delegated authorization is established.

## Relationship to official Razorpay MCP

Razorpay also publishes an official MCP server with 35+ tools spanning payments, orders, refunds, payment links, QR codes, settlements, payouts and Standard Checkout. MANDATE's Phase 9 implementation is intentionally a **policy facade experiment** rather than a claim that this repository is the official server or a fully interchangeable implementation. citeturn620214search0turn620214search1

A later integration can place the official Razorpay MCP client behind the same MANDATE authorization layer without changing the core transaction model.
