// Web Push without a third-party library: VAPID (RFC 8292) and aes128gcm payload encryption
// (RFC 8291), using Node's built-in crypto. The private key is in VAPID_PRIVATE_KEY (Vercel);
// the public key is not secret and lives in VAPID_PUBLIC_KEY below.

import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";

export const VAPID_PUBLIC_KEY = "BPgaRSlVfsQazQ5Ri0zGoHBr6kJycXQjf6RYHftpBkVlcb4c4SvtXFL-0MOvTMxjx_Hz1rXfbWgqnHF69JZf_5M";
const SUBJECT = "mailto:info@lemtik.com.ng";

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export function vapidConfigured() {
  const d = process.env.VAPID_PRIVATE_KEY?.trim();
  return !!d && fromB64u(d).length === 32 && !VAPID_PUBLIC_KEY.startsWith("__");
}

function vapidHeader(endpoint: string): string {
  const d = process.env.VAPID_PRIVATE_KEY!.trim();
  const pub = fromB64u(VAPID_PUBLIC_KEY);
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: "jwk" });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${VAPID_PUBLIC_KEY}`;
}

/** RFC 8291 aes128gcm encryption of one record. Exported for the local round-trip test. */
export function encryptPayload(payload: Buffer, p256dh: string, auth: string, salt = randomBytes(16)) {
  const uaPublic = fromB64u(p256dh);
  const authSecret = fromB64u(auth);
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushSubscriptionRow = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url?: string; tag?: string; requireInteraction?: boolean };

/** Sends one notification. `gone` means the browser dropped the subscription and it should be deleted. */
export async function sendPush(sub: PushSubscriptionRow, msg: PushMessage): Promise<{ ok: boolean; gone?: boolean; detail?: string }> {
  if (!vapidConfigured()) return { ok: false, detail: "Push not set up" };
  try {
    const body = encryptPayload(Buffer.from(JSON.stringify(msg)), sub.p256dh, sub.auth);
    const res = await fetch(sub.endpoint, {
      method: "POST",
      headers: { Authorization: vapidHeader(sub.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, detail: "Subscription expired" };
    if (!res.ok) return { ok: false, detail: `${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
