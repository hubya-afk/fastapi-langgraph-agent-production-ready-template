import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { api, streamChat } from "../api";
import type { ChatMessage, ChatSession } from "../types";
import MessageBubble from "./MessageBubble";

interface Props {
  session: ChatSession | null;
}

export default function ChatPanel({ session }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Load conversation history whenever the active session changes.
  useEffect(() => {
    setMessages([]);
    setError(null);
    setInput("");
    if (!session) return;

    let cancelled = false;
    setLoadingHistory(true);
    api
      .getMessages(session.token.access_token)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.session_id, session?.token.access_token]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function appendAssistantChunk(chunk: string) {
    setMessages((prev) => {
      const copy = [...prev];
      const last = copy[copy.length - 1];
      if (last && last.role === "assistant") {
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
      }
      return copy;
    });
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || !session || streaming) return;
    setInput("");
    setError(null);

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      await streamChat(session.token.access_token, [userMsg], appendAssistantChunk, controller.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError((err as Error).message);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      // Drop a trailing empty assistant bubble (e.g. the stream ended with no content).
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && last.content === "" ? prev.slice(0, -1) : prev;
      });
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  async function handleClear() {
    if (!session) return;
    if (!confirm("确定清空当前会话的记录？")) return;
    try {
      await api.clearMessages(session.token.access_token);
      setMessages([]);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!session) {
    return (
      <main className="chat">
        <div className="chat-placeholder">
          <div className="chat-placeholder-icon">🤖</div>
          <p>选择或新建一个会话，开始对话吧</p>
        </div>
      </main>
    );
  }

  return (
    <main className="chat">
      <div className="chat-header">
        <div className="chat-header-title">{session.name || "新会话"}</div>
        <div className="chat-header-actions">
          <button className="btn ghost" onClick={handleClear} disabled={streaming}>
            清空记录
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {loadingHistory && <div className="chat-loading">加载历史消息…</div>}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} streaming={streaming && i === messages.length - 1 && m.role === "assistant"} />
        ))}
        <div ref={bottomRef} />
      </div>

      {error && <div className="chat-error">{error}</div>}

      <div className="chat-input-bar">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          rows={1}
          disabled={streaming}
        />
        {streaming ? (
          <button className="btn danger" onClick={handleStop}>
            停止
          </button>
        ) : (
          <button className="btn primary" onClick={handleSend} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
    </main>
  );
}