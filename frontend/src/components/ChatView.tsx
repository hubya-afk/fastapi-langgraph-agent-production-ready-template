import type { ChatSession } from "../types";
import ChatPanel from "./ChatPanel";
import SessionSidebar from "./SessionSidebar";

interface Props {
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  busy: boolean;
  onCreateSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, name: string) => void;
  onDeleteSession: (id: string) => void;
  onLogout: () => void;
}

export default function ChatView({
  sessions,
  activeSession,
  busy,
  onCreateSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onLogout,
}: Props) {
  return (
    <div className="app-shell">
      <SessionSidebar
        sessions={sessions}
        activeId={activeSession?.session_id ?? null}
        onCreate={onCreateSession}
        onSelect={onSelectSession}
        onRename={onRenameSession}
        onDelete={onDeleteSession}
        onLogout={onLogout}
        busy={busy}
      />
      <ChatPanel session={activeSession} />
    </div>
  );
}