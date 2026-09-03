import assert from "node:assert/strict";
import test from "node:test";

const port = 4197;
let server: ReturnType<typeof import("node:child_process").spawn> | undefined;

async function waitForServer(): Promise<void> {
  const started = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MCP test server did not start")), 15_000);
    server!.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("MANDATE MCP policy gateway listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server!.on("error", reject);
    server!.on("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`MCP test server exited with ${code}`));
    });
  });
  await started;
}

test.before(async () => {
  const { spawn } = await import("node:child_process");
  server = spawn(process.execPath, ["--import", "tsx", "src/mcp-server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test", MCP_PORT: String(port), MCP_AGENT_TOKEN: "test-mcp-token", MCP_GATEWAY_INTERNAL_URL: "http://127.0.0.1:9" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

test.after(() => { server?.kill("SIGTERM"); });

const modernHeaders = {
  "content-type": "application/json",
  authorization: "Bearer test-mcp-token",
  "mcp-protocol-version": "2026-07-28",
};

test("rejects missing MCP bearer credentials", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", "mcp-protocol-version": "2026-07-28", "mcp-method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "UNAUTHORIZED_MCP_CLIENT" });
});

test("supports stateless 2026 discover and tool listing", async () => {
  const discover = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { ...modernHeaders, "mcp-method": "server/discover" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0" } } } }),
  });
  assert.equal(discover.status, 200);
  const discovered = await discover.json() as { result?: { protocolVersion?: string; serverInfo?: { name?: string } } };
  assert.equal(discovered.result?.protocolVersion, "2026-07-28");
  assert.equal(discovered.result?.serverInfo?.name, "MANDATE Razorpay MCP Policy Gateway");

  const listed = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { ...modernHeaders, "mcp-method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  });
  assert.equal(listed.status, 200);
  const body = await listed.json() as { result?: { tools?: Array<{ name?: string }>; ttlMs?: number; cacheScope?: string } };
  const names = body.result?.tools?.map((tool) => tool.name) ?? [];
  assert.deepEqual(names, ["mandate_razorpay_create_order", "mandate_razorpay_fetch_order", "mandate_razorpay_fetch_payment", "mandate_razorpay_capture_payment"]);
  assert.equal(body.result?.ttlMs, 60_000);
  assert.equal(body.result?.cacheScope, "private");
});

test("rejects a mismatched Mcp-Method header", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { ...modernHeaders, "mcp-method": "tools/list" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }),
  });
  assert.equal(response.status, 400);
  const body = await response.json() as { error?: { message?: string } };
  assert.equal(body.error?.message, "Mcp-Method header must match the JSON-RPC method");
});

test("rejects a payment tool call without its mandate authorization fields", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { ...modernHeaders, "mcp-method": "tools/call", "mcp-name": "mandate_razorpay_capture_payment" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "mandate_razorpay_capture_payment", arguments: { transactionId: "tx_123", paymentId: "pay_123" } } }),
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  assert.equal(body.result?.isError, true);
  assert.equal(body.result?.content?.[0]?.text, "INVALID_AUTHORIZATIONID");
});

test("retains legacy 2025 initialize compatibility", async () => {
  const headers = { ...modernHeaders, "mcp-protocol-version": "2025-11-25" };
  delete (headers as Record<string, string>)["mcp-method"];
  const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "legacy", version: "1.0" } } }),
  });
  assert.equal(initialize.status, 200);
  const body = await initialize.json() as { result?: { protocolVersion?: string } };
  assert.equal(body.result?.protocolVersion, "2025-11-25");
});
