/** Code runs in a disposable browser worker, never on the application server. */
export type Language = "python" | "c" | "cpp" | "java" | "javascript" | "typescript";

export type RunResult = {
  stdout: string;
  stderr: string;
  /** 124 = time limit, 125 = runner/service unavailable, 130 = stopped. */
  exitCode: number;
  durationMs: number;
};

export type ExecuteCodeOptions = {
  language: Language;
  code: string;
  stdin?: string;
  onStatus?: (status: string) => void;
};

const EXECUTION_TIMEOUT_MS = 10_000;
const STARTUP_TIMEOUT_MS = 60_000;
const OUTPUT_LIMIT = 65_536;

export function executeCode({ language, code, stdin = "", onStatus }: ExecuteCodeOptions): {
  promise: Promise<RunResult>;
  cancel: () => void;
} {
  const startedAt = performance.now();
  let worker: Worker | undefined;
  let remoteController: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let executionStarted = false;
  let stdout = "";
  let stderr = "";
  let outputLength = 0;
  let resolveResult!: (result: RunResult) => void;
  const promise = new Promise<RunResult>((resolve) => { resolveResult = resolve; });

  const finish = (exitCode: number, message = "") => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    worker?.terminate();
    remoteController?.abort();
    if (message) stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}${message}\n`;
    resolveResult({ stdout, stderr, exitCode, durationMs: Math.round(performance.now() - startedAt) });
  };

  const armTimeout = (running: boolean) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => finish(124, running
      ? "Time limit exceeded (10 seconds). Check for an infinite loop, or try a smaller input."
      : "The language runtime took too long to load. Check your connection and run again."),
    running ? EXECUTION_TIMEOUT_MS : STARTUP_TIMEOUT_MS);
  };

  try {
    if (language === "c" || language === "cpp" || language === "java") {
      remoteController = new AbortController();
      const label = { c: "C", cpp: "C++", java: "Java" }[language];
      try { onStatus?.(`Compiling and running ${label}…`); } catch { /* Optional UI callback. */ }
      timer = setTimeout(() => finish(124, "The compiler service took too long to respond (30 seconds). Try again shortly."), 30_000);
      void fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, code, stdin }),
        signal: remoteController.signal,
      }).then(async (response) => {
        const result = await response.json();
        if (settled) return;
        if (!response.ok) {
          finish(125, typeof result.error === "string" ? result.error : "The compiler service is unavailable. Try again shortly.");
          return;
        }
        if (typeof result.stdout !== "string" || typeof result.stderr !== "string" || typeof result.exitCode !== "number") {
          finish(125, "The compiler service returned an unreadable result.");
          return;
        }
        stdout = result.stdout.slice(0, OUTPUT_LIMIT);
        stderr = result.stderr.slice(0, OUTPUT_LIMIT - stdout.length);
        if (result.stdout.length + result.stderr.length > OUTPUT_LIMIT) finish(1, "Output limit exceeded (64 KB). Execution stopped.");
        else finish(result.exitCode);
      }).catch(() => {
        if (!settled) finish(125, "Could not reach the compiler service. Check your connection and try again.");
      });
    } else if (typeof Worker === "undefined") {
      finish(125, "Your browser does not support Web Workers. Open this compiler in a current browser.");
    } else {
      worker = new Worker("/runtime-worker.js", { name: `spark-${language}` });
      armTimeout(false);
      worker.onmessage = (event: MessageEvent) => {
        if (settled || !event.data || typeof event.data !== "object") return;
        const message = event.data;
        if (message.type === "status" && typeof message.status === "string") {
          if (message.phase === "running") { executionStarted = true; armTimeout(true); }
          // UI callbacks must never prevent the worker from being stopped or settled.
          try { onStatus?.(message.status); } catch { /* A caller's status callback is optional. */ }
        } else if (message.type === "output" && typeof message.text === "string") {
          const remaining = OUTPUT_LIMIT - outputLength;
          const text = message.text.slice(0, Math.max(remaining, 0));
          if (message.stream === "stderr") stderr += text;
          else stdout += text;
          outputLength += text.length;
          if (message.text.length > remaining) finish(1, "Output limit exceeded (64 KB). Execution stopped.");
        } else if (message.type === "done") {
          finish(typeof message.exitCode === "number" ? message.exitCode : 125);
        } else if (message.type === "output-limit") {
          finish(1, "Output limit exceeded (64 KB). Execution stopped.");
        }
      };
      worker.onerror = (event) => {
        event.preventDefault();
        finish(executionStarted ? 1 : 125, event.message || "The code runner could not start. Reload the page and try again.");
      };
      worker.onmessageerror = () => finish(125, "The code runner returned an unreadable result.");
      worker.postMessage({ language, code, stdin, outputLimit: OUTPUT_LIMIT });
    }
  } catch (error) {
    finish(125, error instanceof Error ? error.message : "The code runner could not start.");
  }

  return { promise, cancel: () => finish(130, "Execution stopped.") };
}
