export type RelationshipApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
};

export function relationshipApiConfig() {
  const baseUrl = process.env.RELATIONSHIP_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.RELATIONSHIP_API_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export async function requestRelationshipApi<T>(
  path: string,
  options: RelationshipApiRequestOptions = {},
): Promise<T | null> {
  const config = relationshipApiConfig();
  if (!config) return null;

  const url = new URL(`${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value == null) continue;
    url.searchParams.set(key, String(value));
  }

  const init: RequestInit = {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      "X-Client-Name": "c4isod-dashboard",
      ...(options.headers ?? {}),
    },
  };

  if (options.body && init.method !== "GET") {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(url.toString(), init);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Relationship API request failed: ${response.status} ${message}`.trim());
  }
  return response.json().catch(() => null);
}
