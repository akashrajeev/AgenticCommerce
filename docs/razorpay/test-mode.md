# Razorpay Test Mode

## Findings

- Razorpay Dashboard has Test and Live modes.
- Test Mode is a sandbox replica available after signup.
- No real money is used in Test Mode.
- Test Mode entities and transactions do not appear in Live Mode.
- Generate API keys in Test Mode for development and Live Mode for production.
- Test Mode API keys process simulated transactions only.
- Test Mode supports webhook testing with Test Mode transactions.
- Test card payments use a mock bank page with Success and Failure controls.

## Test API Keys

- Generate from Dashboard after selecting Test Mode.
- Dashboard path: Account & Settings -> API Keys under Website and app settings -> Generate Key.
- Store `key_id` and `key_secret` securely.
- Razorpay documents that the key secret is shown only at generation time.
- Never commit keys.

## Test Payments

- Official test cards work only in Test Mode.
- Any random CVV and any future expiry date can be used.
- For a successful simulated card payment, enter a random OTP between 4 and 10 digits on the mock page.
- For a failed simulated card payment, enter a random OTP below 4 digits, or use documented error scenario cards.

## Sources

- https://razorpay.com/docs/build/llm-docs/payments/dashboard/test-live-modes.md
- https://razorpay.com/docs/build/llm-docs/payments/dashboard/account-settings/api-keys.md
- https://razorpay.com/docs/build/llm-docs/api/authentication.md
- https://razorpay.com/docs/build/llm-docs/payments/payments/test-card-details.md
- https://razorpay.com/docs/build/llm-docs/webhooks/validate-test.md
