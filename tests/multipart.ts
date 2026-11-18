type FilePart = { name: string; filename: string; type: string; data: Buffer };
type FieldPart = { name: string; value: string };

export function multipartBody(parts: Array<FilePart | FieldPart>): { contentType: string; payload: Buffer } {
  const boundary = '----apartments-test-boundary';
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if ('value' in part) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
      continue;
    }
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type}\r\n\r\n`,
      ),
    );
    chunks.push(part.data);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat(chunks),
  };
}
