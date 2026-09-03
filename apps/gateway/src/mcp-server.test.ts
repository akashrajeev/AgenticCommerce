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
    env: {
      ...process.env,
      NODE_ENV: "test",
      MCP_PORT: String(port),
      MCP_AGENT_TOKEN: "test-mcp-token",
      MCP_GATEWAY_INTERNAL_URL: "http://127.0.0.1:9",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer();
});

test.after(() => {
  server?.kill("SIGTERM");
});

test("rejects missing MCP bearer credentials", async () => {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "UNAUTHORIZED_MCP_CLIENT" });
});

test("initializes and lists the mandate-gated Razorpay tools", async () => {
  const headers = {
    "content-type": "application/json",
    authorization: "Bearer test-mcp-token",
    "mcp-protocol-version": "2026-07-28",
  };
  const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { capabilities: {} } }),
  });
  assert.equal(initialize.status, 200);
  const initialized = await initialize.json() as { result?: { protocolVersion?: string; serverInfo?: { name?: string } } };
  assert.equal(initialized.result?.protocolVersion, "2026-07-28");
  assert.equal(initialized.result?.serverInfo?.name, "MANDATE Razorpay MCP Policy Gateway");

  const listed = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
  });
  assert.equal(listed.status, 200);
  const body = await listed.json() as { result?: { tools?: Array<{ name?: string }> } };
  const names = body.result?.tools?.map((tool) => tool.name) ?? [];
  assert.deepEqual(names, [
    "mandate_razorpay_create_order",
    "mandate_razorpay_fetch_order",
    "mandate_razorpay_fetch_payment",
    "mandate_razorpay_capture_payment",
  ]);
});
