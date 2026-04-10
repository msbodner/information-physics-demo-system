"use client"

import { useCallback, useEffect, useState } from "react"
import { checkBackendHealth } from "@/lib/api-client"

export interface BackendStatus {
  isOnline: boolean
  isChecking: boolean
  lastChecked: Date | null
}

export function useBackendStatus(): BackendStatus {
  const [isOnline, setIsOnline] = useState(false)
  const [isChecking, setIsChecking] = useState(true)
  const [lastChecked, setLastChecked] = useState<Date | null>(null)

  const check = useCallback(async () => {
    setIsChecking(true)
    const online = await checkBackendHealth()
    setIsOnline(online)
    setLastChecked(new Date())
    setIsChecking(false)
  }, [])

  useEffect(() => {
    check()
    const interval = setInterval(check, 30_000)
    return () => clearInterval(interval)
  }, [check])

  return { isOnline, isChecking, lastChecked }
}
