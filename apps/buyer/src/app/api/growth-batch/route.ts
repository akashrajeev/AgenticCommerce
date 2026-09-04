import { NextResponse } from "next/server";

const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000").replace(/\/$/, "");
const MCP_INTERNAL_URL = (process.env.MCP_INTERNAL_URL ?? "http://localhost:4100").replace(/\/$/, "");
const MCP_AGENT_TOKEN = process.env.MCP_AGENT_TOKEN ?? "";

type McpCreateOrderBody = {
  error?: { message?: unknown };
  result?: {
    isError?: boolean;
    structuredContent?: {
      transaction?: unknown;
      order?: unknown;
      checkout?: unknown;
    };
    content?: Array<{ text?: unknown }>;
  };
};

async function gatewayJson(path: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${GATEWAY_INTERNAL_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  return await response.json().catch(() => null) as Record<string, unknown> | null;
}

async function callMcpCreateOrder(authorizationId: string, transactionId: string) {
  if (!MCP_AGENT_TOKEN) return { ok: false, error: "MCP_AGENT_TOKEN_NOT_CONFIGURED" } as const;
  try {
    const response = await fetch(`${MCP_INTERNAL_URL}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${MCP_AGENT_TOKEN}`,
        "mcp-protocol-version": "2026-07-28",
        "mcp-method": "tools/call",
        "mcp-name": "mandate_razorpay_create_order",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `growth-batch-${transactionId}`,
        method: "tools/call",
        params: { name: "mandate_razorpay_create_order", arguments: { authorizationId, transactionId } },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null) as McpCreateOrderBody | null;
    const errorMessage = typeof body?.error?.message === "string"
      ? body.error.message
      : typeof body?.result?.content?.[0]?.text === "string"
        ? String(body.result.content[0].text)
        : "MCP_CREATE_ORDER_FAILED";
    const structured = body?.result?.structuredContent;
    const ok = response.ok && body?.result?.isError !== true && Boolean(structured?.order);
    return {
      ok,
      body,
      ...(structured?.transaction !== undefined ? { transaction: structured.transaction } : {}),
      ...(structured?.order !== undefined ? { order: structured.order } : {}),
      ...(structured?.checkout !== undefined ? { checkout: structured.checkout } : {}),
      ...(ok ? {} : { error: errorMessage }),
    } as const;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "MCP_UNAVAILABLE" } as const;
  }
}

export async function GET() {
  try {
    const body = await gatewayJson("/v1/transactions");
    const raw = body?.transactions;
    const transactions = Array.isArray(raw) ? raw.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
    const candidates = transactions.filter((transaction) => {
      const authorization = transaction.mandateAuthorization;
      return transaction.state === "policy_authorized" && authorization && typeof authorization === "object" && (authorization as Record<string, unknown>).status === "authorized";
    }).slice(0, 12);
    return NextResponse.json({
      testModeOnly: true,
      maxBatchSize: 5,
      candidates: candidates.map((transaction) => {
        const authorization = transaction.mandateAuthorization as Record<string, unknown>;
        const quote = transaction.quote && typeof transaction.quote === "object" ? transaction.quote as Record<string, unknown> : {};
        return {
          transactionId: transaction.id,
          authorizationId: authorization.authorizationId,
          amountPaise: quote.totalPaise ?? null,
          currency: quote.currency ?? "INR",
          state: transaction.state,
          merchantId: transaction.intent && typeof transaction.intent === "object" ? (transaction.intent as Record<string, unknown>).merchantId : null,
          productId: transaction.intent && typeof transaction.intent === "object" ? (transaction.intent as Record<string, unknown>).productId : null,
          razorpayOrderId: transaction.razorpayOrderId ?? null,
        };
      }),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GROWTH_BATCH_UNAVAILABLE" }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const input = await request.json().catch(() => null) as { transactionIds?: unknown } | null;
  const transactionIds = Array.isArray(input?.transactionIds) ? input!.transactionIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : [];
  if (transactionIds.length < 1 || transactionIds.length > 5) return NextResponse.json({ error: "BATCH_SIZE_MUST_BE_1_TO_5" }, { status: 400 });

  const body = await gatewayJson("/v1/transactions");
  const raw = body?.transactions;
  const transactions = Array.isArray(raw) ? raw.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const selected = transactionIds.map((transactionId) => transactions.find((transaction) => transaction.id === transactionId)).filter((transaction): transaction is Record<string, unknown> => Boolean(transaction));
  if (selected.length !== transactionIds.length) return NextResponse.json({ error: "TRANSACTION_NOT_FOUND_IN_BATCH" }, { status: 404 });

  const results = [] as Array<Record<string, unknown>>;
  for (const transaction of selected) {
    const authorization = transaction.mandateAuthorization;
    if (transaction.state !== "policy_authorized" || !authorization || typeof authorization !== "object" || (authorization as Record<string, unknown>).status !== "authorized" || typeof (authorization as Record<string, unknown>).authorizationId !== "string") {
      results.push({ transactionId: transaction.id, ok: false, error: "MANDATE_AUTHORIZATION_REQUIRED" });
      continue;
    }
    const result = await callMcpCreateOrder(String((authorization as Record<string, unknown>).authorizationId), String(transaction.id));
    results.push({ transactionId: transaction.id, ...result });
  }

  return NextResponse.json({ testModeOnly: true, maxBatchSize: 5, requested: transactionIds.length, results });
}