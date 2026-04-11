// IndexedDB helper for persisting FileSystemDirectoryHandle objects
// Used by the File System Access API path in storage-adapter.ts

const DB_NAME = "ipds-storage"
const STORE_NAME = "directory-handles"
const DB_VERSION = 1

export type StorageTarget = "aio" | "hsl" | "mro" | "pdf"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
  })
}

export async function saveHandle(target: StorageTarget, handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(handle, target)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"))
    })
    db.close()
  } catch (err) {
    console.warn("Failed to save directory handle:", err)
  }
}

export async function getHandle(target: StorageTarget): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readonly")
    const request = tx.objectStore(STORE_NAME).get(target)
    const handle = await new Promise<FileSystemDirectoryHandle | null>((resolve, reject) => {
      request.onsuccess = () => resolve((request.result as FileSystemDirectoryHandle | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"))
    })
    db.close()
    return handle
  } catch (err) {
    console.warn("Failed to read directory handle:", err)
    return null
  }
}

export async function clearHandle(target: StorageTarget): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).delete(target)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB delete failed"))
    })
    db.close()
  } catch (err) {
    console.warn("Failed to clear directory handle:", err)
  }
}

// Verifies the browser still has read/write permission on the stored handle
// (permissions can expire if the user closes and reopens the browser)
export async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const h = handle as FileSystemDirectoryHandle & {
      queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>
      requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<PermissionState>
    }
    if (h.queryPermission) {
      const state = await h.queryPermission({ mode: "readwrite" })
      if (state === "granted") return true
    }
    if (h.requestPermission) {
      const state = await h.requestPermission({ mode: "readwrite" })
      return state === "granted"
    }
    return true
  } catch {
    return false
  }
}
