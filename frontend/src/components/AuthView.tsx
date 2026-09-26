import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";

interface Props {
  onAuthed: (token: string) => void;
}

const PASSWORD_HINT = "密码需 8–64 位，且包含大小写字母、数字和特殊字符";

export default function AuthView({ onAuthed }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const token =
        mode === "login"
          ? (await api.login(email.trim(), password)).access_token
          : (await api.register(email.trim(), password, username)).token.access_token;
      onAuthed(token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function switchMode(next: "login" | "register") {
    setMode(next);
    setError(null);
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-brand">
          <span className="auth-logo">🤖</span>
          <h1>Web Assistant</h1>
          <p>{mode === "login" ? "登录以继续对话" : "创建一个新账户"}</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            登录
          </button>
          <button
            type="button"
            className={mode === "register" ? "active" : ""}
            onClick={() => switchMode("register")}
          >
            注册
          </button>
        </div>

        <label className="field">
          <span>邮箱</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            autoComplete="email"
          />
        </label>

        {mode === "register" && (
          <label className="field">
            <span>昵称（可选）</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="展示给助手的名字"
              maxLength={50}
              autoComplete="nickname"
            />
          </label>
        )}

        <label className="field">
          <span>密码</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "register" ? "字母 + 数字 + 特殊字符" : "你的密码"}
            required
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>

        {mode === "register" && <p className="hint">{PASSWORD_HINT}</p>}

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" className="btn primary auth-submit" disabled={loading}>
          {loading ? "请稍候…" : mode === "login" ? "登录" : "注册并登录"}
        </button>
      </form>
    </div>
  );
}