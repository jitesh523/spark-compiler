import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SESSION_KEY,
  SESSION_LIMITS,
  boundMessages,
  createSession,
  exportSession,
  loadSession,
  parseSession,
  saveSession,
} from "../src/lib/session";

test("session export preserves code, input, conversation, runs, and repair undo", () => {
  const session = createSession();
  const time = new Date().toISOString();
  session.language = "typescript";
  session.files.typescript = { code: "console.log('saved');", stdin: "Ada\n" };
  session.messages.push({ id: "message-1", role: "assistant", content: "Added a missing parenthesis.", createdAt: time, language: "python", code: "print('hi')", changes: ["Closed print call"] });
  session.runs.push({ id: "run-1", language: "python", code: "print('hi')", stdout: "hi\n", stderr: "", exitCode: 0, durationMs: 12, createdAt: time });
  session.checkpoints.push({ id: "checkpoint-1", language: "python", code: "print('hi'", reason: "Before AI repair", createdAt: time });
  assert.deepEqual(parseSession(exportSession(session)), session);
});

test("exports and imports remove unrecognized credential fields at every level", () => {
  const session = createSession();
  const unsafe = {
    ...session,
    apiKey: "test-secret-never-export",
    files: { ...session.files, python: { ...session.files.python, apiKey: "test-secret-never-export" } },
    messages: [{ id: "message-1", role: "user" as const, content: "Explain loops", createdAt: session.createdAt, apiKey: "test-secret-never-export" }],
  };
  const imported = parseSession(JSON.stringify(unsafe));
  assert.ok(imported);
  assert.equal(exportSession(imported).includes("test-secret-never-export"), false);
  assert.equal(exportSession(unsafe).includes("test-secret-never-export"), false);
});

test("imports reject malformed and oversized workspaces instead of replacing user code", () => {
  const session = createSession();
  assert.equal(parseSession("not json"), null);
  assert.equal(parseSession("null"), null);
  assert.equal(parseSession(JSON.stringify({ ...session, language: "shell" })), null);
  assert.equal(parseSession(JSON.stringify({ ...session, updatedAt: "not a date" })), null);
  assert.equal(parseSession(JSON.stringify({ ...session, files: { python: session.files.python } })), null);
  session.files.python.code = "x".repeat(SESSION_LIMITS.code + 1);
  assert.equal(parseSession(JSON.stringify(session)), null);
});

test("bounded history keeps the newest messages and repair checkpoints", () => {
  const session = createSession();
  session.messages = Array.from({ length: SESSION_LIMITS.messages + 20 }, (_, index) => ({
    id: `message-${index}`,
    role: "user",
    content: `Question ${index}`,
    createdAt: session.createdAt,
  }));
  session.checkpoints = Array.from({ length: SESSION_LIMITS.checkpoints + 5 }, (_, index) => ({
    id: `checkpoint-${index}`, language: "python", code: String(index), reason: "Before repair", createdAt: session.createdAt,
  }));
  const restored = parseSession(exportSession(session));
  assert.ok(restored);
  assert.equal(restored.messages.length, SESSION_LIMITS.messages);
  assert.equal(restored.messages[0].id, "message-20");
  assert.equal(restored.checkpoints[0].id, "checkpoint-5");

  session.messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`, role: "assistant", content: "x".repeat(10_000), createdAt: session.createdAt,
  }));
  const bounded = parseSession(exportSession(session));
  assert.ok(bounded);
  assert.equal(bounded.messages.length, 16);
  assert.equal(bounded.messages[0].id, "message-4");
});

test("in-memory conversation bounds match the saved and AI context window", () => {
  const session = createSession();
  session.messages = Array.from({ length: 20 }, (_, index) => ({
    id: `message-${index}`, role: "assistant", content: "x".repeat(10_000), createdAt: session.createdAt,
  }));
  const bounded = boundMessages(session.messages);
  assert.equal(bounded.length, 16);
  assert.equal(bounded[0].id, "message-4");
  assert.equal(session.messages.length, 20, "bounding must not mutate existing React state");
  assert.deepEqual(parseSession(exportSession(session))?.messages, bounded);

  session.messages = Array.from({ length: 201 }, (_, index) => ({
    id: `message-${index}`, role: "user", content: "short question", createdAt: session.createdAt,
  }));
  assert.equal(boundMessages(session.messages).length, 200);
  assert.equal(boundMessages(session.messages)[0].id, "message-1");

  session.messages = Array.from({ length: 6 }, (_, index) => ({
    id: `source-message-${index}`,
    role: "assistant",
    language: "python",
    content: "x".repeat(2_000),
    code: "x".repeat(30_000),
    createdAt: session.createdAt,
  }));
  const withSources = boundMessages(session.messages);
  assert.equal(withSources.length, 5, "suggested code counts toward the same 160k context budget");
  assert.equal(withSources[0].id, "source-message-1");
  assert.deepEqual(parseSession(exportSession(session))?.messages, withSources);
  assert.equal(parseSession(JSON.stringify(session)), null, "oversized source history is rejected on import");
});

test("valid maximum-size AI responses remain saveable and language-aware", () => {
  const session = createSession();
  session.messages.push({
    id: "full-ai-response",
    role: "assistant",
    language: "cpp",
    content: "x".repeat(32_000),
    code: "x".repeat(30_000),
    changes: Array.from({ length: 100 }, () => "A concrete change"),
    createdAt: session.createdAt,
  });
  const restored = parseSession(exportSession(session));
  assert.deepEqual(restored?.messages, session.messages);
  assert.equal(parseSession(JSON.stringify({ ...session, messages: [{ ...session.messages[0], language: "rust" }] })), null);
  assert.equal(parseSession(JSON.stringify({ ...session, messages: [{ ...session.messages[0], content: "x".repeat(32_001) }] })), null);
});

test("browser reload recovers saved work and storage failures preserve previous data", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const data = new Map<string, string>();
  let failWrite = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrite) throw new Error("Quota exceeded");
        data.set(key, value);
      },
    } },
  });
  try {
    const session = createSession();
    session.files.python.code = "print('my work')";
    assert.equal(saveSession(session), true);
    assert.deepEqual(loadSession(), session);
    const saved = data.get(SESSION_KEY);
    failWrite = true;
    session.files.python.code = "print('new unsaved work')";
    assert.equal(saveSession(session), false);
    assert.equal(data.get(SESSION_KEY), saved);
    data.set(SESSION_KEY, "corrupted");
    assert.equal(loadSession().language, "python");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("server rendering can create a session without browser storage", () => {
  const first = createSession();
  const second = createSession();
  first.files.python.code = "my edit";
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.files.python.code, second.files.python.code);
  assert.equal(saveSession(first), false);
  assert.equal(loadSession().language, "python");
});
