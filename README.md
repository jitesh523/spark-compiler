# Spark compiler

No-login coding workspace for Python, C, C++, Java, JavaScript, and TypeScript. Includes Groq-powered chat, automatic error repair with one verified rerun, undo checkpoints, stdin, run history, and browser-local session memory.

## Development

```
npm install
cp .env.example .env.local
# Set GROQ_API_KEY in .env.local
npm run dev
```

Open http://localhost:3000. The server key is optional: users may connect a personal Groq key held in memory for their visit. Server keys must never use a NEXT_PUBLIC_ prefix.

```
npm run typecheck
npm test
npm run build
```

## Runtime

Python runs in a fresh Pyodide Web Worker; JavaScript and TypeScript run in separate fresh workers. Execution has a 10-second watchdog and 64 KB output cap. The first Python run downloads the runtime. TypeScript transpiles syntax; it is not a full multi-file typechecking environment.

C (C11), C++ (C++17), and Java (Java21, class Main) compile through Wandbox via a fixed-origin server proxy. Requests have a 28-second upstream deadline. Submitted source and standard input are sent to Wandbox. Browser runtimes and compiler availability depend on an internet connection and their providers.

## AI and session memory

AI uses Groq openai/gpt-oss-120b. Code, supplied stdin, runtime errors, and the current conversation are sent to Groq. The current source and latest 200 messages, including suggested source, share a 160,000-character conversation budget. Local persistence keeps the latest 40 runs and 30 undo checkpoints. Memory remains in the current browser; exporting/importing JSON moves sessions. Credentials are excluded from persistence and exports. Clearing browser storage clears memory.

Automatic repair makes a single attempt, preserves the original source as an undo checkpoint, explains the correction, and runs the corrected code. Stop cancels the process. Infrastructure failures and timeouts do not trigger code repair. AI may make mistakes; review suggestions and output.

## Deployment

Deploy the project to Vercel with the Next.js framework. Configure GROQ_API_KEY as a sensitive production environment variable before deploying. The public site requires no user login. AI and compiler endpoints enforce bounded requests, timeouts, same-origin browser requests, and per-instance rate limits; provider account limits also apply.
