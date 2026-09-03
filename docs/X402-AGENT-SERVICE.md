# x402 Agent Service Experiment

## Purpose

This experiment demonstrates agent-to-service payment using the current x402 v2 HTTP transport while preserving the MANDATE principle that an agent does not receive unrestricted payment authority.

x402 v2 communicates payment requirements in the `PAYMENT-REQUIRED` response header and payment authorization in the `PAYMENT-SIGNATURE` request header. Both carry Base64-encoded JSON. A resource server can ask a facilitator to verify and settle the payment. citeturn454767search0turn484950view0

## Local flow

```text
Buyer Agent
   |
   | GET /resource
   v
Agent Service :4021
   |
   | HTTP 402 + PAYMENT-REQUIRED
   v
Buyer constructs x402 PaymentPayload
   |
   | PAYMENT-SIGNATURE
   | X-MANDATE-SERVICE-MANDATE
   v
Agent Service
   |
   +--> signed MANDATE service authorization
   |
   +--> facilitator /verify
   |
   +--> facilitator /settle
   |
   v
HTTP 200 + PAYMENT-RESPONSE + resource
```

## Service configuration

Set these values in `.env` before a real facilitator-backed experiment:

```text
X402_FACILITATOR_URL=https://x402.org/facilitator
X402_PAY_TO=<your Base Sepolia receiving address>
X402_SERVICE_ID=mandate-premium-data
X402_PRICE_ATOMIC=10000
X402_NETWORK=eip155:84532
X402_ASSET=0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

The x402 documentation currently lists Base Sepolia as `eip155:84532`, and the official quickstart identifies `https://x402.org/facilitator` as a testing facilitator for Base Sepolia and Solana devnet. citeturn604153search7turn454767search5

## MANDATE service authorization

The service accepts a custom `X-MANDATE-SERVICE-MANDATE` header containing Base64-encoded JSON. The signed object binds:

```text
mandateId
subjectId
agentId
serviceId
network
asset
payTo
maxAmountAtomic
nonce
expiresAt
```

The service verifies the Ed25519 signature and ensures the x402 requirement stays within the authorized service, recipient, asset, network, amount and expiry.

The MANDATE replay key is consumed only after the facilitator confirms successful settlement.

## 402 challenge

```bash
curl -i http://localhost:4021/resource
```

Expected response:

```text
HTTP/1.1 402 Payment Required
PAYMENT-REQUIRED: <base64 JSON>
```

Decode the header to inspect the x402 v2 `PaymentRequired` object. Its `accepts` entry declares the `exact` scheme, network, amount, asset, recipient and timeout.

## Real settlement

For an actual x402 test, use an x402-compatible client and wallet on the configured test network. The client should retry the resource request with a valid `PAYMENT-SIGNATURE`, while the service performs facilitator verification and settlement.

Do not describe a local 402 challenge as a completed payment. A live payment is only proven when the configured facilitator returns a successful settlement response and the service returns `PAYMENT-RESPONSE` with HTTP 200. x402's facilitator flow explicitly separates verification from settlement. citeturn604153search6turn454767search0

## Security experiment

The strongest judge sequence is:

```text
1. GET /resource
   → 402 Payment Required

2. PAYMENT-SIGNATURE but no MANDATE service authorization
   → BLOCK

3. MANDATE service authorization for too-large amount
   → BLOCK

4. Valid x402 payment + valid MANDATE authorization
   → facilitator verify
   → facilitator settle
   → 200 resource
```

The point is not to replace x402. The point is to show that an x402-compatible agent payment can terminate at a separate authorization/control plane before value is settled.
