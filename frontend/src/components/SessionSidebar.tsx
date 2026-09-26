import { useState } from "react";
import type { ChatSession } from "../types";

interface Props {
  sessions: ChatSession[];
  activeId: string | null;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  busy: boolean;
}

export default function SessionSidebar({
  sessions,
  activeId,
  onCreate,
  onSelect,
  onRename,
  onDelete,
  onLogout,
  busy,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  function startEdit(session: ChatSession) {
    setEditingId(session.session_id);
    setDraft(session.name);
  }

  function commitEdit(id: string) {
    const name = draft.trim();
    setEditingId(null);
    if (name) onRename(id, name);
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">🤖 Web Assistant</span>
        <button className="btn primary sidebar-new" onClick={onCreate} disabled={busy} title="新建会话">
          ＋ 新会话
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <p className="session-empty">{busy ? "加载中…" : "还没有会话，点击“新会话”开始"}</p>
        )}
        {sessions.map((session) => {
          const active = session.session_id === activeId;
          const editing = session.session_id === editingId;
          return (
            <div
              key={session.session_id}
              className={`session-item ${active ? "active" : ""}`}
              onClick={() => !editing && onSelect(session.session_id)}
            >
              {editing ? (
                <input
                  className="session-edit"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitEdit(session.session_id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit(session.session_id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="session-name" title={session.name}>
                  {session.name || "新会话"}
                </span>
              )}
              {!editing && (
                <span className="session-actions">
                  <button
                    type="button"
                    title="重命名"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(session);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`删除会话“${session.name || "新会话"}”？`)) onDelete(session.session_id);
                    }}
                  >
                    🗑
                  </button>
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <button className="btn ghost" onClick={onLogout}>
          退出登录
        </button>
      </div>
    </aside>
  );
}