/* Disposable execution worker. One invocation, one namespace, then terminated. */
"use strict";

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.29.2/full/";
const TYPESCRIPT_URL = "https://cdn.jsdelivr.net/npm/typescript@5.9.3/lib/typescript.js";
const send = self.postMessage.bind(self);
let completed = false;
let outputLength = 0;
let outputLimit = 65_536;
let pending = [];
let pendingLength = 0;
let flushTimer;

function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  for (const item of pending) send({ type: "output", ...item });
  pending = [];
  pendingLength = 0;
}

function write(stream, value) {
  if (completed) return;
  const text = String(value);
  const remaining = outputLimit - outputLength;
  const accepted = text.slice(0, Math.max(remaining, 0));
  if (accepted) {
    const last = pending[pending.length - 1];
    if (last?.stream === stream) last.text += accepted;
    else pending.push({ stream, text: accepted });
    outputLength += accepted.length;
    pendingLength += accepted.length;
    if (outputLength === accepted.length || pendingLength >= 1024) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 16);
  }
  if (text.length > remaining) {
    flush();
    completed = true;
    send({ type: "output-limit" });
    self.close();
    throw new Error("Output limit exceeded (64 KB).");
  }
}

function status(text, phase = "loading") {
  send({ type: "status", status: text, phase });
}

function finish(exitCode) {
  if (completed) return;
  flush();
  completed = true;
  send({ type: "done", exitCode });
  self.close();
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return value.toString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_, item) => {
      if (typeof item === "bigint") return `${item}n`;
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }, 2) ?? String(value);
  } catch { return String(value); }
}

function conciseError(error, filename) {
  const label = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const stack = typeof error?.stack === "string" ? error.stack : "";
  const location = stack.match(/(?:main\.js|main\.ts):(\d+):(\d+)/);
  // AsyncFunction's two generated wrapper lines are not part of the editor file.
  return location ? `${label}\n  at ${filename}:${Math.max(1, Number(location[1]) - 2)}:${location[2]}` : label;
}

async function runJavaScript(code, stdin, language) {
  const filename = language === "typescript" ? "main.ts" : "main.js";
  if (language === "typescript") {
    status("Loading TypeScript compiler…");
    importScripts(TYPESCRIPT_URL);
    const result = self.ts.transpileModule(code, {
      fileName: filename,
      reportDiagnostics: true,
      compilerOptions: {
        target: self.ts.ScriptTarget.ES2022,
        module: self.ts.ModuleKind.None,
        sourceMap: false,
        isolatedModules: true,
      },
    });
    const errors = (result.diagnostics || []).filter((d) => d.category === self.ts.DiagnosticCategory.Error);
    if (errors.length) {
      for (const diagnostic of errors.slice(0, 8)) {
        const position = diagnostic.file && typeof diagnostic.start === "number"
          ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
        const text = self.ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
        write("stderr", `${filename}${position ? `:${position.line + 1}:${position.character + 1}` : ""}: ${text}\n`);
      }
      return 1;
    }
    code = result.outputText;
  }

  const lines = stdin.replace(/\r\n/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  let inputIndex = 0;
  const readline = () => inputIndex < lines.length ? lines[inputIndex++] : null;
  const prompt = (message = "") => {
    if (message) write("stdout", String(message));
    return readline();
  };
  const logger = (stream) => (...args) => write(stream, `${args.map(formatValue).join(" ")}\n`);
  const consoleProxy = Object.freeze({
    log: logger("stdout"), info: logger("stdout"), debug: logger("stdout"),
    warn: logger("stderr"), error: logger("stderr"),
    table: logger("stdout"), dir: logger("stdout"),
    assert: (condition, ...args) => { if (!condition) logger("stderr")("Assertion failed:", ...args); },
    clear: () => {}, time: () => {}, timeEnd: () => {},
  });
  const processProxy = Object.freeze({
    stdin: Object.freeze({ read: () => stdin, isTTY: false }),
    stdout: Object.freeze({ write: (value) => { write("stdout", value); return true; } }),
    stderr: Object.freeze({ write: (value) => { write("stderr", value); return true; } }),
    argv: ["browser", filename], env: Object.freeze({}),
    exit: (code = 0) => { throw { sparkExit: true, code: Number(code) || 0 }; },
  });
  const requireStdin = (name) => {
    if (name === "fs" || name === "node:fs") return Object.freeze({
      readFileSync: (path) => {
        if (path !== 0 && path !== "/dev/stdin") throw new Error("Only standard input (0 or /dev/stdin) is available in the browser.");
        return stdin;
      },
    });
    throw new Error(`Module '${name}' is unavailable. This runner supports browser JavaScript, with stdin through readline(), prompt(), or require('fs').readFileSync(0, 'utf8').`);
  };

  // Keep global console output in the result too (e.g. globalThis.console.log).
  self.console = consoleProxy;
  self.readline = readline;
  self.prompt = prompt;
  status("Running your code…", "running");
  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const run = new AsyncFunction("stdin", "readline", "prompt", "console", "process", "require", `${code}\n//# sourceURL=${filename}`);
    await run(stdin, readline, prompt, consoleProxy, processProxy, requireStdin);
    return 0;
  } catch (error) {
    if (error?.sparkExit === true) return error.code;
    write("stderr", `${conciseError(error, filename)}\n`);
    return 1;
  }
}

async function runPython(code, stdin) {
  status("Loading Python runtime…");
  importScripts(`${PYODIDE_BASE}pyodide.js`);
  const pyodide = await self.loadPyodide({
    indexURL: PYODIDE_BASE,
    stdout: () => {}, stderr: () => {},
  });
  const stdoutDecoder = new TextDecoder();
  const stderrDecoder = new TextDecoder();
  pyodide.setStdout({ write(buffer) { write("stdout", stdoutDecoder.decode(buffer, { stream: true })); return buffer.length; } });
  pyodide.setStderr({ write(buffer) { write("stderr", stderrDecoder.decode(buffer, { stream: true })); return buffer.length; } });
  const inputBytes = new TextEncoder().encode(stdin);
  let inputOffset = 0;
  pyodide.setStdin({
    isatty: false,
    read(buffer) {
      const count = Math.min(buffer.length, inputBytes.length - inputOffset);
      buffer.set(inputBytes.subarray(inputOffset, inputOffset + count));
      inputOffset += count;
      return count;
    },
  });
  // Standard-library imports work immediately. Scientific packages can be loaded
  // from Pyodide's pinned package distribution when referenced in the program.
  status("Preparing Python imports…");
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: () => {} });
  const globals = pyodide.toPy({ __name__: "__main__", __file__: "main.py" });
  status("Running your code…", "running");
  try {
    const result = await pyodide.runPythonAsync(code, { globals, filename: "main.py" });
    result?.destroy?.();
    // Force a final unterminated print() to reach the output handler.
    pyodide.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()");
    write("stdout", stdoutDecoder.decode());
    write("stderr", stderrDecoder.decode());
    return 0;
  } catch (error) {
    try { pyodide.runPython("import sys; sys.stdout.flush(); sys.stderr.flush()"); } catch { /* Preserve the original error. */ }
    const raw = String(error?.message || error);
    const lines = raw.split("\n");
    // Remove Pyodide internals while retaining user source lines and carets.
    const userStart = lines.findIndex((line) => /File "main\.py"/.test(line));
    const useful = userStart >= 0
      ? ["Traceback (most recent call last):", ...lines.slice(userStart)].join("\n")
      : raw.replace(/^PythonError:\s*/, "");
    if (/SystemExit:\s*(?:0\s*)?$/.test(useful.trim())) return 0;
    write("stderr", `${useful.trim()}\n`);
    return 1;
  } finally {
    globals.destroy();
  }
}

self.onmessage = async (event) => {
  // Disable a second execution request, including requests from the submitted code.
  self.onmessage = null;
  const { language, code, stdin = "" } = event.data || {};
  if (typeof code !== "string" || typeof stdin !== "string") {
    write("stderr", "The runner needs code and input as text.\n");
    finish(125);
    return;
  }
  try {
    const exitCode = language === "python"
      ? await runPython(code, stdin)
      : language === "javascript" || language === "typescript"
        ? await runJavaScript(code, stdin, language)
        : (write("stderr", "Choose Python, JavaScript, or TypeScript.\n"), 125);
    finish(exitCode);
  } catch (error) {
    write("stderr", `${error instanceof Error ? error.message : String(error)}\n`);
    // Source errors are caught inside each language runner. Reaching this catch
    // means bootstrap/import loading failed, so AI must not rewrite the source.
    finish(125);
  }
};
