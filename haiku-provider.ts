export type HaikuProviderName = "ANTHROPIC" | "OPENROUTER";

export interface HaikuProviderConfig {
  provider: HaikuProviderName;
  configured: boolean;
  reason: string;
  apiKey: string;
  model: string;
  endpoint: string;
  headers: Record<string, string>;
}

type EnvLike = Record<string, string | undefined>;
type FetchLike = typeof fetch;

function clean(value: string | undefined): string {
  return (value || "").trim();
}

export function resolveHaikuProvider(env: EnvLike): HaikuProviderConfig {
  const selected = clean(env.OPTION_RECORDER_AI_PROVIDER).toUpperCase() || "ANTHROPIC";

  if (selected === "OPENROUTER") {
    const apiKey = clean(env.OPENROUTER_API_KEY);
    const model = clean(env.OPENROUTER_MODEL);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };
    const referer = clean(env.OPENROUTER_HTTP_REFERER);
    const title = clean(env.OPENROUTER_APP_TITLE);
    if (referer) headers["HTTP-Referer"] = referer;
    if (title) headers["X-Title"] = title;

    return {
      provider: "OPENROUTER",
      configured: Boolean(apiKey && model),
      reason: !apiKey ? "OPENROUTER_API_KEY_REQUIRED" : !model ? "OPENROUTER_MODEL_REQUIRED" : "READY",
      apiKey,
      model,
      endpoint: "https://openrouter.ai/api/v1/messages",
      headers,
    };
  }

  const apiKey = clean(env.ANTHROPIC_API_KEY);
  const model = clean(env.ANTHROPIC_MODEL);
  const version = clean(env.ANTHROPIC_VERSION) || "2023-06-01";
  return {
    provider: "ANTHROPIC",
    configured: Boolean(apiKey && model),
    reason: !apiKey ? "ANTHROPIC_API_KEY_REQUIRED" : !model ? "ANTHROPIC_MODEL_REQUIRED" : "READY",
    apiKey,
    model,
    endpoint: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": version,
    },
  };
}

export async function callHaikuProvider(
  config: HaikuProviderConfig,
  body: unknown,
  maxTokens: number,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  if (!config.configured) throw new Error(`HAIKU_NOT_CONFIGURED:${config.reason}`);

  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: JSON.stringify(body) }],
    }),
  });

  if (!response.ok) throw new Error(`HAIKU_HTTP_${response.status}`);

  const data = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  return (data.content || [])
    .map((x) => typeof x.text === "string" ? x.text : "")
    .filter(Boolean)
    .join("\n");
}
