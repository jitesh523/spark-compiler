export type Language = "python" | "c" | "cpp" | "java" | "javascript" | "typescript";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  language?: Language;
  code?: string;
  changes?: string[];
}

export interface RunEntry {
  id: string;
  language: Language;
  code: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  createdAt: string;
}

export interface Checkpoint {
  id: string;
  language: Language;
  code: string;
  reason: string;
  createdAt: string;
}

export interface Session {
  id: string;
  createdAt: string;
  updatedAt: string;
  language: Language;
  files: Record<Language, { code: string; stdin: string }>;
  messages: ChatMessage[];
  runs: RunEntry[];
  checkpoints: Checkpoint[];
  autoFix: boolean;
}

export const SESSION_KEY = "spark-compiler.session.v1";
export const SESSION_LIMITS = {
  code: 200_000,
  stdin: 50_000,
  message: 32_000,
  suggestedCode: 30_000,
  changes: 100,
  historyCharacters: 160_000,
  output: 200_000,
  messages: 200,
  runs: 40,
  checkpoints: 30,
  importBytes: 25_000_000,
} as const;

const LANGUAGES: Language[] = ["python", "c", "cpp", "java", "javascript", "typescript"];

const STARTERS: Record<Language, string> = {
  python: `# A little code. A world of possibilities.
# Press Run, or ask Spark to help you build something.

def greet(name):
    return f"Hello, {name}! 👋"


languages = ["Python", "JavaScript", "TypeScript"]

print(greet("builder"))
print("Welcome to your coding playground.\\n")

for index, language in enumerate(languages, start=1):
    print(f"  {index}. {language}")

print("\\nMake something wonderful.")
`,
  c: `// A little code. A world of possibilities.
#include <stdio.h>

int main(void) {
    const char *languages[] = {"Python", "C", "C++", "Java"};

    printf("Hello, builder!\\n");
    printf("Welcome to your coding playground.\\n\\n");

    for (int i = 0; i < 4; i++) {
        printf("  %d. %s\\n", i + 1, languages[i]);
    }

    printf("\\nMake something wonderful.\\n");
    return 0;
}
`,
  cpp: `// A little code. A world of possibilities.
#include <iostream>
#include <string>
#include <vector>

int main() {
    std::vector<std::string> languages = {"Python", "C", "C++", "Java"};

    std::cout << "Hello, builder!\\n";
    std::cout << "Welcome to your coding playground.\\n\\n";

    for (std::size_t i = 0; i < languages.size(); ++i) {
        std::cout << "  " << i + 1 << ". " << languages[i] << '\\n';
    }

    std::cout << "\\nMake something wonderful.\\n";
    return 0;
}
`,
  java: `// A little code. A world of possibilities.
public class Main {
    public static void main(String[] args) {
        String[] languages = {"Python", "C", "C++", "Java"};

        System.out.println("Hello, builder!");
        System.out.println("Welcome to your coding playground.\\n");

        for (int i = 0; i < languages.length; i++) {
            System.out.println("  " + (i + 1) + ". " + languages[i]);
        }

        System.out.println("\\nMake something wonderful.");
    }
}
`,
  javascript: `// A little code. A world of possibilities.
// Press Run, or ask Spark to help you build something.

function greet(name) {
  return \`Hello, \${name}! 👋\`;
}

const languages = ["Python", "JavaScript", "TypeScript"];

console.log(greet("builder"));
console.log("Welcome to your coding playground.\\n");

languages.forEach((language, index) => {
  console.log(\`  \${index + 1}. \${language}\`);
});

console.log("\\nMake something wonderful.");
`,
  typescript: `// A little code. A world of possibilities.
// Press Run, or ask Spark to help you build something.

function greet(name: string): string {
  return \`Hello, \${name}! 👋\`;
}

const languages: string[] = ["Python", "JavaScript", "TypeScript"];

console.log(greet("builder"));
console.log("Welcome to your coding playground.\\n");

languages.forEach((language, index) => {
  console.log(\`  \${index + 1}. \${language}\`);
});

console.log("\\nMake something wonderful.");
`,
};

/** One browser-local workspace; credentials are deliberately absent. */
export function createSession(): Session {
  const now = new Date().toISOString();
  return {
    id: typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    language: "python",
    files: {
      python: { code: STARTERS.python, stdin: "" },
      c: { code: STARTERS.c, stdin: "" },
      cpp: { code: STARTERS.cpp, stdin: "" },
      java: { code: STARTERS.java, stdin: "" },
      javascript: { code: STARTERS.javascript, stdin: "" },
      typescript: { code: STARTERS.typescript, stdin: "" },
    },
    messages: [],
    runs: [],
    checkpoints: [],
    autoFix: true,
  };
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isId(value: unknown): value is string {
  return isString(value, 200) && value.length > 0;
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language);
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value) || !isId(value.id) || !isDate(value.createdAt)
    || (value.role !== "user" && value.role !== "assistant")
    || !isString(value.content, SESSION_LIMITS.message)
    || (value.language !== undefined && !isLanguage(value.language))
    || (value.code !== undefined && !isString(value.code, SESSION_LIMITS.suggestedCode))
    || (value.changes !== undefined && (!Array.isArray(value.changes)
      || value.changes.length > SESSION_LIMITS.changes || !value.changes.every((change) => isString(change, 4_000))))) {
    return null;
  }
  return {
    id: value.id,
    role: value.role,
    content: value.content,
    createdAt: value.createdAt,
    ...(value.language !== undefined ? { language: value.language as Language } : {}),
    ...(value.code !== undefined ? { code: value.code as string } : {}),
    ...(value.changes !== undefined ? { changes: [...value.changes as string[]] } : {}),
  };
}

function parseRun(value: unknown): RunEntry | null {
  if (!isRecord(value) || !isId(value.id) || !isLanguage(value.language)
    || !isDate(value.createdAt) || !isString(value.code, SESSION_LIMITS.code)
    || !isString(value.stdout, SESSION_LIMITS.output) || !isString(value.stderr, SESSION_LIMITS.output)
    || typeof value.exitCode !== "number" || !Number.isSafeInteger(value.exitCode)
    || typeof value.durationMs !== "number" || !Number.isFinite(value.durationMs) || value.durationMs < 0) {
    return null;
  }
  return {
    id: value.id,
    language: value.language,
    code: value.code,
    stdout: value.stdout,
    stderr: value.stderr,
    exitCode: value.exitCode,
    durationMs: value.durationMs,
    createdAt: value.createdAt,
  };
}

function parseCheckpoint(value: unknown): Checkpoint | null {
  if (!isRecord(value) || !isId(value.id) || !isLanguage(value.language)
    || !isDate(value.createdAt) || !isString(value.code, SESSION_LIMITS.code)
    || !isString(value.reason, 1_000)) {
    return null;
  }
  return {
    id: value.id,
    language: value.language,
    code: value.code,
    reason: value.reason,
    createdAt: value.createdAt,
  };
}

function parseList<T>(value: unknown, maximum: number, parse: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const entries: T[] = [];
  for (const item of value) {
    const entry = parse(item);
    if (entry === null) return null;
    entries.push(entry);
  }
  return entries;
}

/** Rebuild only known fields so imported extras can never become persisted secrets. */
function validateSession(value: unknown): Session | null {
  if (!isRecord(value) || !isId(value.id) || !isDate(value.createdAt) || !isDate(value.updatedAt)
    || !isLanguage(value.language) || typeof value.autoFix !== "boolean" || !isRecord(value.files)) {
    return null;
  }
  const files = {} as Session["files"];
  for (const language of LANGUAGES) {
    const file = value.files[language];
    if (!isRecord(file) || !isString(file.code, SESSION_LIMITS.code) || !isString(file.stdin, SESSION_LIMITS.stdin)) {
      return null;
    }
    files[language] = { code: file.code, stdin: file.stdin };
  }
  const messages = parseList(value.messages, SESSION_LIMITS.messages, parseMessage);
  const runs = parseList(value.runs, SESSION_LIMITS.runs, parseRun);
  const checkpoints = parseList(value.checkpoints, SESSION_LIMITS.checkpoints, parseCheckpoint);
  if (messages === null || runs === null || checkpoints === null
    || messages.reduce((total, message) => total + message.content.length + (message.code?.length ?? 0), 0) > SESSION_LIMITS.historyCharacters) return null;
  return {
    id: value.id,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    language: value.language,
    files,
    messages,
    runs,
    checkpoints,
    autoFix: value.autoFix,
  };
}

/** Invalid or oversized imports return null; callers can keep the current workspace. */
export function parseSession(json: string): Session | null {
  if (typeof json !== "string" || json.length > SESSION_LIMITS.importBytes) return null;
  try {
    return validateSession(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The same conversation window is used in memory, saved sessions, and AI requests. */
export function boundMessages(history: ChatMessage[]): ChatMessage[] {
  let characters = 0;
  const messages: ChatMessage[] = [];
  for (const message of history.slice(-SESSION_LIMITS.messages).reverse()) {
    const size = message.content.length + (message.code?.length ?? 0);
    if (characters + size > SESSION_LIMITS.historyCharacters) break;
    messages.unshift(message);
    characters += size;
  }
  return messages;
}

function boundedSession(session: Session): Session | null {
  return validateSession({
    ...session,
    messages: boundMessages(session.messages),
    runs: session.runs.slice(-SESSION_LIMITS.runs),
    checkpoints: session.checkpoints.slice(-SESSION_LIMITS.checkpoints),
  });
}

/** Safe during SSR, private browsing, disabled storage, and corrupted saved data. */
export function loadSession(): Session {
  try {
    if (typeof window === "undefined") return createSession();
    const stored = window.localStorage.getItem(SESSION_KEY);
    return (stored ? parseSession(stored) : null) ?? createSession();
  } catch {
    return createSession();
  }
}

/** False lets the UI warn that this browser could not save the workspace. */
export function saveSession(session: Session): boolean {
  try {
    if (typeof window === "undefined") return false;
    const valid = boundedSession(session);
    if (!valid) return false;
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(valid));
    return true;
  } catch {
    // Quota errors must not replace the last successfully saved session.
    return false;
  }
}

/** JSON contains code, conversations, and history only; no connection credentials. */
export function exportSession(session: Session): string {
  const valid = boundedSession(session);
  if (!valid) throw new Error("This session contains invalid or oversized data.");
  return JSON.stringify(valid, null, 2);
}
