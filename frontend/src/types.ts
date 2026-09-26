export interface Token {
  access_token: string;
  token_type: string;
  expires_at: string;
}

/**
 * `POST /auth/login` returns the token flattened at the top level, while
 * `POST /auth/register` and the session endpoints nest it under `token`.
 */
export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  request_id?: string;
}

export interface UserResponse {
  id: number;
  email: string;
  username: string | null;
  token: Token;
  request_id?: string;
}

export interface ChatSession {
  session_id: string;
  name: string;
  token: Token;
  request_id?: string;
}

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  role: Role;
  content: string;
}

export interface ChatResponseBody {
  messages: ChatMessage[];
  request_id?: string;
}