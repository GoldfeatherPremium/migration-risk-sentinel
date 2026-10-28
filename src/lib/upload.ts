export const MAX_UPLOAD_BYTES = 1024 * 1024; // 1 MB per file
export const MAX_UPLOAD_FILES = 50;

export interface UploadResult {
  files: { path: string; content: string }[];
  rejected: { name: string; reason: string }[];
}

/** Keep only a safe, display-friendly file name (no directories or control characters). */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload.sql";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").slice(0, 120);
  return cleaned || "upload.sql";
}

/** Read user-selected files locally. Nothing is uploaded anywhere. */
export async function readSqlFiles(
  list: FileList | File[],
  existing: number,
): Promise<UploadResult> {
  const files: UploadResult["files"] = [];
  const rejected: UploadResult["rejected"] = [];
  for (const f of Array.from(list)) {
    const name = sanitizeFileName(f.name);
    if (!name.toLowerCase().endsWith(".sql")) {
      rejected.push({ name, reason: "only .sql files are accepted" });
      continue;
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      rejected.push({ name, reason: "larger than 1 MB" });
      continue;
    }
    if (existing + files.length >= MAX_UPLOAD_FILES) {
      rejected.push({ name, reason: `limit of ${MAX_UPLOAD_FILES} files reached` });
      continue;
    }
    const content = await f.text();
    if (content.includes("\u0000")) {
      rejected.push({ name, reason: "looks like a binary file" });
      continue;
    }
    files.push({ path: name, content });
  }
  return { files, rejected };
}

export function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
