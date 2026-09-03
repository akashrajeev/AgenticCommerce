import { NextResponse } from "next/server";

const X402_SERVICE_URL = (process.env.X402_SERVICE_INTERNAL_URL ?? process.env.X402_INTERNAL_URL ?? "http://localhost:4021").replace(/\/$/, "");

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { action?: unknown; paymentPayload?: unknown; subjectId?: unknown } | null;
  const action = typeof body?.action === "string" ? body.action : "";

  if (action === "challenge") {
    try {
      const response = await fetch(`${X402_SERVICE_URL}/resource`, { cache: "no-store" });
      return NextResponse.json({ status: response.status, paymentRequired: response.headers.get("payment-required"), body: await response.json().catch(() => null) });
    } catch (error) { return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_SERVICE_UNAVAILABLE" } }); }
  }

  if (action === "health") {
    try {
      const response = await fetch(`${X402_SERVICE_URL}/health`, { cache: "no-store" });
      return NextResponse.json({ status: response.status, body: await response.json().catch(() => null) });
    } catch (error) { return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_SERVICE_UNAVAILABLE" } }); }
  }

  if (action === "facilitator") {
    try {
      const response = await fetch(`${X402_SERVICE_URL}/facilitator-status`, { cache: "no-store" });
      return NextResponse.json({ status: response.status, body: await response.json().catch(() => null) });
    } catch (error) { return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_FACILITATOR_PROBE_FAILED" } }); }
  }

  if (action === "proof") {
    try {
      const response = await fetch(`${X402_SERVICE_URL}/proof/latest`, { cache: "no-store" });
      return NextResponse.json({ status: response.status, body: await response.json().catch(() => null) });
    } catch (error) { return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_PROOF_LOOKUP_FAILED" } }); }
  }

  if (action === "live-settle") {
    if (!body?.paymentPayload || typeof body.paymentPayload !== "object" || Array.isArray(body.paymentPayload)) return NextResponse.json({ status: 400, body: { error: "PAYMENT_PAYLOAD_REQUIRED" } }, { status: 400 });
    const payload = body.paymentPayload as Record<string, unknown>;
    const payloadBody = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload) ? payload.payload as Record<string, unknown> : null;
    const authorization = payloadBody?.authorization && typeof payloadBody.authorization === "object" && !Array.isArray(payloadBody.authorization) ? payloadBody.authorization as Record<string, unknown> : null;
    const subjectId = typeof body.subjectId === "string" ? body.subjectId.trim() : typeof authorization?.from === "string" ? authorization.from.trim() : "";
    if (!subjectId) return NextResponse.json({ status: 400, body: { error: "X402_WALLET_SUBJECT_REQUIRED" } }, { status: 400 });
    try {
      const mandateResponse = await fetch(`${X402_SERVICE_URL}/demo/mandate?subjectId=${encodeURIComponent(subjectId)}`, { cache: "no-store" });
      const mandateBody = await mandateResponse.json().catch(() => null) as { mandate?: unknown; error?: unknown } | null;
      if (!mandateResponse.ok || !mandateBody?.mandate) return NextResponse.json({ status: mandateResponse.status, body: mandateBody ?? { error: "X402_DEMO_MANDATE_UNAVAILABLE" } });

      const paymentHeader = Buffer.from(JSON.stringify(body.paymentPayload), "utf8").toString("base64");
      const mandateHeader = Buffer.from(JSON.stringify(mandateBody.mandate), "utf8").toString("base64");
      const response = await fetch(`${X402_SERVICE_URL}/resource`, { method: "GET", headers: { "payment-signature": paymentHeader, "x-mandate-service-mandate": mandateHeader }, cache: "no-store" });
      return NextResponse.json({ status: response.status, paymentResponse: response.headers.get("payment-response"), body: await response.json().catch(() => null), demoCredential: { enabled: true, subjectId, issuer: "ephemeral self-signed local demo credential" } });
    } catch (error) { return NextResponse.json({ status: 502, body: { error: error instanceof Error ? error.message : "X402_LIVE_SETTLEMENT_FAILED" } }); }
  }

  return NextResponse.json({ error: "INVALID_X402_LAB_ACTION" }, { status: 400 });
}
