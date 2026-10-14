// PUT to the presigned S3 URL with progress. fetch() has no upload progress,
// so this uses XMLHttpRequest.
export function uploadWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload to S3 failed (HTTP ${xhr.status}).`));
    xhr.onerror = () => reject(new Error("Upload to S3 failed (network error)."));
    xhr.send(file);
  });
}

const CONTENT_TYPES: Record<string, string> = {
  wav: "audio/wav",
  flac: "audio/flac",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  webm: "audio/webm",
};

// Browsers report audio MIME types inconsistently; the extension decides.
export function audioContentType(file: File): string | undefined {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return CONTENT_TYPES[ext];
}
