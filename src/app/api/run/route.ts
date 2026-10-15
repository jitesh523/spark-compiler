import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 40;

const COMPILERS = { c: "gcc-13.2.0-c", cpp: "gcc-13.2.0", java: "openjdk-jdk-21+35" } as const;
const UPSTREAM_URL = "https://wandbox.org/api/compile.json";
const MAX_BODY_BYTES = 160_000;
const MAX_UPSTREAM_BYTES = 1_000_000;
const OUTPUT_LIMIT = 65_536;
const WINDOW_MS = 60_000;
const buckets = new Map<string, { count: number; resetAt: number }>();
let globalBucket = { count: 0, resetAt: 0 };
let activeRequests = 0;

const schema = z.object({
  language: z.enum(["c", "cpp", "java"]),
  code: z.string().min(1).max(30_000, "Keep your source under 30,000 characters."),
  stdin: z.string().max(12_000, "Keep standard input under 12,000 characters.").optional().default(""),
}).strict();

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: {
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  } });
}

function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new RequestError("Cross-site requests are not allowed.", 403);
  if (origin) {
    try { if (new URL(origin).origin !== new URL(request.url).origin) throw new Error(); }
    catch { throw new RequestError("Cross-site requests are not allowed.", 403); }
  }
}

function checkQuota(request: Request) {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  if (globalBucket.resetAt <= now) globalBucket = { count: 0, resetAt: now + WINDOW_MS };
  const ip = (request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 100);
  const bucket = buckets.get(ip) || { count: 0, resetAt: now + WINDOW_MS };
  // These are per-instance guardrails; the external sandbox has its own quotas.
  if (bucket.count >= 12 || globalBucket.count >= 60 || activeRequests >= 4 || (!buckets.has(ip) && buckets.size >= 512)) {
    throw new RequestError("The compiler is busy. Wait a minute before running again.", 429);
  }
  bucket.count += 1;
  globalBucket.count += 1;
  buckets.set(ip, bucket);
}

async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError("The compiler request or response is too large. Reduce your code, input, or printed output.", 413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

export async function POST(request: Request) {
  let timeout: AbortSignal | undefined;
  let acquired = false;
  const startedAt = Date.now();
  try {
    checkOrigin(request);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new RequestError("Send code as JSON.", 415);
    if (Number(request.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new RequestError("The compiler request is too large.", 413);
    let raw: unknown;
    try { raw = JSON.parse(await readLimited(request.body, MAX_BODY_BYTES)); }
    catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError("The request contains invalid JSON.", 400);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return json({ error: `${issue.path.join(".") || "Request"}: ${issue.message}` }, 400);
    }
    checkQuota(request);
    activeRequests += 1;
    acquired = true;
    const { language, code, stdin } = parsed.data;
    // Wandbox's primary Java file is named prog.java. Keep the user's standard
    // public Main class intact in Main.java, compiled through this fixed launcher.
    const payload = language === "java" ? {
      compiler: COMPILERS.java,
      code: "class prog { public static void main(String[] args) throws Exception { Main.main(args); } }",
      codes: [{ file: "Main.java", code }],
      stdin, save: false,
    } : {
      compiler: COMPILERS[language], code, stdin, save: false,
      options: language === "c" ? "warning,c11" : "warning,c++17",
    };
    timeout = AbortSignal.timeout(28_000);
    const response = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mozilla/5.0 SparkCompiler/1.0" },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([request.signal, timeout]),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return json({ error: response.status === 429 ? "The external compiler has reached its rate limit. Wait a minute and try again." : "The external compiler is temporarily unavailable. Try again shortly." }, response.status === 429 ? 429 : 502);
    }
    const result = JSON.parse(await readLimited(response.body, MAX_UPSTREAM_BYTES));
    if (!result || typeof result !== "object" || typeof result.status !== "string") {
      return json({ error: "The external compiler returned an incomplete result. Try again." }, 502);
    }
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const fullStdout = text(result.program_output);
    const fullStderr = text(result.compiler_error) + text(result.compiler_output) + text(result.program_error);
    let stdout = fullStdout.slice(0, OUTPUT_LIMIT);
    let stderr = fullStderr.slice(0, OUTPUT_LIMIT - stdout.length);
    let exitCode = /^-?\d+$/.test(result.status) ? Number(result.status) : 1;
    if (result.signal) { stderr += `\nExecution stopped by ${text(result.signal)}.\n`; if (!exitCode) exitCode = 1; }
    if (fullStdout.length + fullStderr.length > OUTPUT_LIMIT) {
      // Reserve space for the explanation without exceeding the client cap.
      const notice = "\nOutput limit exceeded (64 KB).\n";
      stdout = stdout.slice(0, OUTPUT_LIMIT - notice.length);
      stderr = stderr.slice(0, OUTPUT_LIMIT - stdout.length - notice.length) + notice;
      exitCode = 1;
    }
    return json({ stdout, stderr, exitCode, durationMs: Date.now() - startedAt });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    if (timeout?.aborted) return json({ error: "The external compiler took too long to respond. Try again shortly." }, 504);
    if (request.signal.aborted) return json({ error: "Compilation cancelled." }, 408);
    // Avoid echoing submitted code or upstream internal details in service errors.
    return json({ error: "Could not reach the external compiler. Try again shortly." }, 502);
  } finally {
    if (acquired) activeRequests -= 1;
  }
}
