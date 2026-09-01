export type AutonomousControllerRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
};

export function autonomousControllerConfig() {
  const baseUrl = process.env.AUTONOMOUS_CONTROLLER_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.AUTONOMOUS_CONTROLLER_KEY?.trim();
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

export async function requestAutonomousController<T>(
  path: string,
  options: AutonomousControllerRequestOptions = {},
): Promise<T | null> {
  const config = autonomousControllerConfig();
  if (!config) return null;

  const init: RequestInit = {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Api-Key": config.apiKey,
      "X-Client-Name": "c4isod-dashboard",
    },
  };
  if (options.body && init.method !== "GET") {
    init.body = JSON.stringify(options.body);
  }

  const response = await fetch(`${config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, init);
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`Autonomous controller request failed: ${response.status} ${message}`.trim());
  }
  return response.json().catch(() => null);
}
