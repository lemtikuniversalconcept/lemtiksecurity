/**
 * What's printed in a checkpoint QR code: the stop's id and its secret. The server compares the
 * secret with the stored one, so a code only works at the stop it was printed for, and only
 * until that stop is deleted.
 */
const PREFIX = "LEMTIK-CP";

export function encodeCheckpoint(waypointId: string, token: string) {
  return `${PREFIX}:${waypointId}:${token}`;
}

export function parseCheckpoint(text: string): { waypointId: string; token: string } | null {
  const parts = text.trim().split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, waypointId, token] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(waypointId) || !/^[0-9a-f]{8,64}$/i.test(token)) return null;
  return { waypointId, token };
}
