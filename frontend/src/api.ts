import type {
  ChatMessage,
  ChatResponseBody,
  ChatSession,
  LoginResponse,
  UserResponse,
} from "./types";

const BASE = "/api/v1";

/** Extract a human-readable message from FastAPI error payloads. */
function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const detail = (body as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail)) return "请求参数校验失败";
    if (detail && typeof detail === "object") {
      return (detail as { message?: string }).message ?? "请求失败";
    }
  }
  return `请求失败 (HTTP ${status})`;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, options);
  } catch {
    throw new Error("无法连接到后端服务，请确认服务已启动");
  }

  const text = await resp.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!resp.ok) {
    throw new Error(errorMessage(body, resp.status));
  }
  return body as T;
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function urlencoded(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

export const api = {
  register(email: string, password: string, username?: string): Promise<UserResponse> {
    return request<UserResponse>("/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, username: username?.trim() || null }),
    });
  },

  login(email: string, password: string): Promise<LoginResponse> {
    return request<LoginResponse>("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: urlencoded({ email, password, grant_type: "password" }),
    });
  },

  createSession(userToken: string): Promise<ChatSession> {
    return request<ChatSession>("/auth/session", {
      method: "POST",
      headers: bearer(userToken),
    });
  },

  listSessions(userToken: string): Promise<ChatSession[]> {
    return request<ChatSession[]>("/auth/sessions", {
      headers: bearer(userToken),
    });
  },

  renameSession(sessionToken: string, sessionId: string, name: string): Promise<ChatSession> {
    return request<ChatSession>(`/auth/session/${sessionId}/name`, {
      method: "PATCH",
      headers: { ...bearer(sessionToken), "Content-Type": "application/x-www-form-urlencoded" },
      body: urlencoded({ name }),
    });
  },

  deleteSession(sessionToken: string, sessionId: string): Promise<null> {
    return request<null>(`/auth/session/${sessionId}`, {
      method: "DELETE",
      headers: bearer(sessionToken),
    });
  },

  chat(sessionToken: string, messages: ChatMessage[]): Promise<ChatResponseBody> {
    return request<ChatResponseBody>("/chatbot/chat", {
      method: "POST",
      headers: { ...bearer(sessionToken), "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
  },

  getMessages(sessionToken: string): Promise<ChatResponseBody> {
    return request<ChatResponseBody>("/chatbot/messages", {
      headers: bearer(sessionToken),
    });
  },

  clearMessages(sessionToken: string): Promise<{ message: string }> {
    return request<{ message: string }>("/chatbot/messages", {
      method: "DELETE",
      headers: bearer(sessionToken),
    });
  },
};

/**
 * Stream a chat response over Server-Sent Events (SSE).
 *
 * The backend emits lines of `data: {"content": "...", "done": false}` and
 * finally `data: {"content": "", "done": true}`.
 */
export async function streamChat(
  sessionToken: string,
  messages: ChatMessage[],
  onChunk: (content: string) => void,
  signal?: AbortSignal
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}/chatbot/chat/stream`, {
      method: "POST",
      headers: {
        ...bearer(sessionToken),
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ messages }),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") return;
    throw new Error("无法连接到后端服务，请确认服务已启动");
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    let msg = `流式请求失败 (HTTP ${resp.status})`;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.detail) msg = typeof parsed.detail === "string" ? parsed.detail : msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (!payload) return false;
    try {
      const parsed = JSON.parse(payload) as { content?: string; done?: boolean };
      if (parsed.content) onChunk(parsed.content);
      if (parsed.done) return true;
    } catch {
      /* ignore malformed frames */
    }
    return false;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      if (handleLine(frame)) return;
    }
  }
  if (buffer) handleLine(buffer);
}