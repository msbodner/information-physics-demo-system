"use client"

import { useBackendStatus } from "@/hooks/use-backend-status"
import { Badge } from "@/components/ui/badge"

export function BackendStatusBadge() {
  const { isOnline, isChecking } = useBackendStatus()

  if (isChecking) {
    return (
      <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
        <span className="w-2 h-2 rounded-full bg-gray-400 animate-pulse" />
        Checking backend…
      </Badge>
    )
  }

  if (isOnline) {
    return (
      <Badge variant="secondary" className="gap-1.5 text-xs font-normal bg-green-100 text-green-800 border-green-200">
        <span className="w-2 h-2 rounded-full bg-green-500" />
        Backend Connected
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="gap-1.5 text-xs font-normal bg-yellow-100 text-yellow-800 border-yellow-200">
      <span className="w-2 h-2 rounded-full bg-yellow-500" />
      Backend Offline (local mode)
    </Badge>
  )
}
