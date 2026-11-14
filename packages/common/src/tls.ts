import { createHash, X509Certificate } from "node:crypto";
import type { PeerCertificate } from "node:tls";

// Returns a checkServerIdentity callback that pins the peer's leaf SPKI on top of normal CA verification.
export function pinnedServerIdentity(pinSha256: string, service: string) {
  const want = pinSha256.toLowerCase();
  return (_hostname: string, cert: PeerCertificate): Error | undefined => {
    const spki = new X509Certificate(cert.raw).publicKey.export({ type: "spki", format: "der" });
    const got = createHash("sha256").update(spki).digest("hex");
    return got === want ? undefined : new Error(`${service} public key does not match pinned hash`);
  };
}
