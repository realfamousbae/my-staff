import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import type { AuthSession } from "./types";
import type {
  FilePort,
  HttpPort,
  RuntimePort,
  SecureSessionPort,
} from "./ports";

const SESSION_KEY = "my-staff.auth.v1";
export class ExpoRuntime implements RuntimePort {
  now() {
    return new Date().toISOString();
  }
  id() {
    return Crypto.randomUUID();
  }
}
export class ExpoFiles implements FilePort {
  private readonly originals = `${FileSystem.documentDirectory}originals/`;
  private async ensure() {
    await FileSystem.makeDirectoryAsync(this.originals, {
      intermediates: true,
    });
  }
  originalPath(stableName: string) {
    return `${this.originals}${stableName}`;
  }
  async moveToOriginal(sourceUri: string, stableName: string) {
    await this.ensure();
    const path = `${this.originals}${stableName}`;
    const existing = await FileSystem.getInfoAsync(path);
    if (!existing.exists)
      await FileSystem.moveAsync({ from: sourceUri, to: path });
    const info = await FileSystem.getInfoAsync(path);
    const byteSize = (info as { size?: number }).size ?? 0;
    if (!info.exists || !byteSize)
      throw new Error("Original photo was not persisted");
    const base64 = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Digest the original bytes, never the textual base64 representation.
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++)
      bytes[index] = binary.charCodeAt(index);
    const digest = new Uint8Array(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes),
    );
    const sha256 = Array.from(digest, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const mimeType: "image/png" | "image/jpeg" | "image/webp" | null =
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
        ? "image/png"
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
          ? "image/jpeg"
          : bytes[0] === 0x52 &&
              bytes[1] === 0x49 &&
              bytes[2] === 0x46 &&
              bytes[3] === 0x46 &&
              bytes[8] === 0x57 &&
              bytes[9] === 0x45 &&
              bytes[10] === 0x42 &&
              bytes[11] === 0x50
            ? "image/webp"
            : null;
    if (!mimeType) throw new Error("Unsupported original image type");
    return { path, byteSize, sha256, mimeType };
  }
  async info(path: string) {
    const x = await FileSystem.getInfoAsync(path);
    return {
      exists: x.exists,
      size: x.exists ? ((x as { size?: number }).size ?? 0) : 0,
    };
  }
  async read(path: string) {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Unable to read original");
    return response.blob();
  }
  async readBytes(path: string, maximum: number) {
    const info = await this.info(path);
    if (!info.exists) throw new Error("Файл архива не найден");
    if (info.size > maximum) throw new Error("Архив превышает 200 МБ");
    const encoded = await FileSystem.readAsStringAsync(path, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const binary = atob(encoded);
    if (binary.length > maximum) throw new Error("Архив превышает 200 МБ");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  async remove(path: string) {
    await FileSystem.deleteAsync(path, { idempotent: true });
  }
  async downloadAuthenticated(url: string, token: string, stableName: string) {
    await this.ensure();
    const path = `${this.originals}${stableName}`;
    const result = await FileSystem.downloadAsync(url, path + ".part", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (result.status !== 200) throw new Error(`DOWNLOAD_${result.status}`);
    const info = await this.info(result.uri);
    if (!info.exists || !info.size)
      throw new Error("Downloaded original is empty");
    return (await this.moveToOriginal(result.uri, stableName)).path;
  }
  async writeImported(stableName: string, bytes: Uint8Array) {
    await this.ensure();
    const path = `${this.originals}${stableName}`;
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000)
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await FileSystem.writeAsStringAsync(path, btoa(binary), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return path;
  }
}
export class ExpoSecureSession implements SecureSessionPort {
  async get() {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return raw ? (JSON.parse(raw) as AuthSession) : null;
  }
  async set(value: AuthSession) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(value));
  }
  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  }
}
export class ApiClient implements HttpPort {
  constructor(
    private readonly baseUrl: () => string,
    private readonly token: () => string | null,
  ) {}
  private url(path: string) {
    return `${this.baseUrl().replace(/\/$/, "")}${path}`;
  }
  async request<T>(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = this.token();
    const response = await fetch(this.url(path), {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const content = await response.text();
    let parsed: any = undefined;
    try {
      parsed = content ? JSON.parse(content) : undefined;
    } catch {
      /* handled below */
    }
    if (!response.ok) {
      const error = new Error(
        parsed?.code ?? parsed?.message ?? `HTTP_${response.status}`,
      );
      (error as Error & { status?: number; current?: unknown }).status =
        response.status;
      (error as any).current = parsed?.current;
      throw error;
    }
    return parsed as T;
  }
  async upload(url: string, headers: Record<string, string>, body: Blob) {
    const relative = url.startsWith("/");
    const token = relative ? this.token() : null;
    const r = await fetch(relative ? this.url(url) : url, {
      method: "PUT",
      headers: {
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
    if (!r.ok) throw new Error(`UPLOAD_${r.status}`);
  }
  mediaUrl(mediaId: string) {
    return this.url(`/v1/media/${encodeURIComponent(mediaId)}/content`);
  }
  async download(path: string): Promise<Blob> {
    const token = this.token();
    const response = await fetch(this.url(path), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(`DOWNLOAD_${response.status}`);
    return response.blob();
  }
  async uploadBinary(
    path: string,
    body: Blob,
  ): Promise<{ imported: number; skipped: number }> {
    const token = this.token();
    const response = await fetch(this.url(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    });
    if (!response.ok) throw new Error(`IMPORT_${response.status}`);
    return response.json();
  }
}
