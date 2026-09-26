import type { ChatMessage } from "../types";

interface Props {
  message: ChatMessage;
  streaming?: boolean;
}

export default function MessageBubble({ message, streaming }: Props) {
  const isUser = message.role === "user";
  const empty = !message.content && message.role === "assistant";

  return (
    <div className={`msg-row ${isUser ? "user" : "assistant"}`}>
      {!isUser && <div className="msg-avatar">🤖</div>}
      <div className={`msg-bubble ${isUser ? "user" : "assistant"}`}>
        {empty || streaming ? (
          <span className="typing">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <span className="msg-text">{message.content}</span>
        )}
      </div>
    </div>
  );
}