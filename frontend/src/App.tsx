import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import AuthView from "./components/AuthView";
import ChatView from "./components/ChatView";
import type { ChatSession } from "./types";

const TOKEN_KEY = "wa_user_token";

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export default function App() {
  const [userToken, setUserToken] = useState<string | null>(() => loadToken());
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const handleAuthed = useCallback((token: string) => {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* storage may be unavailable */
    }
    setUserToken(token);
  }, []);

  const handleLogout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setUserToken(null);
    setSessions([]);
    setActiveSessionId(null);
    setBootstrapError(null);
  }, []);

  // Load the session list after login.
  useEffect(() => {
    if (!userToken) return;
    let cancelled = false;
    setBusy(true);
    setBootstrapError(null);
    api
      .listSessions(userToken)
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        setActiveSessionId((prev) =>
          prev && list.some((s) => s.session_id === prev) ? prev : list[0]?.session_id ?? null
        );
      })
      .catch((err) => {
        if (cancelled) setBootstrapError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userToken]);

  if (!userToken) {
    return <AuthView onAuthed={handleAuthed} />;
  }

  const activeSession = sessions.find((s) => s.session_id === activeSessionId) ?? null;

  const handleCreateSession = async () => {
    if (!userToken || busy) return;
    setBootstrapError(null);
    try {
      const created = await api.createSession(userToken);
      setSessions((prev) => [created, ...prev]);
      setActiveSessionId(created.session_id);
    } catch (err) {
      setBootstrapError((err as Error).message);
    }
  };

  const handleRenameSession = async (id: string, name: string) => {
    const session = sessions.find((s) => s.session_id === id);
    if (!session) return;
    try {
      const updated = await api.renameSession(session.token.access_token, id, name);
      setSessions((prev) => prev.map((s) => (s.session_id === id ? { ...s, name: updated.name } : s)));
    } catch (err) {
      setBootstrapError((err as Error).message);
    }
  };

  const handleDeleteSession = async (id: string) => {
    const session = sessions.find((s) => s.session_id === id);
    if (!session) return;
    try {
      await api.deleteSession(session.token.access_token, id);
      const remaining = sessions.filter((s) => s.session_id !== id);
      setSessions(remaining);
      if (activeSessionId === id) {
        setActiveSessionId(remaining[0]?.session_id ?? null);
      }
    } catch (err) {
      setBootstrapError((err as Error).message);
    }
  };

  return (
    <>
      {bootstrapError && <div className="top-error">{bootstrapError}</div>}
      <ChatView
        sessions={sessions}
        activeSession={activeSession}
        busy={busy}
        onCreateSession={handleCreateSession}
        onSelectSession={setActiveSessionId}
        onRenameSession={handleRenameSession}
        onDeleteSession={handleDeleteSession}
        onLogout={handleLogout}
      />
    </>
  );
}