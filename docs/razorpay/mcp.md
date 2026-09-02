# Razorpay MCP

## Official Server

- Official docs: https://razorpay.com/docs/build/llm-docs/mcp-server.md
- Official GitHub: https://github.com/razorpay/razorpay-mcp-server
- Remote endpoint: `https://mcp.razorpay.com/mcp`
- Local Docker image: `razorpay/mcp`

## Authentication And Configuration

Remote MCP:

- Razorpay docs describe `mcp-remote` against `https://mcp.razorpay.com/mcp`.
- Some integrations use a Basic merchant token generated from `key_id:key_secret`.
- ChatGPT/Replit style integrations can use OAuth where supported.

Local MCP:

- Required env vars: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`.
- Optional env vars: `LOG_FILE`, `TOOLSETS`, `READ_ONLY`.
- CLI flags include `--key`, `--secret`, `--log-file`, `--toolsets`, and `--read-only`.

OAuth:

- Well-known endpoint: `https://mcp.razorpay.com/.well-known/oauth-authorization-server`.
- Documented endpoints include `/authorize`, `/token`, and `/register`.
- Documented scope example: `read_only`.

## Confirmed Tool Areas

Official docs and GitHub README list 35+ tools across:

- Payments
- Orders
- Payment Links
- Refunds
- QR Codes
- Settlements
- Payouts
- Saved tokens
- Standard Checkout integration helper

Confirmed specific tools from the official GitHub README include:

- `create_order`, `fetch_order`, `fetch_all_orders`, `update_order`, `fetch_order_payments`
- `fetch_payment`, `fetch_all_payments`, `capture_payment`, `update_payment`, `fetch_payment_card_details`
- `create_payment_link`, `create_payment_link_upi`, `fetch_payment_link`, `fetch_all_payment_links`, `send_payment_link`, `update_payment_link`
- `create_refund`, `fetch_refund`, `fetch_all_refunds`, `update_refund`, `fetch_multiple_refunds_for_payment`, `fetch_specific_refund_for_payment`
- `create_qr_code`, `fetch_qr_code`, `fetch_all_qr_codes`
- `detect_stack`, `integrate_razorpay_checkout`

Some write tools are not supported on the remote server according to the official GitHub README, including `create_refund`, `close_qr_code`, `create_instant_settlement`, and `create_registration_link`.

## MANDATE Position

MCP must not be used as the production payment executor for MANDATE. It gives AI clients operational payment tools and could bypass spending limits, merchant constraints, transaction authorization, audit, and verification.

Allowed use:

- Developer research and implementation assistance.
- Read-only inspection when configured as read-only.
- Optional hackathon demo where MCP calls are made by the gateway after policy authorization and every call is audited.

Forbidden use:

- Direct AI -> Razorpay MCP order creation.
- Direct AI -> Razorpay MCP capture/refund/payment-link creation.
- Any MCP path that can create or mutate payment state without MANDATE policy and audit.

## Sources

- https://razorpay.com/docs/build/llm-docs/mcp-server.md
- https://razorpay.com/docs/build/llm-docs/mcp-server/integrations.md
- https://razorpay.com/docs/build/llm-docs/mcp-server/configuration.md
- https://razorpay.com/docs/build/llm-docs/mcp-server/oauth.md
- https://github.com/razorpay/razorpay-mcp-server
