import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginRequest } from "../src/lib/request-origin";
import { POST } from "../src/app/api/ai/route";

test("same-origin requests use the public Host when Next binds to 0.0.0.0", async () => {
  const request = new Request("http://0.0.0.0:3100/api/ai", {
    method: "POST",
    headers: { host: "localhost:3100", origin: "http://localhost:3100", "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: JSON.stringify({ action: "fix", language: "invalid", code: "x" }),
  });
  assert.equal(isSameOriginRequest(request), true);
  // An input error proves the request passed the route's origin guard.
  assert.equal((await POST(request)).status, 400);
  assert.equal(isSameOriginRequest(new Request("http://0.0.0.0:3100/api/ai", { headers: { host: "localhost:3100", origin: "https://evil.test" } })), false);
});

test("Vercel requests use trusted forwarded host and protocol", () => {
  const previous = process.env.VERCEL;
  try {
    const request = new Request("http://internal:3000/api/ai", { headers: {
      host: "internal:3000", "x-forwarded-host": "spark.example.com", "x-forwarded-proto": "https", origin: "https://spark.example.com",
    } });
    delete process.env.VERCEL;
    assert.equal(isSameOriginRequest(request), false);
    process.env.VERCEL = "1";
    assert.equal(isSameOriginRequest(request), true);
    assert.equal(isSameOriginRequest(new Request("http://internal:3000/api/ai", { headers: { host: "internal:3000", "x-forwarded-host": "spark.example.com", "x-forwarded-proto": "https", origin: "https://evil.test" } })), false);
  } finally {
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
  }
});

test("origin checks reject cross-site and malformed requests while allowing CLI requests", () => {
  const cases: Record<string, string>[] = [
    { origin: "null" },
    { origin: "not a URL" },
    { origin: "https://spark.test", "sec-fetch-site": "cross-site" },
    { origin: "https://spark.test", host: "spark.test/path" },
  ];
  for (const headers of cases) assert.equal(isSameOriginRequest(new Request("https://spark.test/api/ai", { headers })), false);
  assert.equal(isSameOriginRequest(new Request("https://spark.test/api/ai")), true);
});
