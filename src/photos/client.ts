import type { Upload } from "tus-js-client";
export interface Fourball {
  id: string;
  team_name: string;
}
export interface Photo {
  id: string;
  filename: string;
  createdAt: string;
  status: string;
  source: string;
  batchId: string;
  fourballIds: string[];
  previewUrl: string;
  downloadUrl?: string;
}
export interface PhotoPage {
  photos: Photo[];
  next: string | null;
}
export type PhotoApi = <T>(query?: string, body?: unknown) => Promise<T>;
export function capabilityApi(token: string): PhotoApi {
  return async <T>(query = "", body?: unknown): Promise<T> => {
    const response = await fetch(`/api/v1/photos${query}`, {
      method: body ? "POST" : "GET",
      cache: "no-store",
      headers: {
        "X-Photo-Token": token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json()) as T & { message?: string };
    if (!response.ok) throw new Error(data.message || "Photo request failed.");
    return data;
  };
}
export async function transferPhoto(
  file: File,
  id: string,
  api: PhotoApi,
  onProgress: (value: number) => void,
  onUpload: (upload: Upload) => void,
) {
  const credentials = await api<{
    complete: boolean;
    token: string;
    path: string;
    endpoint: string;
    publishableKey: string;
  }>("", { action: "credentials", id });
  if (credentials.complete) return;
  const { Upload } = await import("tus-js-client");
  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: credentials.endpoint,
      chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        "x-signature": credentials.token,
        apikey: credentials.publishableKey,
      },
      metadata: {
        bucketName: "m2m-photo-staging",
        objectName: credentials.path,
        contentType: file.type,
        cacheControl: "0",
      },
      fingerprint: async () => `m2m-photo:${id}`,
      removeFingerprintOnSuccess: true,
      onProgress: (done, total) => onProgress(Math.round((done / total) * 100)),
      onSuccess: () => resolve(),
      onError: reject,
    });
    onUpload(upload);
    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(reject);
  });
}
export async function savePhotoFile(
  api: PhotoApi,
  query: string,
  share = false,
) {
  const { photo } = await api<{ photo: Photo }>(query);
  const response = await fetch(photo.downloadUrl!);
  if (!response.ok)
    throw new Error("The photo download expired. Please retry.");
  const file = new File([await response.blob()], `golf-day-${photo.id}.jpg`, {
    type: "image/jpeg",
  });
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Golf day photos" });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
