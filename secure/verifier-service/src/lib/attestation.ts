import { createVerify, X509Certificate } from "node:crypto";
import { decode as cborDecode, encode as cborEncode } from "cbor";

// Downloaded from https://aws-nitro-enclaves.amazonaws.com/AWS_NitroEnclaves_Root-G1.zip (AWS's documented
// distribution channel) and pinned inline - a bundler-relative file path here breaks across bundle formats
// and isn't guaranteed to be packaged into the Lambda artifact anyway.
const AWS_NITRO_ENCLAVES_ROOT_G1_PEM = `-----BEGIN CERTIFICATE-----
MIICETCCAZagAwIBAgIRAPkxdWgbkK/hHUbMtOTn+FYwCgYIKoZIzj0EAwMwSTEL
MAkGA1UEBhMCVVMxDzANBgNVBAoMBkFtYXpvbjEMMAoGA1UECwwDQVdTMRswGQYD
VQQDDBJhd3Mubml0cm8tZW5jbGF2ZXMwHhcNMTkxMDI4MTMyODA1WhcNNDkxMDI4
MTQyODA1WjBJMQswCQYDVQQGEwJVUzEPMA0GA1UECgwGQW1hem9uMQwwCgYDVQQL
DANBV1MxGzAZBgNVBAMMEmF3cy5uaXRyby1lbmNsYXZlczB2MBAGByqGSM49AgEG
BSuBBAAiA2IABPwCVOumCMHzaHDimtqQvkY4MpJzbolL//Zy2YlES1BR5TSksfbb
48C8WBoyt7F2Bw7eEtaaP+ohG2bnUs990d0JX28TcPQXCEPZ3BABIeTPYwEoCWZE
h8l5YoQwTcU/9KNCMEAwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUkCW1DdkF
R+eWw5b6cp3PmanfS5YwDgYDVR0PAQH/BAQDAgGGMAoGCCqGSM49BAMDA2kAMGYC
MQCjfy+Rocm9Xue4YnwWmNJVA44fA0P5W2OpYow9OYCVRaEevL8uO1XYru5xtMPW
rfMCMQCi85sWBbJwKKXdS6BptQFuZbT73o/gBh1qUxl/nNr12UO8Yfwr6wPLb+6N
IwLz3/Y=
-----END CERTIFICATE-----`;

const rootCert = new X509Certificate(AWS_NITRO_ENCLAVES_ROOT_G1_PEM);

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
  const [protectedHeaderBytes, , payloadBytes, signature] = coseSign1 as [Buffer, unknown, Buffer, Buffer];

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
