import busboy from "busboy";

export interface ParsedUpload {
  fields: Record<string, string>;
  file: Buffer | undefined;
}

// Parses a multipart/form-data body (as delivered by API Gateway) into its text fields and the single binary
// file field. The upload form carries 'algorithmId' as text and 'image' as the docker tarball file field.
export function parseMultipart(body: Buffer, contentType: string): Promise<ParsedUpload> {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: { "content-type": contentType } });
    const fields: Record<string, string> = {};
    const chunks: Buffer[] = [];
    let sawFile = false;
    let settled = false;

    bb.on("field", (name, value) => {
      fields[name] = value;
    });
    bb.on("file", (_name, stream) => {
      sawFile = true;
      stream.on("data", (chunk: unknown) => {
        if (chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk));
      });
    });
    bb.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    bb.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({ fields, file: sawFile ? Buffer.concat(chunks) : undefined });
    });

    bb.end(body);
  });
}
