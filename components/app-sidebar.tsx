"use client"

import { useState } from "react"
import {
  Home, Upload, FileSpreadsheet, Layers, MessageSquare,
  Atom, Network, BookOpen, Cpu, FileText, Brain, Settings,
  ChevronLeft, Menu, Circle,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type ViewKey =
  | "home"
  | "converter"
  | "pdf-import"
  | "processor"
  | "chataio"
  | "rnd"
  | "guide"
  | "workflow"
  | "reference"
  | "paper"
  | "mro-paper"
  | "paper-iii"
  | "bulk-hsl-technote"
  | "sysadmin"

interface NavItem {
  key: ViewKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "",
    items: [{ key: "home", label: "Dashboard", icon: Home }],
  },
  {
    label: "Data",
    items: [
      { key: "converter", label: "Import CSV", icon: Upload },
      { key: "pdf-import", label: "Import PDFs", icon: FileSpreadsheet },
      { key: "processor", label: "HSL Builder", icon: Layers },
      { key: "chataio", label: "ChatAIO", icon: MessageSquare },
    ],
  },
  {
    label: "Discovery",
    items: [
      { key: "rnd", label: "R & D", icon: Atom },
      { key: "guide", label: "User Guide", icon: BookOpen },
    ],
  },
  {
    label: "Admin",
    items: [{ key: "sysadmin", label: "System Admin", icon: Settings }],
  },
]

interface AppSidebarProps {
  currentView: ViewKey
  onNavigate: (view: ViewKey) => void
  backendIsOnline: boolean
  version?: string
  username?: string | null
}

export function AppSidebar({ currentView, onNavigate, backendIsOnline, version = "V4.2", username }: AppSidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebarContent = (
    <>
      {/* Header / Logo */}
      <div className="flex items-center justify-between px-4 py-5 border-b border-white/10">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <Network className="w-4 h-4 text-white" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-white">Information Physics</span>
              <span className="text-[10px] text-white/60 uppercase tracking-wide">Demo System</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center mx-auto">
            <Network className="w-4 h-4 text-white" />
          </div>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "text-white/60 hover:text-white transition-colors hidden lg:block",
            collapsed && "absolute top-5 right-2"
          )}
          title={collapsed ? "Expand" : "Collapse"}
        >
          <ChevronLeft className={cn("w-4 h-4 transition-transform", collapsed && "rotate-180")} />
        </button>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-5">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className="px-2">
            {group.label && !collapsed && (
              <div className="px-3 mb-1.5 text-[10px] font-semibold text-white/40 uppercase tracking-wider">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = currentView === item.key
                return (
                  <button
                    key={item.key}
                    onClick={() => {
                      onNavigate(item.key)
                      setMobileOpen(false)
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                      "text-white/70 hover:text-white hover:bg-white/10",
                      isActive && "bg-white/15 text-white font-medium",
                      collapsed && "justify-center px-2"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-3 py-3 space-y-2">
        {!collapsed && (
          <>
            <div className="flex items-center gap-2 px-2 text-xs">
              <div className={cn(
                "w-1.5 h-1.5 rounded-full",
                backendIsOnline ? "bg-emerald-400" : "bg-amber-400"
              )} />
              <span className="text-white/70">
                {backendIsOnline ? "Backend Online" : "Offline (local)"}
              </span>
            </div>
            {username && (
              <div className="px-2 text-xs text-white/60 truncate">
                {username}
              </div>
            )}
            <div className="px-2 text-[10px] text-white/40">{version}</div>
          </>
        )}
        {collapsed && (
          <div className="flex justify-center">
            <Circle className={cn(
              "w-2 h-2 fill-current",
              backendIsOnline ? "text-emerald-400" : "text-amber-400"
            )} />
          </div>
        )}
      </div>
    </>
  )

  return (
    <>
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-40 w-10 h-10 rounded-md bg-[#0F3460] text-white flex items-center justify-center shadow-lg"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 h-screen bg-[#0F3460] text-white flex flex-col z-40",
          "transition-all duration-200 ease-out",
          collapsed ? "w-16" : "w-60",
          "lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  )
}
