import { readFileSync } from "node:fs";
import { X509Certificate, createVerify } from "node:crypto";
import { decode as cborDecode, encode as cborEncode } from "cbor";

// Pinned at build time, not fetched at runtime - matches this repo's existing
// convention of committing trust material rather than resolving it live.
const rootCert = new X509Certificate(
  readFileSync(new URL("../../certs/AWS_NitroEnclaves_Root-G1.pem", import.meta.url)),
);

export interface AttestationDocument {
  moduleId: string;
  digest: string;
  timestamp: number;
  pcrs: Map<number, Buffer>;
  publicKey?: Buffer;
  userData?: Buffer;
  nonce?: Buffer;
}

// A Nitro attestation document is a COSE_Sign1 structure (RFC 8152):
// [protected: bstr, unprotected: map, payload: bstr, signature: bstr].
// The payload, once CBOR-decoded, is a map with module_id/digest/timestamp/
// pcrs/certificate/cabundle/etc. Signature is ECDSA P-384/SHA-384 (COSE
// alg ES384) in raw IEEE P1363 (r||s) form, not DER.
export function verifyAttestationDocument(raw: Buffer): AttestationDocument {
  const coseSign1 = cborDecode(raw);
  if (!Array.isArray(coseSign1) || coseSign1.length !== 4) {
    throw new Error("not a COSE_Sign1 structure");
  }
  const [protectedHeaderBytes, , payloadBytes, signature] = coseSign1 as [
    Buffer,
    unknown,
    Buffer,
    Buffer,
  ];

  // Unlike the pcrs sub-map below (integer keys, decodes as a Map since
  // object keys can't be numbers), this top-level map has all-string keys
  // and cbor decodes it as a plain object, not a Map.
  const payload = cborDecode(payloadBytes) as {
    module_id: string;
    digest: string;
    timestamp: number;
    pcrs: Map<number, Buffer>;
    certificate: Buffer;
    cabundle: Buffer[];
    public_key?: Buffer;
    user_data?: Buffer;
    nonce?: Buffer;
  };

  const { certificate, cabundle } = payload;
  if (!certificate || !Array.isArray(cabundle)) {
    throw new Error("attestation document missing certificate/cabundle");
  }

  verifyCertChain(certificate, cabundle);
  verifySignature(protectedHeaderBytes, payloadBytes, signature, certificate);

  if (!(payload.pcrs instanceof Map)) {
    throw new Error("attestation document missing pcrs map");
  }

  return {
    moduleId: payload.module_id,
    digest: payload.digest,
    timestamp: payload.timestamp,
    pcrs: payload.pcrs,
    publicKey: payload.public_key,
    userData: payload.user_data,
    nonce: payload.nonce,
  };
}

// cabundle is ordered from the cert issued directly by the pinned root
// (cabundle[0]) down to the one that issued the leaf certificate
// (cabundle[last]) - walk it: root -> cabundle[0] -> ... -> leaf.
function verifyCertChain(leafDer: Buffer, cabundleDer: Buffer[]): void {
  const chain = [...cabundleDer.map((der) => new X509Certificate(der)), new X509Certificate(leafDer)];

  let issuerPublicKey = rootCert.publicKey;
  const now = new Date();
  for (const cert of chain) {
    if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) {
      throw new Error(`certificate not currently valid: ${cert.subject}`);
    }
    if (!cert.verify(issuerPublicKey)) {
      throw new Error(`certificate not signed by expected issuer: ${cert.subject}`);
    }
    issuerPublicKey = cert.publicKey;
  }
}

// COSE Sig_structure for Signature1 (RFC 8152 4.4): the actual bytes signed
// are ["Signature1", protected header, external_aad (empty), payload], CBOR
// encoded as an array - not just the raw payload.
function verifySignature(
  protectedHeaderBytes: Buffer,
  payloadBytes: Buffer,
  signature: Buffer,
  leafCertDer: Buffer,
): void {
  const sigStructure = cborEncode(["Signature1", protectedHeaderBytes, Buffer.alloc(0), payloadBytes]);
  const leafCert = new X509Certificate(leafCertDer);

  const verifier = createVerify("SHA384");
  verifier.update(sigStructure);
  const ok = verifier.verify({ key: leafCert.publicKey, dsaEncoding: "ieee-p1363" }, signature);
  if (!ok) {
    throw new Error("attestation document signature invalid");
  }
}

export function pcrHex(pcrs: Map<number, Buffer>, index: number): string | undefined {
  return pcrs.get(index)?.toString("hex");
}
