// Storage adapter — picks the best save mechanism at runtime:
//   1. Electron IPC (desktop app) — window.electronAPI injected via preload.js
//   2. File System Access API (Chromium/Edge/Safari)
//   3. Downloads folder fallback (Firefox, unsupported environments)

import { getHandle, saveHandle, clearHandle, verifyPermission, type StorageTarget } from "./storage-handles"

export type { StorageTarget } from "./storage-handles"

export type StorageMechanism = "electron" | "fs-access" | "downloads"

interface ElectronAPI {
  chooseDirectory: (target: StorageTarget) => Promise<string | null>
  saveFile: (target: StorageTarget, filename: string, content: string) => Promise<{ ok: boolean; path?: string; error?: string }>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export function detectMechanism(): StorageMechanism {
  if (typeof window === "undefined") return "downloads"
  if (window.electronAPI && typeof window.electronAPI.chooseDirectory === "function") return "electron"
  if (typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === "function") return "fs-access"
  return "downloads"
}

export function describeMechanism(m: StorageMechanism): string {
  switch (m) {
    case "electron": return "Electron desktop app — files write directly to the chosen path"
    case "fs-access": return "Browser File System Access API — persistent directory access with permission"
    case "downloads": return "Downloads folder fallback — files land in your browser's default Downloads directory"
  }
}

// Chooses a directory and returns a human-readable label to store in the backend
export async function chooseDirectory(target: StorageTarget): Promise<{ label: string | null; mechanism: StorageMechanism }> {
  const mechanism = detectMechanism()

  if (mechanism === "electron" && window.electronAPI) {
    const label = await window.electronAPI.chooseDirectory(target)
    return { label, mechanism }
  }

  if (mechanism === "fs-access") {
    try {
      const picker = (window as Window & { showDirectoryPicker: (opts?: { mode?: "readwrite" }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker
      const handle = await picker({ mode: "readwrite" })
      await saveHandle(target, handle)
      return { label: handle.name, mechanism }
    } catch (err) {
      // User cancelled the picker → not an error
      if ((err as Error).name === "AbortError") return { label: null, mechanism }
      console.error("Directory picker failed:", err)
      return { label: null, mechanism }
    }
  }

  // Downloads fallback: nothing to pick, just report
  return { label: null, mechanism: "downloads" }
}

// Clears a stored directory selection
export async function clearDirectory(target: StorageTarget): Promise<void> {
  const mechanism = detectMechanism()
  if (mechanism === "fs-access") {
    await clearHandle(target)
  }
  // For Electron, the label lives only in the backend so we just need the UI to PUT empty
}

// Writes a file to the chosen directory for this target
export async function saveFile(
  target: StorageTarget,
  filename: string,
  content: string | Blob,
  mimeType: string = "text/plain"
): Promise<{ ok: boolean; mechanism: StorageMechanism; message?: string }> {
  const mechanism = detectMechanism()

  // Normalize content to string for Electron and to Blob for other paths
  const asText = async (): Promise<string> => {
    if (typeof content === "string") return content
    return await content.text()
  }
  const asBlob = (): Blob => {
    if (content instanceof Blob) return content
    return new Blob([content], { type: mimeType })
  }

  // 1. Electron IPC path
  if (mechanism === "electron" && window.electronAPI) {
    try {
      const text = await asText()
      const result = await window.electronAPI.saveFile(target, filename, text)
      if (result.ok) return { ok: true, mechanism, message: result.path }
      // If Electron save failed (e.g., no directory chosen), fall through to downloads
      return await fallbackDownload(asBlob(), filename, mechanism, `Electron save failed: ${result.error ?? "unknown"}`)
    } catch (err) {
      return await fallbackDownload(asBlob(), filename, mechanism, `Electron error: ${(err as Error).message}`)
    }
  }

  // 2. File System Access API path
  if (mechanism === "fs-access") {
    try {
      const handle = await getHandle(target)
      if (!handle) {
        return await fallbackDownload(asBlob(), filename, mechanism, "No directory chosen for this target")
      }
      const ok = await verifyPermission(handle)
      if (!ok) {
        return await fallbackDownload(asBlob(), filename, mechanism, "Permission denied for directory")
      }
      const fileHandle = await handle.getFileHandle(filename, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(asBlob())
      await writable.close()
      return { ok: true, mechanism, message: `Saved to ${handle.name}/${filename}` }
    } catch (err) {
      return await fallbackDownload(asBlob(), filename, mechanism, `FS Access error: ${(err as Error).message}`)
    }
  }

  // 3. Downloads fallback
  return await fallbackDownload(asBlob(), filename, mechanism)
}

async function fallbackDownload(blob: Blob, filename: string, mechanism: StorageMechanism, reason?: string): Promise<{ ok: boolean; mechanism: StorageMechanism; message?: string }> {
  try {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    return {
      ok: true,
      mechanism: "downloads",
      message: reason ? `${reason} — saved to Downloads instead` : `Saved to Downloads: ${filename}`,
    }
  } catch (err) {
    return { ok: false, mechanism, message: `Download failed: ${(err as Error).message}` }
  }
  void mechanism
}
