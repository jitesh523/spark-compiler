export type AILanguage = "python" | "c" | "cpp" | "java" | "javascript" | "typescript";

export type AIHistoryMessage = {
  role: "user" | "assistant";
  content: string;
  language?: AILanguage;
  code?: string;
  changes?: string[];
};

export type AIRequest = {
  action: "chat" | "fix";
  language: AILanguage;
  code: string;
  stdin?: string;
  error?: string;
  message?: string;
  history?: AIHistoryMessage[];
  /** Supplied for this request only. Never persist this field with session data. */
  apiKey?: string;
};

export type AIResponse = {
  explanation: string;
  /** Complete replacement source, or null when no edit is appropriate. */
  code: string | null;
  changes: string[];
};

export type AIErrorResponse = { error: string };

export type AIStatusResponse = { configured: boolean; model: string };
