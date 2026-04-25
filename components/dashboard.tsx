"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Database, Layers, Brain, Atom, Upload, FileSpreadsheet,
  MessageSquare, ArrowRight, Activity, Clock, CheckCircle2,
  XCircle, Loader2, RefreshCw,
} from "lucide-react"
import {
  listAioData, listHslData, listMroObjects,
  listInformationElements, listFieldMaps, getApiKeySetting,
  type AioDataRecord, type HslDataRecord, type MroObject,
  type InformationElement, type FieldMapKey,
} from "@/lib/api-client"

interface Stats {
  aios: number
  hsls: number
  mros: number
  fields: number
  fieldMaps: number
}

interface ActivityEvent {
  kind: "aio" | "hsl" | "mro" | "field-map"
  label: string
  timestamp: string
  detail?: string
}

interface SystemHealth {
  backend: boolean
  apiKey: boolean | null
}

interface DashboardProps {
  backendIsOnline: boolean
  onNavigate: (view: "converter" | "pdf-import" | "chataio" | "rnd" | "processor") => void
}

function timeAgo(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.max(0, now.getTime() - d.getTime())
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

export function Dashboard({ backendIsOnline, onNavigate }: DashboardProps) {
  const [stats, setStats] = useState<Stats>({ aios: 0, hsls: 0, mros: 0, fields: 0, fieldMaps: 0 })
  const [loading, setLoading] = useState(true)
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [health, setHealth] = useState<SystemHealth>({ backend: false, apiKey: null })
  const [lastSync, setLastSync] = useState<Date | null>(null)

  const load = useCallback(async () => {
    if (!backendIsOnline) {
      setLoading(false)
      setHealth({ backend: false, apiKey: null })
      return
    }
    setLoading(true)
    try {
      const [aios, hsls, mros, fields, fieldMaps, apiKey] = await Promise.all([
        listAioData(),
        listHslData(),
        listMroObjects().catch(() => [] as MroObject[]),
        listInformationElements().catch(() => [] as InformationElement[]),
        listFieldMaps().catch(() => [] as FieldMapKey[]),
        getApiKeySetting().catch(() => null),
      ])

      setStats({
        aios: aios.length,
        hsls: hsls.length,
        mros: mros.length,
        fields: fields.length,
        fieldMaps: fieldMaps.length,
      })

      // Build activity feed from most-recent updated_at across tables
      const events: ActivityEvent[] = []
      aios.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4).forEach((a: AioDataRecord) => {
        events.push({ kind: "aio", label: a.aio_name, timestamp: a.updated_at })
      })
      hsls.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3).forEach((h: HslDataRecord) => {
        events.push({ kind: "hsl", label: h.hsl_name, timestamp: h.updated_at })
      })
      mros.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 3).forEach((m: MroObject) => {
        events.push({ kind: "mro", label: m.mro_key || m.query_text.slice(0, 60), timestamp: m.updated_at })
      })
      fieldMaps.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 2).forEach((f: FieldMapKey) => {
        events.push({ kind: "field-map", label: `Fuzzy key "${f.fuzzy_key}" (${f.members.length} fields)`, timestamp: f.updated_at })
      })
      events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      setActivity(events.slice(0, 10))

      setHealth({
        backend: true,
        apiKey: apiKey?.configured ?? false,
      })
      setLastSync(new Date())
    } catch {
      setHealth({ backend: false, apiKey: null })
    }
    setLoading(false)
  }, [backendIsOnline])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {lastSync ? `Last updated ${timeAgo(lastSync.toISOString())}` : "Loading..."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="AIOs"
          value={stats.aios}
          icon={Database}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
          loading={loading}
          subtitle="Information objects"
        />
        <StatCard
          label="HSLs"
          value={stats.hsls}
          icon={Layers}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          loading={loading}
          subtitle="Semantic layers"
        />
        <StatCard
          label="MROs"
          value={stats.mros}
          icon={Brain}
          iconColor="text-purple-600"
          iconBg="bg-purple-50"
          loading={loading}
          subtitle="Memory results"
        />
        <StatCard
          label="Fields"
          value={stats.fields}
          icon={Atom}
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          loading={loading}
          subtitle={`${stats.fieldMaps} fuzzy keys`}
        />
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickActionCard
            title="Import CSV"
            description="Convert tabular data to AIO format"
            icon={Upload}
            color="blue"
            onClick={() => onNavigate("converter")}
          />
          <QuickActionCard
            title="Import PDFs"
            description="Extract data via Claude AI"
            icon={FileSpreadsheet}
            color="emerald"
            onClick={() => onNavigate("pdf-import")}
            disabled={!backendIsOnline}
          />
          <QuickActionCard
            title="ChatAIO"
            description="AI-powered search over your data"
            icon={MessageSquare}
            color="purple"
            onClick={() => onNavigate("chataio")}
            disabled={!backendIsOnline}
          />
          <QuickActionCard
            title="R & D"
            description="Compound HSL + Field Maps"
            icon={Atom}
            color="amber"
            onClick={() => onNavigate("rnd")}
            disabled={!backendIsOnline}
          />
        </div>
      </div>

      {/* Recent activity + System health */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Activity feed */}
        <Card className="lg:col-span-2">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Recent Activity</h2>
            </div>
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading...
              </p>
            ) : activity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No activity yet. Upload a CSV to get started.
              </p>
            ) : (
              <ul className="space-y-3">
                {activity.map((e, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <ActivityIcon kind={e.kind} />
                    <div className="flex-1 min-w-0">
                      <div className="text-foreground truncate">{e.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {kindLabel(e.kind)} · {timeAgo(e.timestamp)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* System health */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">System Health</h2>
            </div>
            <ul className="space-y-3 text-sm">
              <HealthRow label="Backend" ok={health.backend} />
              <HealthRow label="Database" ok={health.backend} />
              <HealthRow label="API Key" ok={health.apiKey ?? false} warn={!backendIsOnline} />
              <HealthRow label="Anthropic" ok={health.apiKey === true} warn={!backendIsOnline} />
            </ul>
            <div className="mt-5 pt-4 border-t border-border text-xs text-muted-foreground space-y-1">
              <div>Tenant: tenantA</div>
              <div>Version: V4.1</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function StatCard({
  label, value, icon: Icon, iconColor, iconBg, loading, subtitle,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  iconColor: string
  iconBg: string
  loading: boolean
  subtitle: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-3xl font-bold text-foreground mt-1.5">
              {loading ? <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /> : value.toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function QuickActionCard({
  title, description, icon: Icon, color, onClick, disabled,
}: {
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  color: "blue" | "emerald" | "purple" | "amber"
  onClick: () => void
  disabled?: boolean
}) {
  const colors = {
    blue: "hover:border-blue-300 hover:bg-blue-50/50",
    emerald: "hover:border-emerald-300 hover:bg-emerald-50/50",
    purple: "hover:border-purple-300 hover:bg-purple-50/50",
    amber: "hover:border-amber-300 hover:bg-amber-50/50",
  }
  const iconColors = {
    blue: "text-blue-600 bg-blue-50",
    emerald: "text-emerald-600 bg-emerald-50",
    purple: "text-purple-600 bg-purple-50",
    amber: "text-amber-600 bg-amber-50",
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-left p-5 rounded-lg border border-border bg-card transition-all
        disabled:opacity-50 disabled:cursor-not-allowed
        ${!disabled ? colors[color] : ""}
        group`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg ${iconColors[color]} flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
      </div>
      <h3 className="font-semibold text-sm text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground mt-1">{description}</p>
    </button>
  )
}

function ActivityIcon({ kind }: { kind: ActivityEvent["kind"] }) {
  const map = {
    "aio": { Icon: Database, color: "text-blue-600 bg-blue-50" },
    "hsl": { Icon: Layers, color: "text-emerald-600 bg-emerald-50" },
    "mro": { Icon: Brain, color: "text-purple-600 bg-purple-50" },
    "field-map": { Icon: Atom, color: "text-amber-600 bg-amber-50" },
  }
  const { Icon, color } = map[kind]
  return (
    <div className={`w-7 h-7 rounded ${color} flex items-center justify-center shrink-0`}>
      <Icon className="w-3.5 h-3.5" />
    </div>
  )
}

function kindLabel(kind: ActivityEvent["kind"]): string {
  return { "aio": "AIO created", "hsl": "HSL built", "mro": "MRO saved", "field-map": "Field map updated" }[kind]
}

function HealthRow({ label, ok, warn }: { label: string; ok: boolean; warn?: boolean }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      {warn ? (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          Unknown
        </span>
      ) : ok ? (
        <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Healthy
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
          <XCircle className="w-3.5 h-3.5" />
          Offline
        </span>
      )}
    </li>
  )
}
