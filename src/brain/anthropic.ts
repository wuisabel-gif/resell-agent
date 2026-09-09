// Tiny Anthropic Messages API client. No SDK dependency — one fetch call.

export interface Msg {
  role: "user" | "assistant";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            source: { type: "base64"; media_type: string; data: string };
          }
      >;
}

export function messagesEndpoint(baseUrl = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com"): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
}

export function authenticationHeaders(
  authToken = process.env.ANTHROPIC_AUTH_TOKEN,
  apiKey = process.env.ANTHROPIC_API_KEY
): Record<string, string> {
  if (authToken?.trim()) return { Authorization: `Bearer ${authToken.trim()}` };
  if (apiKey?.trim()) return { "x-api-key": apiKey.trim() };
  throw new Error("Missing env ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY.");
}

export async function complete(system: string, messages: Msg[], maxTokens = 1000): Promise<string> {
  const res = await fetch(messagesEndpoint(), {
    method: "POST",
    headers: {
      ...authenticationHeaders(),
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5", max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);

  const j = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return j.content.map((b) => b.text ?? "").join("").trim();
}

// Models sometimes wrap JSON in prose or ```json fences. Pull out the object.
export function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error(`no JSON in model reply: ${raw.slice(0, 200)}`);
  return JSON.parse(body.slice(start, end + 1)) as T;
}
