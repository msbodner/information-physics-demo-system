"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import {
  ArrowLeft, Plus, Pencil, Trash2, Eye, EyeOff, Save,
  Users, Key, Loader2, ShieldCheck, User, Lock, FileSpreadsheet, FileText,
  Shield, Database, LayoutList, Bookmark, Atom, RefreshCw, Network, BarChart2, LayoutGrid,
  BookOpen, Cpu, Brain, Library, Printer, AlertTriangle,
  RotateCcw, Archive, ShieldAlert, CheckCircle2, FileDown, Layers,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  listUsers, createUser, updateUser, deleteUser,
  listRoles, createRole, deleteRole,
  listAioData, createAioData, updateAioData, deleteAioData,
  listHslData, createHslData, updateHslData, deleteHslData,
  listSavedPrompts, createSavedPrompt, updateSavedPrompt, deleteSavedPrompt,
  listInformationElements, createInformationElement, updateInformationElement, deleteInformationElement, rebuildInformationElements,
  getApiKeySetting, updateApiKeySetting, loginUser, listIOs,
  listChatStats, deleteChatStat, getMroForStat, type MroForStat,
  listMroObjects, getMroObject, updateMroObject, deleteMroObject,
  listDemoBackups, createDemoBackup, deleteDemoBackup, resetDemoData, restoreDemoBackup,
  type User as SystemUser, type Role, type AioDataRecord, type HslDataRecord,
  type LoginResult, type IORecord, type SavedPrompt, type InformationElement,
  type ChatStatRecord, type MroObject, type DemoBackupSummary,
} from "@/lib/api-client"

// ── Helpers ────────────────────────────────────────────────────────

const isAdmin = (role: string) =>
  role === "system_admin" || role === "System Admin"

const emptyElements = (n: number): (string | null)[] => Array(n).fill(null)

// ── Login Gate Screen ──────────────────────────────────────────────

interface LoginGateScreenProps {
  onLogin: (user: LoginResult) => void
  onBack: () => void
}

function LoginGateScreen({ onLogin, onBack }: LoginGateScreenProps) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!email.trim() || !password.trim()) {
      setError("Email or username and password are required.")
      return
    }
    setIsLoading(true)
    setError(null)
    const { user, error: loginError } = await loginUser(email.trim(), password)
    setIsLoading(false)
    if (loginError) { setError(loginError); return }
    if (!user) { setError("Login failed. Please try again."); return }
    if (!isAdmin(user.role)) {
      setError(`Access denied. Your role (${user.role}) does not have System Admin privileges.`)
      return
    }
    onLogin(user)
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <header className="border-b border-border bg-card shrink-0">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />Back
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-bold text-foreground">System Management</h1>
          </div>
        </div>
      </header>
      <main className="flex-1 flex items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center pb-2">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <CardTitle className="text-xl">Admin Sign In</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">System Admin access required</p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="lg-email">Email or Username</Label>
                <Input id="lg-email" type="text" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com or username" autoComplete="username" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="lg-password">Password</Label>
                <div className="relative">
                  <Input id="lg-password" type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter password" className="pr-10" autoComplete="current-password" />
                  <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
                Sign In
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}

// ── User Management Pane ───────────────────────────────────────────

function UserManagementPane() {
  const [users, setUsers] = useState<SystemUser[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialog, setDialog] = useState<{ open: boolean; mode: "add" | "edit"; user?: SystemUser }>({ open: false, mode: "add" })
  const [deleteConfirm, setDeleteConfirm] = useState<SystemUser | null>(null)

  const [formUsername, setFormUsername] = useState("")
  const [formEmail, setFormEmail] = useState("")
  const [formPassword, setFormPassword] = useState("")
  const [formRole, setFormRole] = useState("General User")
  const [formActive, setFormActive] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showFormPassword, setShowFormPassword] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    const [userData, roleData] = await Promise.all([listUsers(), listRoles()])
    setUsers(userData)
    setRoles(roleData.length > 0 ? roleData : [{ role_id: "1", role_name: "System Admin", created_at: "" }, { role_id: "2", role_name: "General User", created_at: "" }])
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    setFormUsername(""); setFormEmail(""); setFormPassword(""); setFormRole("General User"); setFormActive(true)
    setDialog({ open: true, mode: "add" })
  }

  const openEdit = (u: SystemUser) => {
    setFormUsername(u.username); setFormEmail(u.email); setFormPassword(""); setFormRole(u.role); setFormActive(u.is_active)
    setDialog({ open: true, mode: "edit", user: u })
  }

  const handleSave = async () => {
    if (!formUsername.trim() || !formEmail.trim()) { toast.error("Username and email are required."); return }
    if (dialog.mode === "add" && !formPassword.trim()) { toast.error("Password is required for new users."); return }
    setIsSaving(true)
    try {
      if (dialog.mode === "add") {
        const created = await createUser({ username: formUsername, email: formEmail, password: formPassword, role: formRole })
        if (!created) { toast.error("Failed to create user. Email may already exist."); return }
        toast.success(`User "${formUsername}" created.`)
      } else if (dialog.user) {
        const updates: Record<string, unknown> = { username: formUsername, email: formEmail, role: formRole, is_active: formActive }
        if (formPassword.trim()) updates.password = formPassword
        const updated = await updateUser(dialog.user.user_id, updates)
        if (!updated) { toast.error("Failed to update user."); return }
        toast.success(`User "${formUsername}" updated.`)
      }
      setDialog({ open: false, mode: "add" })
      await load()
    } finally { setIsSaving(false) }
  }

  const handleDelete = async (u: SystemUser) => {
    const ok = await deleteUser(u.user_id)
    if (ok) { toast.success(`User "${u.username}" deleted.`); await load() }
    else toast.error("Failed to delete user.")
    setDeleteConfirm(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Manage system users and their access roles.</p>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add User</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No users found.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Username</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Login</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.user_id} className="border-t border-border hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      {isAdmin(u.role) ? <ShieldCheck className="w-4 h-4 text-primary shrink-0" /> : <User className="w-4 h-4 text-muted-foreground shrink-0" />}
                      {u.username}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={isAdmin(u.role) ? "default" : "secondary"}>
                      {isAdmin(u.role) ? "System Admin" : "General User"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={u.is_active ? "outline" : "destructive"}>{u.is_active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {u.last_login ? new Date(u.last_login).toLocaleString() : "Never"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(u)} className="gap-1 h-7 px-2"><Pencil className="w-3 h-3" />Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(u)} className="gap-1 h-7 px-2 text-destructive hover:text-destructive"><Trash2 className="w-3 h-3" />Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{dialog.mode === "add" ? "Add User" : "Edit User"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Username</Label>
              <Input value={formUsername} onChange={(e) => setFormUsername(e.target.value)} placeholder="Full name" />
            </div>
            <div className="space-y-1">
              <Label>Email Address</Label>
              <Input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div className="space-y-1">
              <Label>{dialog.mode === "add" ? "Password" : "New Password (leave blank to keep current)"}</Label>
              <div className="relative">
                <Input type={showFormPassword ? "text" : "password"} value={formPassword} onChange={(e) => setFormPassword(e.target.value)} placeholder={dialog.mode === "edit" ? "Leave blank to keep current" : "Enter password"} className="pr-10" />
                <button type="button" onClick={() => setShowFormPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showFormPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <Select value={formRole} onValueChange={setFormRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.role_id} value={r.role_name}>{r.role_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {dialog.mode === "edit" && (
              <div className="flex items-center gap-3">
                <Label>Active</Label>
                <button type="button" onClick={() => setFormActive((v) => !v)} className={`relative w-10 h-5 rounded-full transition-colors ${formActive ? "bg-primary" : "bg-muted-foreground/30"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${formActive ? "translate-x-5" : ""}`} />
                </button>
                <span className="text-sm text-muted-foreground">{formActive ? "Active" : "Inactive"}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog((d) => ({ ...d, open: false }))}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {dialog.mode === "add" ? "Create User" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete User</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Are you sure you want to delete <strong>{deleteConfirm?.username}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2"><Trash2 className="w-4 h-4" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Roles Pane ─────────────────────────────────────────────────────

function RolesPane() {
  const [roles, setRoles] = useState<Role[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newRoleName, setNewRoleName] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Role | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setRoles(await listRoles())
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!newRoleName.trim()) { toast.error("Role name is required."); return }
    setIsSaving(true)
    const created = await createRole(newRoleName.trim())
    setIsSaving(false)
    if (!created) { toast.error("Failed to create role. It may already exist."); return }
    toast.success(`Role "${newRoleName}" created.`)
    setNewRoleName("")
    await load()
  }

  const handleDelete = async (r: Role) => {
    const ok = await deleteRole(r.role_id)
    if (ok) { toast.success(`Role "${r.role_name}" deleted.`); await load() }
    else toast.error("Failed to delete role.")
    setDeleteConfirm(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Manage user roles available in the system.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <Input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} placeholder="New role name..." className="max-w-xs" onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <Button onClick={handleAdd} disabled={isSaving} className="gap-2">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Add Role
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : roles.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No roles found.</p>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.role_id} className="border-t border-border hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium flex items-center gap-2">
                    <Shield className="w-4 h-4 text-muted-foreground" />{r.role_name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(r)} className="gap-1 h-7 px-2 text-destructive hover:text-destructive">
                      <Trash2 className="w-3 h-3" />Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Role</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Delete <strong>{deleteConfirm?.role_name}</strong>? Users assigned this role will need to be updated.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2"><Trash2 className="w-4 h-4" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── AIO Edit Dialog ────────────────────────────────────────────────
//
// Edit mode shows ONLY the non-empty element rows (one per line, full width)
// with a click-to-edit unlock pattern. The first time the user tries to
// edit an element, a confirm dialog warns about provenance/preservation;
// subsequent edits in the same session don't re-prompt.
//
// Add mode keeps the original 50-field form so a new record can be filled
// from scratch.

const AIO_COUNT = 50

interface AioEditDialogProps {
  open: boolean
  mode: "add" | "edit"
  formName: string
  formElements: (string | null)[]
  filledCount: number
  isSaving: boolean
  onClose: () => void
  onChangeName: (v: string) => void
  onChangeElement: (i: number, v: string) => void
  onSave: () => void
}

function AioEditDialog({
  open, mode, formName, formElements, filledCount, isSaving,
  onClose, onChangeName, onChangeElement, onSave,
}: AioEditDialogProps) {
  // Indices of non-empty elements when the dialog opened — we keep this
  // stable so a row doesn't disappear from view as soon as the user
  // starts editing it (and types into an empty intermediate state).
  const [visibleIdx, setVisibleIdx] = useState<number[]>([])
  // Set of element indices the user has unlocked for editing.
  const [unlocked, setUnlocked] = useState<Set<number>>(new Set())
  // Pending unlock: which element to enable once the warning is acknowledged.
  const [pendingUnlock, setPendingUnlock] = useState<number | null>(null)

  // Recompute visible indices each time the dialog opens (or switches modes).
  useEffect(() => {
    if (!open) return
    if (mode === "edit") {
      const idx: number[] = []
      for (let i = 0; i < formElements.length; i++) {
        const v = formElements[i]
        if (v !== null && v !== undefined && String(v).trim() !== "") idx.push(i)
      }
      setVisibleIdx(idx)
      setUnlocked(new Set())
    } else {
      setVisibleIdx([])
      setUnlocked(new Set())
    }
    setPendingUnlock(null)
  }, [open, mode]) // intentionally not depending on formElements — view stable while editing

  const confirmUnlock = useCallback(() => {
    if (pendingUnlock !== null) {
      setUnlocked((prev) => { const next = new Set(prev); next.add(pendingUnlock); return next })
    }
    setPendingUnlock(null)
  }, [pendingUnlock])

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{mode === "add" ? "Add AIO Record" : "Edit AIO Record"}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 space-y-4 pr-1">
            <div className="space-y-1">
              <Label>AIO Name</Label>
              <Input
                value={formName}
                onChange={(e) => onChangeName(e.target.value)}
                placeholder="Record name..."
              />
            </div>

            {mode === "edit" ? (
              <div>
                <p className="text-xs text-muted-foreground mb-3">
                  {visibleIdx.length} non-empty element{visibleIdx.length === 1 ? "" : "s"}
                  {" "}({filledCount} of {AIO_COUNT} filled total). Click any row to edit.
                </p>
                {visibleIdx.length === 0 ? (
                  <div className="text-sm text-muted-foreground italic py-6 text-center">
                    This record has no filled elements.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {visibleIdx.map((i) => {
                      const isUnlocked = unlocked.has(i)
                      const value = formElements[i] ?? ""
                      return (
                        <div
                          key={i}
                          className={`group flex items-start gap-3 rounded-md border px-3 py-2 transition-colors ${
                            isUnlocked
                              ? "border-amber-400 bg-amber-50/40 dark:bg-amber-950/20"
                              : "border-border bg-muted/20 hover:bg-muted/40 cursor-pointer"
                          }`}
                          onClick={() => { if (!isUnlocked) setPendingUnlock(i) }}
                        >
                          <span className="text-[10px] font-mono text-muted-foreground shrink-0 w-12 pt-1.5">
                            #{i + 1}
                          </span>
                          {isUnlocked ? (
                            <Input
                              autoFocus
                              value={value}
                              onChange={(e) => onChangeElement(i, e.target.value)}
                              className="h-8 text-sm flex-1 font-mono"
                            />
                          ) : (
                            <span className="text-sm flex-1 break-all font-mono leading-6">
                              {value}
                            </span>
                          )}
                          {!isUnlocked && (
                            <Pencil className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 mt-1 transition-opacity" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              // Add mode — original 50-field grid
              <div>
                <p className="text-xs text-muted-foreground mb-3">{filledCount} of {AIO_COUNT} elements filled</p>
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: AIO_COUNT }, (_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground w-24 shrink-0">Element {i + 1}</span>
                      <Input
                        value={formElements[i] ?? ""}
                        onChange={(e) => onChangeElement(i, e.target.value)}
                        placeholder={`Element ${i + 1}`}
                        className="h-7 text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="pt-4 border-t border-border">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={onSave} disabled={isSaving} className="gap-2">
              {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              {mode === "add" ? "Create" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Provenance warning — shown the first time the user tries to edit
          an element in this session. Acknowledging unlocks just that row. */}
      <Dialog open={pendingUnlock !== null} onOpenChange={(o) => { if (!o) setPendingUnlock(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="w-5 h-5" />
              Edit element?
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-foreground py-2 leading-relaxed">
            Use this only to fix errors. If you make changes here you are violating
            preservation of truth and provenance.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingUnlock(null)}>Cancel</Button>
            <Button
              onClick={confirmUnlock}
              className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
            >
              <Pencil className="w-4 h-4" />I understand — edit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── AIO Data Pane ──────────────────────────────────────────────────

function AioDataPane() {
  const [records, setRecords] = useState<AioDataRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialog, setDialog] = useState<{ open: boolean; mode: "add" | "edit"; record?: AioDataRecord }>({ open: false, mode: "add" })
  const [deleteConfirm, setDeleteConfirm] = useState<AioDataRecord | null>(null)
  const [formName, setFormName] = useState("")
  const [formElements, setFormElements] = useState<(string | null)[]>(emptyElements(AIO_COUNT))
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setRecords(await listAioData())
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    setFormName("")
    setFormElements(emptyElements(AIO_COUNT))
    setDialog({ open: true, mode: "add" })
  }

  const openEdit = (rec: AioDataRecord) => {
    setFormName(rec.aio_name)
    const elems = [...(rec.elements ?? [])]
    while (elems.length < AIO_COUNT) elems.push(null)
    setFormElements(elems.slice(0, AIO_COUNT))
    setDialog({ open: true, mode: "edit", record: rec })
  }

  const handleSave = async () => {
    if (!formName.trim()) { toast.error("AIO Name is required."); return }
    setIsSaving(true)
    try {
      if (dialog.mode === "add") {
        const created = await createAioData(formName.trim(), formElements)
        if (!created) { toast.error("Failed to create AIO record."); return }
        toast.success("AIO record created.")
      } else if (dialog.record) {
        const updated = await updateAioData(dialog.record.aio_id, formName.trim(), formElements)
        if (!updated) { toast.error("Failed to update AIO record."); return }
        toast.success("AIO record updated.")
      }
      setDialog({ open: false, mode: "add" })
      await load()
    } finally { setIsSaving(false) }
  }

  const handleDelete = async (rec: AioDataRecord) => {
    const ok = await deleteAioData(rec.aio_id)
    if (ok) { toast.success("AIO record deleted."); await load() }
    else toast.error("Failed to delete AIO record.")
    setDeleteConfirm(null)
  }

  const setElem = (i: number, val: string) => {
    setFormElements((prev) => { const next = [...prev]; next[i] = val || null; return next })
  }

  const filledCount = formElements.filter((e) => e !== null && e !== "").length

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">AIO records with up to 50 element fields each.</p>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add AIO Record</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12">
          <Database className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No AIO records found.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">AIO Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Elements</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => {
                const filled = (rec.elements ?? []).filter((e) => e !== null && e !== "").length
                return (
                  <tr key={rec.aio_id} className="border-t border-border hover:bg-accent/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{rec.aio_name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{filled} / {AIO_COUNT} filled</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(rec.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(rec)} className="gap-1 h-7 px-2"><Pencil className="w-3 h-3" />Edit</Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(rec)} className="gap-1 h-7 px-2 text-destructive hover:text-destructive"><Trash2 className="w-3 h-3" />Delete</Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <AioEditDialog
        open={dialog.open}
        mode={dialog.mode}
        formName={formName}
        formElements={formElements}
        filledCount={filledCount}
        isSaving={isSaving}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
        onChangeName={setFormName}
        onChangeElement={setElem}
        onSave={handleSave}
      />

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete AIO Record</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Delete <strong>{deleteConfirm?.aio_name}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2"><Trash2 className="w-4 h-4" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── MRO Data Pane ──────────────────────────────────────────────────
// Browses persisted Memory Result Objects: list, view, edit, and delete.
// Heavy fields (result_text, context_bundle) are lazy-loaded via
// getMroObject() only when the operator opens the edit dialog — keeps
// the table fast on tenants with thousands of MROs.

const MRO_CONFIDENCE_OPTIONS = ["draft", "derived", "reviewed", "verified"] as const

function MroDataPane() {
  const [records, setRecords] = useState<MroObject[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [dialog, setDialog] = useState<{ open: boolean; record?: MroObject; loading: boolean }>({ open: false, loading: false })
  const [deleteConfirm, setDeleteConfirm] = useState<MroObject | null>(null)
  const [form, setForm] = useState<{
    mro_key: string
    query_text: string
    intent: string
    seed_hsls: string
    matched_aios_count: number
    result_text: string
    context_bundle: string
    confidence: string
    policy_scope: string
  }>({
    mro_key: "", query_text: "", intent: "", seed_hsls: "",
    matched_aios_count: 0, result_text: "", context_bundle: "",
    confidence: "derived", policy_scope: "tenantA",
  })
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    // Summary projection — heavy fields hydrated on edit-open.
    const rows = await listMroObjects(500, { summary: true })
    setRecords(rows)
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openEdit = async (rec: MroObject) => {
    setDialog({ open: true, record: rec, loading: true })
    // Hydrate the full record so the editor has result_text / context_bundle.
    const full = await getMroObject(rec.mro_id)
    if (!full) {
      toast.error("Failed to load MRO.")
      setDialog({ open: false, loading: false })
      return
    }
    setForm({
      mro_key: full.mro_key ?? "",
      query_text: full.query_text ?? "",
      intent: full.intent ?? "",
      seed_hsls: full.seed_hsls ?? "",
      matched_aios_count: full.matched_aios_count ?? 0,
      result_text: full.result_text ?? "",
      context_bundle: full.context_bundle ?? "",
      confidence: full.confidence ?? "derived",
      policy_scope: full.policy_scope ?? "tenantA",
    })
    setDialog({ open: true, record: full, loading: false })
  }

  const handleSave = async () => {
    if (!dialog.record) return
    if (!form.mro_key.trim()) { toast.error("MRO Key is required."); return }
    if (!form.query_text.trim()) { toast.error("Query Text is required."); return }
    if (!form.result_text.trim()) { toast.error("Result Text is required."); return }
    setIsSaving(true)
    try {
      const updated = await updateMroObject(dialog.record.mro_id, {
        mro_key: form.mro_key.trim(),
        query_text: form.query_text.trim(),
        intent: form.intent.trim() || null,
        seed_hsls: form.seed_hsls.trim() || null,
        matched_aios_count: form.matched_aios_count,
        result_text: form.result_text,
        context_bundle: form.context_bundle.trim() || null,
        confidence: form.confidence,
        policy_scope: form.policy_scope,
      })
      if (!updated) { toast.error("Failed to update MRO."); return }
      toast.success("MRO updated.")
      setDialog({ open: false, loading: false })
      await load()
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (rec: MroObject) => {
    const ok = await deleteMroObject(rec.mro_id)
    if (ok) { toast.success("MRO deleted."); await load() }
    else toast.error("Failed to delete MRO.")
    setDeleteConfirm(null)
  }

  const filtered = filter.trim()
    ? records.filter((r) => {
        const f = filter.toLowerCase()
        return (
          (r.mro_key ?? "").toLowerCase().includes(f) ||
          (r.query_text ?? "").toLowerCase().includes(f) ||
          (r.intent ?? "").toLowerCase().includes(f)
        )
      })
    : records

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-4">
        <p className="text-sm text-muted-foreground flex-1">
          Persisted retrieval episodes — query, result, search terms, and lineage. Trust score reflects how often this MRO has been reused as a prior.
        </p>
        <Input
          placeholder="Filter by key, query, intent…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs h-9 text-sm"
        />
        <Button variant="outline" onClick={load} className="gap-2"><RefreshCw className="w-4 h-4" />Refresh</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Brain className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {records.length === 0 ? "No MROs found yet — they're saved automatically when ChatAIO answers a question." : "No MROs match the current filter."}
          </p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">MRO Key</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Query</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">AIOs</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Confidence</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Trust</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Updated</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((rec) => (
                <tr key={rec.mro_id} className="border-t border-border hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium font-mono text-xs">{rec.mro_key}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-xs truncate" title={rec.query_text}>{rec.query_text}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{rec.matched_aios_count}</td>
                  <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{rec.confidence}</Badge></td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{(rec.trust_score ?? 0).toFixed(1)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(rec.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(rec)} className="gap-1 h-7 px-2"><Pencil className="w-3 h-3" />Edit</Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(rec)} className="gap-1 h-7 px-2 text-destructive hover:text-destructive"><Trash2 className="w-3 h-3" />Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit dialog */}
      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, loading: false })}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Brain className="w-5 h-5" />Edit MRO</DialogTitle>
          </DialogHeader>
          {dialog.loading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">MRO Key</Label>
                  <Input value={form.mro_key} onChange={(e) => setForm((f) => ({ ...f, mro_key: e.target.value }))} className="font-mono text-xs" />
                </div>
                <div>
                  <Label className="text-xs">Confidence</Label>
                  <Select value={form.confidence} onValueChange={(v) => setForm((f) => ({ ...f, confidence: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MRO_CONFIDENCE_OPTIONS.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Query Text</Label>
                <textarea
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                  value={form.query_text}
                  onChange={(e) => setForm((f) => ({ ...f, query_text: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Intent</Label>
                  <Input value={form.intent} onChange={(e) => setForm((f) => ({ ...f, intent: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs">Matched AIOs</Label>
                  <Input
                    type="number"
                    value={form.matched_aios_count}
                    onChange={(e) => setForm((f) => ({ ...f, matched_aios_count: parseInt(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Seed HSLs (comma-separated)</Label>
                <Input
                  value={form.seed_hsls}
                  onChange={(e) => setForm((f) => ({ ...f, seed_hsls: e.target.value }))}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label className="text-xs">Result Text</Label>
                <textarea
                  className="w-full min-h-[180px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.result_text}
                  onChange={(e) => setForm((f) => ({ ...f, result_text: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Context Bundle (optional)</Label>
                <textarea
                  className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                  value={form.context_bundle}
                  onChange={(e) => setForm((f) => ({ ...f, context_bundle: e.target.value }))}
                />
              </div>
              <div>
                <Label className="text-xs">Policy Scope</Label>
                <Input
                  value={form.policy_scope}
                  onChange={(e) => setForm((f) => ({ ...f, policy_scope: e.target.value }))}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, loading: false })}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || dialog.loading} className="gap-2">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete MRO</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Delete <strong className="font-mono text-xs">{deleteConfirm?.mro_key}</strong>? This cannot be undone, and any cache entries pointing to this MRO will be cleared.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2"><Trash2 className="w-4 h-4" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── HSL Data Pane ──────────────────────────────────────────────────

const HSL_COUNT = 100
const SIDEBAR_BLUE = "#0F3460"

function HslDataPane() {
  const [records, setRecords] = useState<HslDataRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Add/Edit dialog (full 100-field form — used for Add and also the Structure viewer)
  const [structDialog, setStructDialog] = useState<{ open: boolean; mode: "add" | "structure"; record?: HslDataRecord }>({ open: false, mode: "add" })
  const [formName, setFormName] = useState("")
  const [formElements, setFormElements] = useState<(string | null)[]>(emptyElements(HSL_COUNT))
  const [isSaving, setIsSaving] = useState(false)

  // Inline edit dialog — shown when user clicks "Edit"
  const [editDialog, setEditDialog] = useState<{ open: boolean; record?: HslDataRecord }>({ open: false })
  const [editName, setEditName] = useState("")
  const [editElements, setEditElements] = useState<(string | null)[]>(emptyElements(HSL_COUNT))
  const [isEditSaving, setIsEditSaving] = useState(false)

  const [deleteConfirm, setDeleteConfirm] = useState<HslDataRecord | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setRecords(await listHslData())
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Structure / Add dialog ────────────────────────────────────────
  const openAdd = () => {
    setFormName("")
    setFormElements(emptyElements(HSL_COUNT))
    setStructDialog({ open: true, mode: "add" })
  }

  const openStructure = (rec: HslDataRecord) => {
    setFormName(rec.hsl_name)
    const elems = [...(rec.elements ?? [])]
    while (elems.length < HSL_COUNT) elems.push(null)
    setFormElements(elems.slice(0, HSL_COUNT))
    setStructDialog({ open: true, mode: "structure", record: rec })
  }

  const handleStructSave = async () => {
    if (!formName.trim()) { toast.error("HSL Name is required."); return }
    setIsSaving(true)
    try {
      if (structDialog.mode === "add") {
        const created = await createHslData(formName.trim(), formElements)
        if (!created) { toast.error("Failed to create HSL record."); return }
        toast.success("HSL record created.")
      }
      setStructDialog({ open: false, mode: "add" })
      await load()
    } finally { setIsSaving(false) }
  }

  const structFilledCount = formElements.filter((e) => e !== null && e !== "").length

  // ── Edit dialog ───────────────────────────────────────────────────
  const openEdit = (rec: HslDataRecord) => {
    setEditName(rec.hsl_name)
    const elems = [...(rec.elements ?? [])]
    while (elems.length < HSL_COUNT) elems.push(null)
    setEditElements(elems.slice(0, HSL_COUNT))
    setEditDialog({ open: true, record: rec })
  }

  const setEditElem = (i: number, val: string) => {
    setEditElements((prev) => { const next = [...prev]; next[i] = val || null; return next })
  }

  const handleEditSave = async () => {
    if (!editName.trim()) { toast.error("HSL Name is required."); return }
    if (!editDialog.record) return
    setIsEditSaving(true)
    try {
      const updated = await updateHslData(editDialog.record.hsl_id, editName.trim(), editElements)
      if (!updated) { toast.error("Failed to update HSL record."); return }
      toast.success("HSL record updated.")
      setEditDialog({ open: false })
      await load()
    } finally { setIsEditSaving(false) }
  }

  const editFilledCount = editElements.filter((e) => e !== null && e !== "").length

  // ── Delete ────────────────────────────────────────────────────────
  const handleDelete = async (rec: HslDataRecord) => {
    const ok = await deleteHslData(rec.hsl_id)
    if (ok) { toast.success("HSL record deleted."); await load() }
    else toast.error("Failed to delete HSL record.")
    setDeleteConfirm(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">HSL records with up to 100 element fields each.</p>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add HSL Record</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12">
          <LayoutList className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No HSL records found.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-40">HSL Name</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Elements</th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => {
                const filledElems = (rec.elements ?? []).filter((e) => e !== null && e !== "") as string[]
                return (
                  <tr key={rec.hsl_id} className="border-t border-border hover:bg-accent/30 transition-colors align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-sm leading-tight">{rec.hsl_name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{new Date(rec.created_at).toLocaleDateString()}</div>
                    </td>
                    <td className="px-3 py-2">
                      {filledElems.length === 0 ? (
                        <span className="text-xs text-muted-foreground italic">No elements</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {filledElems.slice(0, 10).map((el, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold text-white leading-6 tracking-wide"
                              style={{ backgroundColor: SIDEBAR_BLUE }}
                            >
                              {el}
                            </span>
                          ))}
                          {filledElems.length > 10 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-muted/60 text-muted-foreground border border-border leading-6">
                              +{filledElems.length - 10}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(rec)} title="Edit record" className="h-7 w-7 p-0"><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => openStructure(rec)} title="View structure" className="h-7 w-7 p-0 text-blue-400 hover:text-blue-300"><LayoutGrid className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(rec)} title="Delete record" className="h-7 w-7 p-0 text-destructive hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Edit Dialog — inline editable element display ─────────── */}
      <Dialog open={editDialog.open} onOpenChange={(o) => setEditDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          {/* Dark blue header matching sidebar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-white/10" style={{ backgroundColor: SIDEBAR_BLUE }}>
            <div>
              <DialogTitle className="text-white text-base font-semibold">Edit HSL Record</DialogTitle>
              <p className="text-white/60 text-xs mt-0.5">Click on element to Edit</p>
            </div>
            <span className="text-white/50 text-xs">{editFilledCount} / {HSL_COUNT} filled</span>
          </div>

          {/* Body */}
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            {/* HSL Name */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">HSL Name</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Record name..." />
            </div>

            {/* Elements as editable dark-blue styled inputs */}
            <div>
              <p className="text-xs text-muted-foreground mb-3">All elements — edit any value below:</p>
              <div className="grid grid-cols-1 gap-1.5">
                {editElements.map((el, i) => {
                  const isFilled = el !== null && el !== ""
                  return (
                    <div key={i} className={`flex items-center gap-2 rounded px-3 py-1.5 transition-colors ${isFilled ? "bg-white border border-[#0F3460]/40" : "bg-muted/20 border border-transparent"}`}>
                      <span className={`text-[10px] w-16 shrink-0 font-mono ${isFilled ? "text-[#0F3460]" : "text-muted-foreground"}`}>E{String(i + 1).padStart(2, "0")}</span>
                      <input
                        value={el ?? ""}
                        onChange={(e) => setEditElem(i, e.target.value)}
                        placeholder={`Element ${i + 1}`}
                        className={`flex-1 bg-transparent text-xs outline-none border-none placeholder:text-muted-foreground/40 ${isFilled ? "text-black font-bold font-mono" : "text-foreground"}`}
                        style={isFilled ? { color: "#000000", textShadow: "none" } : {}}
                      />
                      {isFilled && (
                        <button
                          onClick={() => setEditElem(i, "")}
                          className="text-[#0F3460]/40 hover:text-[#0F3460] text-[10px] shrink-0"
                          title="Clear"
                        >✕</button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Footer — Save / Cancel inside the box */}
          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20">
            <Button variant="outline" onClick={() => setEditDialog((d) => ({ ...d, open: false }))}>Cancel</Button>
            <Button onClick={handleEditSave} disabled={isEditSaving} className="gap-2" style={{ backgroundColor: SIDEBAR_BLUE }}>
              {isEditSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Structure Dialog — full 100-field form ────────────────── */}
      <Dialog open={structDialog.open} onOpenChange={(o) => setStructDialog((d) => ({ ...d, open: o }))}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
            <div>
              <DialogTitle className="text-base font-semibold">
                {structDialog.mode === "add" ? "Add HSL Record" : "HSL Structure"}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                {structDialog.mode === "add" ? "Define the new HSL record and its element slots." : `All ${HSL_COUNT} element slots for this record.`}
              </p>
            </div>
            <span className="text-xs text-muted-foreground">{structFilledCount} / {HSL_COUNT} filled</span>
          </div>

          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            <div className="space-y-1">
              <Label>HSL Name</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Record name..."
                readOnly={structDialog.mode === "structure"}
                className={structDialog.mode === "structure" ? "bg-muted/50 cursor-default" : ""}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: HSL_COUNT }, (_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-28 shrink-0">HSL Element {i + 1}</span>
                  <Input
                    value={formElements[i] ?? ""}
                    readOnly
                    className="h-7 text-xs bg-muted/40 cursor-default"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-muted/20">
            <Button variant="outline" onClick={() => setStructDialog((d) => ({ ...d, open: false }))}>
              {structDialog.mode === "structure" ? "Close" : "Cancel"}
            </Button>
            {structDialog.mode === "add" && (
              <Button onClick={handleStructSave} disabled={isSaving} className="gap-2">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Create Record
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete HSL Record</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Delete <strong>{deleteConfirm?.hsl_name}</strong>? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2"><Trash2 className="w-4 h-4" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Demo Reset Pane ────────────────────────────────────────────────
// Backup, wipe, and restore all demo data tables (everything except
// users, roles, and system settings). Designed for clearing the system
// before a new demo while preserving the ability to roll back.

function DemoResetPane() {
  const [backups, setBackups] = useState<DemoBackupSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  // Manual backup form
  const [backupName, setBackupName] = useState("")
  const [backupNote, setBackupNote] = useState("")

  // Reset confirm dialog
  const [resetOpen, setResetOpen] = useState(false)
  const [resetCreateBackup, setResetCreateBackup] = useState(true)
  const [resetConfirmText, setResetConfirmText] = useState("")
  const [resetBackupName, setResetBackupName] = useState("")

  // Restore confirm dialog
  const [restoreTarget, setRestoreTarget] = useState<DemoBackupSummary | null>(null)
  const [restoreConfirmText, setRestoreConfirmText] = useState("")

  const refresh = useCallback(async () => {
    setLoading(true)
    const rows = await listDemoBackups()
    setBackups(rows)
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const totalRowsInBackup = (b: DemoBackupSummary) =>
    Object.values(b.counts || {}).reduce((a, n) => a + (Number(n) || 0), 0)

  const handleCreateBackup = async () => {
    if (!backupName.trim()) {
      toast.error("Please give the backup a name")
      return
    }
    setBusy("backup")
    const result = await createDemoBackup(backupName.trim(), backupNote.trim() || undefined)
    setBusy(null)
    if (result) {
      toast.success(`Backup created: ${result.name}`)
      setBackupName("")
      setBackupNote("")
      refresh()
    } else {
      toast.error("Failed to create backup")
    }
  }

  const handleDeleteBackup = async (b: DemoBackupSummary) => {
    if (!confirm(`Permanently delete backup "${b.name}"? This cannot be undone.`)) return
    setBusy(b.backup_id)
    const ok = await deleteDemoBackup(b.backup_id)
    setBusy(null)
    if (ok) {
      toast.success("Backup deleted")
      refresh()
    } else {
      toast.error("Failed to delete backup")
    }
  }

  const handleReset = async () => {
    if (resetConfirmText !== "ERASE") {
      toast.error('Type ERASE in capital letters to confirm')
      return
    }
    setBusy("reset")
    const result = await resetDemoData({
      create_backup_first: resetCreateBackup,
      backup_name: resetCreateBackup ? (resetBackupName.trim() || undefined) : undefined,
      backup_note: resetCreateBackup ? "Auto-created before demo reset" : undefined,
    })
    setBusy(null)
    if (result) {
      const wipedTotal = Object.values(result.wiped || {}).reduce((a, n) => a + (Number(n) || 0), 0)
      toast.success(
        result.backup_id
          ? `Demo data erased (${wipedTotal} rows). Backup saved before wipe.`
          : `Demo data erased (${wipedTotal} rows). No backup was made.`
      )
      setResetOpen(false)
      setResetConfirmText("")
      setResetBackupName("")
      refresh()
    } else {
      toast.error("Reset failed — see backend logs")
    }
  }

  const handleRestore = async () => {
    if (!restoreTarget) return
    if (restoreConfirmText !== "RESTORE") {
      toast.error('Type RESTORE in capital letters to confirm')
      return
    }
    setBusy("restore")
    const result = await restoreDemoBackup(restoreTarget.backup_id)
    setBusy(null)
    if (result) {
      const total = Object.values(result.restored || {}).reduce((a, n) => a + (Number(n) || 0), 0)
      toast.success(`Restored ${total} rows from "${restoreTarget.name}"`)
      setRestoreTarget(null)
      setRestoreConfirmText("")
      refresh()
    } else {
      toast.error("Restore failed — see backend logs")
    }
  }

  return (
    <div className="space-y-6">
      {/* Warning banner */}
      <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900/60 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-red-700 dark:text-red-400">Destructive operations</p>
            <p className="text-sm text-red-700/90 dark:text-red-300/90">
              Erasing demo data permanently removes all AIOs, HSLs, MROs, Information Elements,
              saved prompts, embeddings, query cache, citations, and chat statistics for this tenant.
              <strong className="font-semibold"> Users, roles, system settings, and saved backups are preserved.</strong>
            </p>
            <p className="text-sm text-red-700/90 dark:text-red-300/90">
              You can save the current state as a backup first, and restore it later to roll back.
            </p>
          </div>
        </div>
      </div>

      {/* Action row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Create backup */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="w-4 h-4" /> Create Backup
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Snapshot all current demo data into a named restore point.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Backup name</Label>
              <Input
                value={backupName}
                onChange={(e) => setBackupName(e.target.value)}
                placeholder="e.g., Before Acme demo, March 14"
              />
            </div>
            <div>
              <Label className="text-xs">Note (optional)</Label>
              <Input
                value={backupNote}
                onChange={(e) => setBackupNote(e.target.value)}
                placeholder="What's in this state?"
              />
            </div>
            <Button onClick={handleCreateBackup} disabled={busy === "backup"} className="w-full">
              {busy === "backup" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Create Backup
            </Button>
          </CardContent>
        </Card>

        {/* Erase */}
        <Card className="border-red-300 dark:border-red-900/60">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-red-700 dark:text-red-400">
              <AlertTriangle className="w-4 h-4" /> Erase All Demo Data
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Wipe AIOs, HSLs, MROs, Info Elements, prompts, and all derived data for this tenant.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This action cannot be undone except by restoring from a backup.
              You can have the system create a safety backup automatically before erasing.
            </p>
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => {
                setResetCreateBackup(true)
                setResetConfirmText("")
                setResetBackupName(`Auto-backup ${new Date().toISOString().slice(0,16).replace("T"," ")}`)
                setResetOpen(true)
              }}
            >
              <Trash2 className="w-4 h-4 mr-2" /> Erase All Demo Data…
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Backups list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="w-4 h-4" /> Saved Backups
              <Badge variant="secondary">{backups.length}</Badge>
            </CardTitle>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No backups yet. Create one above before erasing or whenever you reach a state worth keeping.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left p-2 font-medium">Name</th>
                    <th className="text-left p-2 font-medium">Note</th>
                    <th className="text-left p-2 font-medium">Created</th>
                    <th className="text-right p-2 font-medium">Rows</th>
                    <th className="text-right p-2 font-medium w-48">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.backup_id} className="border-b hover:bg-muted/20">
                      <td className="p-2 font-medium">{b.name}</td>
                      <td className="p-2 text-muted-foreground">{b.note || "—"}</td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="p-2 text-right tabular-nums">{totalRowsInBackup(b).toLocaleString()}</td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setRestoreTarget(b); setRestoreConfirmText("") }}
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDeleteBackup(b)}
                            disabled={busy === b.backup_id}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reset confirm dialog */}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertTriangle className="w-5 h-5" /> Erase All Demo Data
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900/60 p-3">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                This will permanently delete all demo data for this tenant.
              </p>
              <ul className="text-xs text-red-700/90 dark:text-red-300/90 list-disc list-inside mt-2 space-y-0.5">
                <li>AIOs, HSLs, MROs, Information Elements, saved prompts</li>
                <li>Embeddings, query cache, citations, chat statistics</li>
                <li>Field maps and all derived/auxiliary tables</li>
              </ul>
              <p className="text-xs text-red-700/90 dark:text-red-300/90 mt-2">
                Preserved: users, roles, system settings, and existing backups.
              </p>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1"
                checked={resetCreateBackup}
                onChange={(e) => setResetCreateBackup(e.target.checked)}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">Create a safety backup first (recommended)</p>
                <p className="text-xs text-muted-foreground">
                  Snapshot the current state into a named backup before erasing, so you can roll back.
                </p>
              </div>
            </label>

            {resetCreateBackup && (
              <div>
                <Label className="text-xs">Backup name</Label>
                <Input
                  value={resetBackupName}
                  onChange={(e) => setResetBackupName(e.target.value)}
                  placeholder="Auto-backup before reset"
                />
              </div>
            )}

            <div>
              <Label className="text-xs">
                Type <span className="font-mono font-bold">ERASE</span> to confirm
              </Label>
              <Input
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder="ERASE"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(false)} disabled={busy === "reset"}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={busy === "reset" || resetConfirmText !== "ERASE"}
            >
              {busy === "reset"
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Erasing…</>
                : <><Trash2 className="w-4 h-4 mr-2" /> Erase All Demo Data</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Restore confirm dialog */}
      <Dialog open={!!restoreTarget} onOpenChange={(open) => { if (!open) setRestoreTarget(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5" /> Restore from Backup
            </DialogTitle>
          </DialogHeader>
          {restoreTarget && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="text-sm font-medium">{restoreTarget.name}</p>
                {restoreTarget.note && <p className="text-xs text-muted-foreground mt-1">{restoreTarget.note}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  Created {new Date(restoreTarget.created_at).toLocaleString()} ·
                  {" "}{totalRowsInBackup(restoreTarget).toLocaleString()} rows
                </p>
              </div>
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900/60 p-3">
                <p className="text-sm text-amber-800 dark:text-amber-200 font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Restoring will replace current data
                </p>
                <p className="text-xs text-amber-800/90 dark:text-amber-200/90 mt-1">
                  All current AIOs, HSLs, MROs, and derived data for this tenant will be erased and
                  replaced with the contents of this backup. Users, roles, settings, and other
                  backups are preserved.
                </p>
              </div>
              <div>
                <Label className="text-xs">
                  Type <span className="font-mono font-bold">RESTORE</span> to confirm
                </Label>
                <Input
                  value={restoreConfirmText}
                  onChange={(e) => setRestoreConfirmText(e.target.value)}
                  placeholder="RESTORE"
                  autoFocus
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreTarget(null)} disabled={busy === "restore"}>Cancel</Button>
            <Button
              onClick={handleRestore}
              disabled={busy === "restore" || restoreConfirmText !== "RESTORE"}
            >
              {busy === "restore"
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Restoring…</>
                : <><CheckCircle2 className="w-4 h-4 mr-2" /> Restore Backup</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── API Key Pane ───────────────────────────────────────────────────

function ApiKeyPane() {
  const [masked, setMasked] = useState<string | null>(null)
  const [configured, setConfigured] = useState(false)
  const [newKey, setNewKey] = useState("")
  const [showKey, setShowKey] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getApiKeySetting().then((r) => {
      if (r) { setConfigured(r.configured); setMasked(r.masked) }
      setIsLoading(false)
    })
  }, [])

  const handleSave = async () => {
    if (!newKey.trim().startsWith("sk-")) { toast.error("API key must start with 'sk-'"); return }
    setIsSaving(true)
    const result = await updateApiKeySetting(newKey.trim())
    if (result?.ok) {
      toast.success("API key updated successfully.")
      const trimmed = newKey.trim()
      setMasked(trimmed.slice(0, 7) + "..." + trimmed.slice(-4))
      setConfigured(true)
      setNewKey("")
    } else {
      toast.error("Failed to update API key.")
    }
    setIsSaving(false)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <p className="text-sm text-muted-foreground mb-4">The Anthropic API key is used for all AI operations. Updating the key here takes effect immediately.</p>
        <div className="p-4 rounded-lg border border-border bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <Key className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Current API Key</span>
          </div>
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground mt-2" /> : configured ? (
            <code className="text-sm font-mono text-foreground">{masked}</code>
          ) : (
            <span className="text-sm text-muted-foreground italic">Not configured</span>
          )}
        </div>
      </div>
      <div className="space-y-3">
        <Label htmlFor="new-api-key">Update API Key</Label>
        <div className="relative">
          <Input id="new-api-key" type={showKey ? "text" : "password"} value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="sk-ant-api03-..." className="pr-10 font-mono" onKeyDown={(e) => e.key === "Enter" && handleSave()} />
          <button type="button" onClick={() => setShowKey((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <Button onClick={handleSave} disabled={isSaving || !newKey.trim()} className="gap-2">
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save API Key
        </Button>
      </div>
    </div>
  )
}

// ── Saved CSVs Pane ────────────────────────────────────────────────

function SavedCsvsPane() {
  const [records, setRecords] = useState<IORecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [previewRecord, setPreviewRecord] = useState<IORecord | null>(null)
  const [previewHeaders, setPreviewHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])

  const load = useCallback(async () => {
    setIsLoading(true)
    setRecords(await listIOs({ type: "CSV", source_system: "csv-converter", limit: 5000 }))
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openPreview = (rec: IORecord) => {
    const uri = rec.raw.raw_uri ?? ""
    let csvText = uri.startsWith("data:text/csv,") ? decodeURIComponent(uri.slice("data:text/csv,".length)) : uri
    const lines = csvText.split("\n").filter((l) => l.trim())
    if (lines.length === 0) { setPreviewHeaders([]); setPreviewRows([]) }
    else {
      const headers = lines[0].split(",")
      const rows = lines.slice(1).map((l) => {
        const cells: string[] = []; let inQuote = false; let cell = ""
        for (const ch of l + ",") {
          if (ch === '"') inQuote = !inQuote
          else if (ch === "," && !inQuote) { cells.push(cell); cell = "" }
          else cell += ch
        }
        while (cells.length < headers.length) cells.push("")
        return cells
      })
      setPreviewHeaders(headers); setPreviewRows(rows)
    }
    setPreviewRecord(rec)
  }

  const formatBytes = (n: number | null) => {
    if (!n) return ""
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(2)} MB`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Original CSV files saved during upload.</p>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <Loader2 className={`w-3 h-3 ${isLoading ? "animate-spin" : "hidden"}`} />Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : records.length === 0 ? (
        <div className="text-center py-12">
          <FileSpreadsheet className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No saved CSV files found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {records.map((rec) => (
            <button key={rec.io_id} onClick={() => openPreview(rec)} className="text-left p-4 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors group">
              <div className="flex items-start gap-3">
                <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{rec.context.source_object_id ?? "unknown.csv"}</p>
                  <p className="text-xs text-muted-foreground mt-1">{new Date(rec.created_at).toLocaleString()}</p>
                  {rec.raw.size_bytes != null && <p className="text-xs text-muted-foreground">{formatBytes(rec.raw.size_bytes)}</p>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Dialog open={!!previewRecord} onOpenChange={(o) => !o && setPreviewRecord(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5 text-green-600" />{previewRecord?.context.source_object_id ?? "CSV Preview"}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            {previewHeaders.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No data to display.</p> : (
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
                  <tr>{previewHeaders.map((h, i) => <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {previewRows.map((row, ri) => (
                    <tr key={ri} className="border-b border-border/50 hover:bg-accent/30">
                      {row.map((cell, ci) => <td key={ci} className="px-3 py-2 text-foreground whitespace-nowrap max-w-[200px] overflow-hidden text-ellipsis">{cell}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="pt-2 text-xs text-muted-foreground border-t border-border">
            {previewRows.length} rows · {previewHeaders.length} columns · saved {previewRecord ? new Date(previewRecord.created_at).toLocaleString() : ""}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Saved AIOs Pane ────────────────────────────────────────────────

function SavedAiosPane() {
  const [records, setRecords] = useState<IORecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedLines, setSelectedLines] = useState<string[]>([])

  const load = useCallback(async () => {
    setIsLoading(true)
    setRecords(await listIOs({ type: "AIO", source_system: "csv-converter", limit: 5000 }))
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const grouped = new Map<string, IORecord[]>()
  records.forEach((r) => {
    const key = r.context.source_object_id ?? "unknown"
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(r)
  })
  const fileList = Array.from(grouped.entries()).sort((a, b) => {
    const aDate = a[1][0]?.created_at ?? ""; const bDate = b[1][0]?.created_at ?? ""
    return bDate.localeCompare(aDate)
  })

  const openFile = (filename: string, recs: IORecord[]) => {
    setSelectedLines(recs.map((r) => {
      const uri = r.raw.raw_uri ?? ""
      return uri.startsWith("data:text/aio,") ? decodeURIComponent(uri.slice("data:text/aio,".length)) : uri
    }))
    setSelectedFile(filename)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">AIO records saved during CSV conversion.</p>
        <Button variant="outline" size="sm" onClick={load} className="gap-2">
          <Loader2 className={`w-3 h-3 ${isLoading ? "animate-spin" : "hidden"}`} />Refresh
        </Button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : fileList.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No saved AIO records found.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {fileList.map(([filename, recs]) => (
            <button key={filename} onClick={() => openFile(filename, recs)} className="text-left p-4 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors group">
              <div className="flex items-start gap-3">
                <FileText className="w-8 h-8 text-blue-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate group-hover:text-primary transition-colors">{filename}</p>
                  <p className="text-xs text-muted-foreground mt-1">{recs.length} AIO {recs.length === 1 ? "record" : "records"}</p>
                  <p className="text-xs text-muted-foreground">{new Date(recs[0].created_at).toLocaleString()}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <Dialog open={!!selectedFile} onOpenChange={(o) => !o && setSelectedFile(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-blue-600" />{selectedFile}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1 space-y-2 pr-1">
            {selectedLines.map((line, i) => (
              <div key={i} className="p-3 rounded-md bg-muted/50 border border-border/60 font-mono text-xs break-all leading-relaxed">
                <span className="text-muted-foreground mr-2 select-none">{i + 1}.</span>{line}
              </div>
            ))}
          </div>
          <div className="pt-2 text-xs text-muted-foreground border-t border-border">{selectedLines.length} AIO {selectedLines.length === 1 ? "record" : "records"}</div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Saved Prompts Pane ─────────────────────────────────────────────

function SavedPromptsPane() {
  const [prompts, setPrompts] = useState<SavedPrompt[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [dialog, setDialog] = useState<{ open: boolean; mode: "add" | "edit"; record?: SavedPrompt }>({ open: false, mode: "add" })
  const [deleteConfirm, setDeleteConfirm] = useState<SavedPrompt | null>(null)
  const [formText, setFormText] = useState("")
  const [formLabel, setFormLabel] = useState("")
  const [formCategory, setFormCategory] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    setPrompts(await listSavedPrompts())
    setIsLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => {
    setFormText(""); setFormLabel(""); setFormCategory("")
    setDialog({ open: true, mode: "add" })
  }

  const openEdit = (r: SavedPrompt) => {
    setFormText(r.prompt_text)
    setFormLabel(r.label ?? "")
    setFormCategory(r.category ?? "")
    setDialog({ open: true, mode: "edit", record: r })
  }

  const handleSave = async () => {
    if (!formText.trim()) { toast.error("Prompt text is required."); return }
    setIsSaving(true)
    if (dialog.mode === "add") {
      const created = await createSavedPrompt({
        prompt_text: formText.trim(),
        label: formLabel.trim() || null,
        category: formCategory.trim() || null,
      })
      if (!created) { toast.error("Failed to create prompt."); setIsSaving(false); return }
      toast.success("Prompt created.")
    } else if (dialog.record) {
      const updated = await updateSavedPrompt(dialog.record.prompt_id, {
        prompt_text: formText.trim(),
        label: formLabel.trim() || null,
        category: formCategory.trim() || null,
      })
      if (!updated) { toast.error("Failed to update prompt."); setIsSaving(false); return }
      toast.success("Prompt updated.")
    }
    setIsSaving(false)
    setDialog({ open: false, mode: "add" })
    await load()
  }

  const handleDelete = async (r: SavedPrompt) => {
    const ok = await deleteSavedPrompt(r.prompt_id)
    if (ok) { toast.success("Prompt deleted."); await load() }
    else toast.error("Failed to delete prompt.")
    setDeleteConfirm(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">Manage saved prompts available in ChatAIO.</p>
        <Button onClick={openAdd} className="gap-2"><Plus className="w-4 h-4" />Add Prompt</Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : prompts.length === 0 ? (
        <div className="text-center py-12">
          <Bookmark className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No saved prompts found. Add one or save from ChatAIO.</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Label</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Prompt Text</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Updated</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.prompt_id} className="border-t border-border hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{p.label || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate" title={p.prompt_text}>{p.prompt_text}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{p.category || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(p.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(p)} className="gap-1 h-7 px-2">
                      <Pencil className="w-3 h-3" />Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(p)} className="gap-1 h-7 px-2 text-destructive hover:text-destructive">
                      <Trash2 className="w-3 h-3" />Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, mode: "add" })}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{dialog.mode === "add" ? "Add Prompt" : "Edit Prompt"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="prompt-label">Label (optional)</Label>
              <Input id="prompt-label" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="A short name for this prompt…" />
            </div>
            <div>
              <Label htmlFor="prompt-category">Category (optional)</Label>
              <Input id="prompt-category" value={formCategory} onChange={(e) => setFormCategory(e.target.value)} placeholder="e.g. Analysis, Report…" />
            </div>
            <div>
              <Label htmlFor="prompt-text">Prompt Text *</Label>
              <textarea id="prompt-text" value={formText} onChange={(e) => setFormText(e.target.value)}
                placeholder="Enter the prompt text…" rows={4}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog({ open: false, mode: "add" })}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving} className="gap-2">
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {dialog.mode === "add" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Prompt</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground py-2">Delete this saved prompt? This cannot be undone.</p>
          <p className="text-sm font-medium truncate">{deleteConfirm?.label || deleteConfirm?.prompt_text}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2"><Trash2 className="w-4 h-4" />Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Information Elements Pane ──────────────────────────────────────

function InformationElementsPane() {
  const [elements, setElements] = useState<InformationElement[]>([])
  const [loading, setLoading] = useState(true)
  const [rebuilding, setRebuilding] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [editEl, setEditEl] = useState<InformationElement | null>(null)
  const [formName, setFormName] = useState("")
  const [formCount, setFormCount] = useState("0")
  const [viewFieldName, setViewFieldName] = useState<string | null>(null)
  const [fieldValues, setFieldValues] = useState<{ value: string; aioName: string; elements: (string | null)[] }[]>([])
  const [loadingValues, setLoadingValues] = useState(false)
  const [viewAio, setViewAio] = useState<{ aioName: string; elements: (string | null)[] } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await listInformationElements()
    setElements(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleViewFieldData = useCallback(async (fieldName: string) => {
    setViewFieldName(fieldName)
    setLoadingValues(true)
    setFieldValues([])
    const aios = await listAioData()
    const values: { value: string; aioName: string }[] = []
    const regex = new RegExp(`\\[${fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.([^\\]]+)\\]`)
    for (const aio of aios) {
      for (const el of aio.elements) {
        if (el) {
          const m = el.match(regex)
          if (m) values.push({ value: m[1], aioName: aio.aio_name, elements: aio.elements })
        }
      }
    }
    setFieldValues(values)
    setLoadingValues(false)
  }, [])

  const handleRebuild = async () => {
    setRebuilding(true)
    const result = await rebuildInformationElements()
    if (result) {
      toast.success(`Rebuilt: ${result.rebuilt} element field names`)
      await load()
    } else {
      toast.error("Rebuild failed")
    }
    setRebuilding(false)
  }

  const handleAdd = async () => {
    if (!formName.trim()) return
    const result = await createInformationElement(formName.trim(), parseInt(formCount) || 0)
    if (result) { toast.success("Element added"); setShowAdd(false); setFormName(""); setFormCount("0"); await load() }
  }

  const handleUpdate = async () => {
    if (!editEl || !formName.trim()) return
    const result = await updateInformationElement(editEl.element_id, formName.trim(), parseInt(formCount) || 0)
    if (result) { toast.success("Element updated"); setEditEl(null); setFormName(""); setFormCount("0"); await load() }
  }

  const handleDelete = async (el: InformationElement) => {
    if (await deleteInformationElement(el.element_id)) { toast.success("Deleted"); await load() }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => { setFormName(""); setFormCount("0"); setShowAdd(true) }} className="gap-2"><Plus className="w-4 h-4" />Add Element</Button>
        <Button size="sm" variant="outline" onClick={handleRebuild} disabled={rebuilding} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${rebuilding ? "animate-spin" : ""}`} />{rebuilding ? "Rebuilding..." : "Rebuild from AIOs"}
        </Button>
        <span className="text-sm text-muted-foreground ml-auto">{elements.length} elements</span>
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : (
        <div className="rounded border border-border overflow-auto max-h-[500px]">
          <table className="w-full text-sm">
            <thead className="bg-[#0f3460] sticky top-0">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-white">Field Name</th>
                <th className="text-left px-4 py-2 font-medium text-white">AIO Count</th>
                <th className="text-left px-4 py-2 font-medium text-white">Updated</th>
                <th className="text-left px-4 py-2 font-medium text-white w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {elements.map((el) => (
                <tr key={el.element_id} className="hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{el.field_name}</td>
                  <td className="px-4 py-2"><Badge variant="outline">{el.aio_count}</Badge></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{el.updated_at?.substring(0, 19)}</td>
                  <td className="px-4 py-2">
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-blue-600" onClick={() => handleViewFieldData(el.field_name)} title="View all values"><Eye className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setEditEl(el); setFormName(el.field_name); setFormCount(String(el.aio_count)) }}><Pencil className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500" onClick={() => handleDelete(el)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
              {elements.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">No elements. Click &quot;Rebuild from AIOs&quot; to scan all AIOs.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Information Element</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Field Name</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="e.g. Employee" /></div>
            <div><Label>AIO Count</Label><Input type="number" value={formCount} onChange={(e) => setFormCount(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={handleAdd} disabled={!formName.trim()}>Add</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editEl} onOpenChange={(open) => { if (!open) setEditEl(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Information Element</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Field Name</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} /></div>
            <div><Label>AIO Count</Label><Input type="number" value={formCount} onChange={(e) => setFormCount(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={handleUpdate} disabled={!formName.trim()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Field Data Dialog */}
      <Dialog open={!!viewFieldName} onOpenChange={(open) => { if (!open) setViewFieldName(null) }}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="w-5 h-5" />All values for: {viewFieldName}</DialogTitle>
          </DialogHeader>
          {loadingValues ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : (
            <div className="flex-1 overflow-auto">
              <p className="text-sm text-muted-foreground mb-3">{fieldValues.length} occurrence{fieldValues.length !== 1 ? "s" : ""} across AIOs</p>
              <div className="rounded border border-border overflow-auto max-h-[55vh]">
                <table className="w-full text-sm">
                  <thead className="bg-[#0f3460] sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-white w-8">#</th>
                      <th className="text-left px-4 py-2 font-medium text-white">Value</th>
                      <th className="text-left px-4 py-2 font-medium text-white">AIO Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {fieldValues.map((fv, i) => (
                      <tr key={i} className="hover:bg-muted/30">
                        <td className="px-4 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-1.5 text-sm font-medium"><button className="text-blue-600 hover:underline cursor-pointer text-left" onClick={() => setViewAio({ aioName: fv.aioName, elements: fv.elements })}>{fv.value}</button></td>
                        <td className="px-4 py-1.5 text-xs text-muted-foreground truncate max-w-[300px]">{fv.aioName}</td>
                      </tr>
                    ))}
                    {fieldValues.length === 0 && <tr><td colSpan={3} className="text-center py-8 text-muted-foreground">No values found</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View AIO Detail Dialog */}
      <Dialog open={!!viewAio} onOpenChange={(open) => { if (!open) setViewAio(null) }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm">{viewAio?.aioName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto">
            <div className="rounded border border-border overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead className="bg-[#0f3460] sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-white w-8">#</th>
                    <th className="text-left px-4 py-2 font-medium text-white">Element</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {viewAio?.elements.filter(Boolean).map((el, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="px-4 py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-1.5 text-sm font-mono">{el}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Search Stats Pane ─────────────────────────────────────────────

export function SearchStatsPane() {
  const [stats, setStats] = useState<ChatStatRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<"All" | "Send" | "PureLLM" | "AIOSearch" | "Substrate">("All")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [pdfPreviewHtml, setPdfPreviewHtml] = useState<string | null>(null)
  const [mroPopup, setMroPopup] = useState<MroForStat | null>(null)
  const [mroLoading, setMroLoading] = useState<string | null>(null)

  const handleViewMro = async (statId: string) => {
    setMroLoading(statId)
    const mro = await getMroForStat(statId)
    setMroLoading(null)
    if (!mro) {
      toast.error("MRO not found for this stat")
      return
    }
    setMroPopup(mro)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const data = await listChatStats()
    setStats(data)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleDelete = async (statId: string) => {
    await deleteChatStat(statId)
    setStats((prev) => prev.filter((s) => s.stat_id !== statId))
  }

  const visible = filter === "All" ? stats : stats.filter((s) => s.search_mode === filter)

  const modeBadge = (mode: string) => {
    if (mode === "Send") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">Blind Dump AIO/HSL</span>
    if (mode === "PureLLM") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">CSV→LLM Raw</span>
    if (mode === "AIOSearch") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">AIO Search</span>
    if (mode === "Substrate") return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">Substrate</span>
    return <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-muted text-muted-foreground">{mode}</span>
  }

  // Summary totals
  const totalSearches = stats.length
  const byMode = { Send: 0, PureLLM: 0, AIOSearch: 0, Substrate: 0 } as Record<string, number>
  let totalTokens = 0, avgElapsed = 0
  for (const s of stats) {
    byMode[s.search_mode] = (byMode[s.search_mode] ?? 0) + 1
    totalTokens += s.total_tokens
    avgElapsed += s.elapsed_ms
  }
  avgElapsed = totalSearches > 0 ? Math.round(avgElapsed / totalSearches) : 0

  // ── Build a printable HTML document of the current view ──────────────
  const buildPrintableHtml = useCallback((): string => {
    // Defense-in-depth: cover both text and attribute contexts so any
    // future code that interpolates user-controlled fields (query_text,
    // mode labels, etc.) into HTML attributes doesn't open an XSS hole.
    const esc = (s: string) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
    const modeLabel = (m: string) =>
      m === "Send" ? "Blind Dump AIO/HSL"
      : m === "PureLLM" ? "CSV→LLM Raw"
      : m === "AIOSearch" ? "AIO Search"
      : m === "Substrate" ? "Substrate"
      : m
    const modeBadgeClass = (m: string) =>
      m === "Send" ? "badge-blind"
      : m === "PureLLM" ? "badge-csv"
      : m === "AIOSearch" ? "badge-aio"
      : m === "Substrate" ? "badge-sub"
      : "badge-default"
    const rowsHtml = visible.map((s) => `
      <tr>
        <td>${esc(new Date(s.created_at).toLocaleString())}</td>
        <td><span class="badge ${modeBadgeClass(s.search_mode)}">${esc(modeLabel(s.search_mode))}</span></td>
        <td class="query">${esc(s.query_text)}</td>
        <td class="num">${(s.elapsed_ms ?? 0).toLocaleString()}</td>
        <td class="num">${(s.input_tokens ?? 0).toLocaleString()}</td>
        <td class="num">${(s.output_tokens ?? 0).toLocaleString()}</td>
        <td class="num bold">${(s.total_tokens ?? 0).toLocaleString()}</td>
        <td class="num">${s.matched_hsls || "—"}</td>
        <td class="num">${s.matched_aios || s.neighborhood_size || "—"}</td>
        <td class="num">${s.cue_count || "—"}</td>
        <td class="center">${s.mro_saved ? "✓" : "—"}</td>
      </tr>`).join("")

    const filterLabel = filter === "All" ? "All modes" : modeLabel(filter)

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Search Stats — ${new Date().toLocaleDateString()}</title>
  <style>
    /* CRITICAL for color-preserving Print → Save as PDF.
       Without these the print engine will strip backgrounds/borders. */
    *, *::before, *::after {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #ffffff; }
    body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 11px; color: #1a1a2e; padding: 32px; }
    h1 { color: #0f3460; font-size: 20px; margin-bottom: 4px; }
    h2 { color: #0f3460; font-size: 14px; margin: 18px 0 8px; }
    .subtitle { color: #64748b; font-size: 11px; margin-bottom: 16px; }
    .summary { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; margin-bottom: 18px; }
    .summary .card { border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; text-align: center; background: #f8fafc; }
    .summary .num { font-size: 16px; font-weight: 700; color: #0f3460; }
    .summary .lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    thead tr { background: #0f3460 !important; color: #ffffff !important; }
    thead th { padding: 6px 8px; text-align: left; font-weight: 600; border-right: 1px solid #1a4a7a; color: #ffffff; }
    thead th.num, thead th.center { text-align: right; }
    thead th.center { text-align: center; }
    tbody tr { border-bottom: 1px solid #e2e8f0; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    tbody td { padding: 5px 8px; border-right: 1px solid #f1f5f9; vertical-align: top; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.bold { font-weight: 600; }
    td.center { text-align: center; }
    td.query { max-width: 280px; overflow: hidden; text-overflow: ellipsis; }

    /* Mode badges — match the in-app pill colors */
    .badge { display: inline-block; padding: 2px 6px; border-radius: 9999px; font-size: 9px; font-weight: 600; white-space: nowrap; }
    .badge-blind { background: #dbeafe; color: #1d4ed8; }
    .badge-csv   { background: #fef3c7; color: #b45309; }
    .badge-aio   { background: #d1fae5; color: #047857; }
    .badge-sub   { background: #ede9fe; color: #6d28d9; }
    .badge-default { background: #f1f5f9; color: #475569; }

    /* Mode-comparison reference table */
    .modes { margin-top: 22px; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; background: #f8fafc; page-break-inside: avoid; }
    .modes h2 { margin-top: 0; }
    .modes p.intro { font-size: 10px; color: #475569; margin-bottom: 10px; line-height: 1.5; }
    table.modes-table { font-size: 10px; border: 1px solid #e2e8f0; }
    table.modes-table thead tr { background: #0f3460 !important; }
    table.modes-table tbody td { padding: 8px; vertical-align: top; line-height: 1.45; }
    table.modes-table tbody tr:nth-child(odd)  { background: #ffffff; }
    table.modes-table tbody tr:nth-child(even) { background: #f1f5f9; }
    .modes .legend { font-size: 9px; color: #64748b; margin-top: 8px; line-height: 1.5; }
    .pill { display: inline-block; padding: 1px 6px; border-radius: 9999px; font-weight: 700; font-size: 9px; }
    .pill-blind { background: #dbeafe; color: #1d4ed8; }
    .pill-csv   { background: #fef3c7; color: #b45309; }
    .pill-aio   { background: #d1fae5; color: #047857; }
    .pill-sub   { background: #ede9fe; color: #6d28d9; }

    @media print {
      body { padding: 16px; }
      thead { display: table-header-group; }
      tr, .modes, .summary .card { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <h1>ChatAIO Search Stats</h1>
  <div class="subtitle">${esc(new Date().toLocaleString())} · ${visible.length} of ${stats.length} record${stats.length === 1 ? "" : "s"} (filter: ${esc(filterLabel)})</div>
  <div class="summary">
    <div class="card"><div class="num">${totalSearches}</div><div class="lbl">Total</div></div>
    <div class="card"><div class="num">${byMode.Send ?? 0}</div><div class="lbl">Blind Dump</div></div>
    <div class="card"><div class="num">${byMode.PureLLM ?? 0}</div><div class="lbl">CSV→LLM</div></div>
    <div class="card"><div class="num">${byMode.AIOSearch ?? 0}</div><div class="lbl">AIO Search</div></div>
    <div class="card"><div class="num">${byMode.Substrate ?? 0}</div><div class="lbl">Substrate</div></div>
    <div class="card"><div class="num">${totalTokens.toLocaleString()}</div><div class="lbl">Tokens</div></div>
    <div class="card"><div class="num">${(avgElapsed / 1000).toFixed(1)}s</div><div class="lbl">Avg Time</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Time</th><th>Mode</th><th>Query</th>
        <th class="num">⏱ ms</th><th class="num">In</th><th class="num">Out</th><th class="num">Σ Tok</th>
        <th class="num">HSLs</th><th class="num">AIOs</th><th class="num">Cues</th><th class="center">MRO</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || `<tr><td colspan="11" style="padding:16px;text-align:center;color:#94a3b8;">No records</td></tr>`}</tbody>
  </table>

  <div class="modes">
    <h2>How the four search modes differ</h2>
    <p class="intro">All four modes call the same model — <code>claude-sonnet-4-6</code>, <code>max_tokens=2048</code>. What changes is the <em>corpus selection strategy</em> upstream of the LLM. None of these is "raw Claude"; each injects a system prompt with different context.</p>
    <table class="modes-table" style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="color:#fff;">
          <th style="padding:6px 8px;text-align:left;width:170px;">Mode</th>
          <th style="padding:6px 8px;text-align:left;width:230px;">Retrieval algorithm</th>
          <th style="padding:6px 8px;text-align:left;">Context sent to Claude</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="pill pill-csv">CSV→LLM Raw</span></td>
          <td>None — control case</td>
          <td>Up to 50 raw saved CSV files (capped ~30 KB each). No AIO bracket notation, no HSL, no MRO. Vanilla "you are a data analyst" system prompt.</td>
        </tr>
        <tr>
          <td><span class="pill pill-blind">Blind Dump AIO/HSL</span></td>
          <td>None — blind dump</td>
          <td>First 300 AIOs + 10 HSLs from the DB (no relevance filtering). ChatAIO system preamble instructing Claude to parse <code>[Key.Value]</code> notation, group/sum/count, show work.</td>
        </tr>
        <tr>
          <td><span class="pill pill-aio">AIO Search</span></td>
          <td>4-phase: parse → HSL match → AIO gather → synthesize</td>
          <td>Only the AIOs reached via HSL traversal of cues extracted from the query. Falls back to direct ILIKE if no HSL matches.</td>
        </tr>
        <tr>
          <td><span class="pill pill-sub">Substrate</span></td>
          <td>Deterministic cue extraction + Jaccard ranking</td>
          <td>Pre-assembled tiered bundle: cues → neighborhood AIOs → MRO priors. Self-improving (each query persists a new MRO).</td>
        </tr>
      </tbody>
    </table>
    <p class="legend">
      <strong>Blind Dump AIO/HSL</strong> is the cheapest to implement but the most token-wasteful — it ships ~300 unrelated records every query.
      <strong>CSV→LLM Raw</strong> is the apples-to-apples baseline against vanilla Claude — same data, no Information-Physics machinery.
      <strong>AIO Search</strong> and <strong>Substrate</strong> are where the substrate earns its keep: bounded retrieval, real provenance, and (for Substrate) episodic memory across sessions.
    </p>
  </div>
</body>
</html>`
  }, [visible, stats.length, filter, totalSearches, byMode, totalTokens, avgElapsed])

  // Print via a hidden, same-origin iframe — no pop-up window required.
  // Browsers block window.open without a hardened user gesture; an iframe
  // mounted into the current document avoids that path entirely.
  const printViaHiddenIframe = useCallback((html: string) => {
    const iframe = document.createElement("iframe")
    iframe.setAttribute("aria-hidden", "true")
    // Off-screen but rendered (display:none can suppress print in some browsers).
    iframe.style.cssText =
      "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;"
    document.body.appendChild(iframe)

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      // Defer removal so Chrome/Edge finish flushing the print job before
      // the iframe disappears. afterprint can fire before the dialog closes.
      setTimeout(() => { try { iframe.remove() } catch {} }, 1000)
    }

    const triggerPrint = () => {
      try {
        const win = iframe.contentWindow
        if (!win) { cleanup(); toast.error("Print failed: iframe unavailable."); return }
        // Listen for the user closing the print dialog so we can clean up.
        win.addEventListener("afterprint", cleanup, { once: true })
        // Safety net: some browsers (Safari, headless flows) never emit
        // afterprint, which would leak the iframe in the DOM forever.
        // 60s is well past any reasonable print-dialog interaction.
        setTimeout(cleanup, 60_000)
        win.focus()
        win.print()
      } catch (e) {
        cleanup()
        toast.error("Print failed: " + String(e))
      }
    }

    // Write the HTML and wait until layout is done before printing.
    // Using srcdoc + onload is the most reliable cross-browser path.
    iframe.onload = () => triggerPrint()
    iframe.srcdoc = html
  }, [])

  const handlePrint = useCallback(() => {
    printViaHiddenIframe(buildPrintableHtml())
  }, [buildPrintableHtml, printViaHiddenIframe])

  // PDF button: open an in-app preview window. The user can review the
  // formatted document, then click Save (which routes to the browser's
  // "Save as PDF" via the print pipeline) or Back to dismiss.
  const handleOpenPdfPreview = useCallback(() => {
    setPdfPreviewHtml(buildPrintableHtml())
  }, [buildPrintableHtml])

  // Triggered from inside the preview dialog. We print the iframe that's
  // already rendered (no second HTML build), so users see exactly what they
  // previewed in the resulting PDF.
  const handleSaveFromPreview = useCallback(() => {
    const frame = document.getElementById("pdf-preview-frame") as HTMLIFrameElement | null
    const win = frame?.contentWindow
    if (!win) {
      toast.error("Preview not ready yet — please retry.")
      return
    }
    try {
      toast.info("In the print dialog, choose 'Save as PDF' as the destination.")
      win.focus()
      win.print()
    } catch (e) {
      toast.error("Save failed: " + String(e))
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total Searches", value: totalSearches },
          { label: "Blind Dump AIO/HSL", value: byMode.Send ?? 0 },
          { label: "CSV→LLM Raw", value: byMode.PureLLM ?? 0 },
          { label: "AIO Search", value: byMode.AIOSearch ?? 0 },
          { label: "Substrate", value: byMode.Substrate ?? 0 },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
            <div className="text-2xl font-bold text-foreground">{card.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{card.label}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-foreground">{totalTokens.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Total Tokens Used</div>
        </div>
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-center">
          <div className="text-2xl font-bold text-foreground">{(avgElapsed / 1000).toFixed(1)}s</div>
          <div className="text-xs text-muted-foreground mt-0.5">Avg Response Time</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["All", "Send", "PureLLM", "AIOSearch", "Substrate"] as const).map((m) => (
          <button key={m} onClick={() => setFilter(m)}
            className={`text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${filter === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:text-foreground"}`}>
            {m === "AIOSearch" ? "AIO Search" : m === "Send" ? "Blind Dump AIO/HSL" : m === "PureLLM" ? "CSV→LLM Raw" : m}
          </button>
        ))}
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={handleOpenPdfPreview} disabled={loading || visible.length === 0} className="gap-1.5">
          <FileText className="w-3.5 h-3.5" />PDF
        </Button>
        <Button size="sm" variant="outline" onClick={handlePrint} disabled={loading || visible.length === 0} className="gap-1.5">
          <Printer className="w-3.5 h-3.5" />Print
        </Button>
        <Button size="sm" variant="outline" onClick={load} disabled={loading} className="gap-1.5">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />Refresh
        </Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">No search stats yet. Run a ChatAIO query to start recording.</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-[#0f3460] text-white">
                  <th className="px-3 py-2 text-left font-semibold">Time</th>
                  <th className="px-3 py-2 text-left font-semibold">Mode</th>
                  <th className="px-3 py-2 text-left font-semibold">Query</th>
                  <th className="px-3 py-2 text-right font-semibold">⏱ ms</th>
                  <th className="px-3 py-2 text-right font-semibold">📥 In</th>
                  <th className="px-3 py-2 text-right font-semibold">📤 Out</th>
                  <th className="px-3 py-2 text-right font-semibold">Σ Tok</th>
                  <th className="px-3 py-2 text-right font-semibold">HSLs</th>
                  <th className="px-3 py-2 text-right font-semibold">AIOs</th>
                  <th className="px-3 py-2 text-right font-semibold">Cues</th>
                  <th className="px-3 py-2 text-right font-semibold">MRO</th>
                  <th className="px-3 py-2 text-center font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s, i) => (
                  <>
                    <tr key={s.stat_id}
                      className={`border-b border-border cursor-pointer hover:bg-muted/50 transition-colors ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                      onClick={() => setExpanded(expanded === s.stat_id ? null : s.stat_id)}>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {new Date(s.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-3 py-2">{modeBadge(s.search_mode)}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate" title={s.query_text}>{s.query_text}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.elapsed_ms.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.input_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.output_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{s.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.matched_hsls || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.matched_aios || s.neighborhood_size || "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{s.cue_count || "—"}</td>
                      <td className="px-3 py-2 text-center">
                        {s.mro_saved ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleViewMro(s.stat_id) }}
                            disabled={mroLoading === s.stat_id}
                            className="text-emerald-600 hover:text-emerald-800 hover:underline font-medium disabled:opacity-50"
                            title="View saved MRO (read-only)"
                          >
                            {mroLoading === s.stat_id ? "…" : "✅"}
                          </button>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(s.stat_id) }}
                          className="text-muted-foreground hover:text-destructive transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                    {expanded === s.stat_id && (
                      <tr key={`${s.stat_id}-exp`} className="bg-blue-50 dark:bg-blue-950/20">
                        <td colSpan={12} className="px-4 py-3">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Query</div>
                            <div className="text-sm text-foreground">{s.query_text}</div>
                            {s.result_preview && (
                              <>
                                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Result Preview</div>
                                <div className="text-sm text-foreground whitespace-pre-wrap bg-background rounded p-2 border border-border">{s.result_preview}</div>
                              </>
                            )}
                            <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                              <span>⏱ {(s.elapsed_ms / 1000).toFixed(2)}s</span>
                              <span>📥 {s.input_tokens.toLocaleString()} input tokens</span>
                              <span>📤 {s.output_tokens.toLocaleString()} output tokens</span>
                              <span>Total: {s.total_tokens.toLocaleString()} tokens</span>
                              {s.matched_hsls > 0 && <span>HSLs matched: {s.matched_hsls}</span>}
                              {s.matched_aios > 0 && <span>AIOs matched: {s.matched_aios}</span>}
                              {s.cue_count > 0 && <span>Cues: {s.cue_count}</span>}
                              {s.neighborhood_size > 0 && <span>Neighborhood: {s.neighborhood_size}</span>}
                              {s.prior_count > 0 && <span>Priors: {s.prior_count}</span>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mode comparison reference */}
      <div className="rounded-lg border border-border bg-muted/20 p-5 space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">How the four search modes differ</h3>
          <p className="text-xs text-muted-foreground mt-1">
            All four modes call the same model — <code className="bg-muted px-1 rounded">claude-sonnet-4-6</code>, <code className="bg-muted px-1 rounded">max_tokens=2048</code>.
            What changes is the <em>corpus selection strategy</em> upstream of the LLM. None of these is &quot;raw Claude&quot;; each injects a system prompt with different context.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border border-border">
            <thead>
              <tr className="bg-[#0f3460] text-white">
                <th className="px-3 py-2 text-left font-semibold">Mode</th>
                <th className="px-3 py-2 text-left font-semibold">Retrieval</th>
                <th className="px-3 py-2 text-left font-semibold">Context sent to Claude</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border bg-background">
                <td className="px-3 py-2 align-top"><span className="font-semibold text-amber-700">CSV→LLM Raw</span></td>
                <td className="px-3 py-2 align-top">None — control case</td>
                <td className="px-3 py-2 align-top">Up to 50 raw saved CSV files (capped ~30 KB each). No AIO bracket notation, no HSL, no MRO. Vanilla &quot;you are a data analyst&quot; system prompt.</td>
              </tr>
              <tr className="border-b border-border bg-muted/20">
                <td className="px-3 py-2 align-top"><span className="font-semibold text-blue-700">Blind Dump AIO/HSL</span></td>
                <td className="px-3 py-2 align-top">None — blind dump</td>
                <td className="px-3 py-2 align-top">First 300 AIOs + 10 HSLs from the DB (no relevance filtering). ChatAIO system preamble instructing Claude to parse <code className="bg-muted px-1 rounded">[Key.Value]</code> notation, group/sum/count, show work.</td>
              </tr>
              <tr className="border-b border-border bg-background">
                <td className="px-3 py-2 align-top"><span className="font-semibold text-green-700">AIO Search</span></td>
                <td className="px-3 py-2 align-top">4-phase: parse → HSL match → AIO gather → synthesize</td>
                <td className="px-3 py-2 align-top">Only the AIOs reached via HSL traversal of cues extracted from the query. Falls back to direct ILIKE if no HSL matches.</td>
              </tr>
              <tr className="bg-muted/20">
                <td className="px-3 py-2 align-top"><span className="font-semibold text-purple-700">Substrate</span></td>
                <td className="px-3 py-2 align-top">Deterministic cue extraction + Jaccard ranking</td>
                <td className="px-3 py-2 align-top">Pre-assembled tiered bundle: cues → neighborhood AIOs → MRO priors. Self-improving (each query persists a new MRO).</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          <strong>Blind Dump AIO/HSL</strong> is the cheapest to implement but the most token-wasteful — it ships ~300 unrelated records every query.
          <strong> CSV→LLM Raw</strong> is the apples-to-apples baseline against vanilla Claude — same data, no Information-Physics machinery.
          <strong> AIO Search</strong> and <strong>Substrate</strong> are where the substrate earns its keep: bounded retrieval, real provenance, and (for Substrate) episodic memory across sessions.
        </p>
      </div>

      {/* PDF preview dialog — shown when the user clicks the PDF button.
          Renders the same printable HTML inside a sandboxed iframe so the
          user sees exactly what will be saved, with Save / Back actions. */}
      <Dialog open={pdfPreviewHtml !== null} onOpenChange={(o) => { if (!o) setPdfPreviewHtml(null) }}>
        <DialogContent className="max-w-5xl w-[95vw] h-[90vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-5 py-3 border-b border-border">
            <DialogTitle>PDF Preview — Search Stats</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-muted/30">
            {pdfPreviewHtml && (
              <iframe
                id="pdf-preview-frame"
                title="Search Stats PDF Preview"
                srcDoc={pdfPreviewHtml}
                className="w-full h-full border-0 bg-white"
              />
            )}
          </div>
          <DialogFooter className="px-5 py-3 border-t border-border gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setPdfPreviewHtml(null)}>
              Back
            </Button>
            <Button onClick={handleSaveFromPreview} className="gap-1.5">
              <FileText className="w-4 h-4" />Save as PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MRO view-only popup — shown when user clicks the ✅ in the MRO column. */}
      <Dialog open={mroPopup !== null} onOpenChange={(o) => { if (!o) setMroPopup(null) }}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Memory Result Object (MRO) — view only</DialogTitle>
          </DialogHeader>
          {mroPopup && (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">MRO Key</div>
                  <div className="font-mono text-xs break-all">{mroPopup.mro_key ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">MRO ID</div>
                  <div className="font-mono text-xs break-all">{mroPopup.mro_id}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Confidence</div>
                  <div>{mroPopup.confidence ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Trust Score</div>
                  <div>{mroPopup.trust_score?.toFixed(3) ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Matched AIOs</div>
                  <div>{mroPopup.matched_aios_count ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Model Used</div>
                  <div>{mroPopup.model_used ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Derivation Method</div>
                  <div>{mroPopup.derivation_method ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Created</div>
                  <div className="text-xs">{new Date(mroPopup.created_at).toLocaleString()}</div>
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Query</div>
                <div className="bg-muted/40 rounded p-2 border border-border">{mroPopup.query_text ?? "—"}</div>
              </div>

              {mroPopup.intent && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Intent</div>
                  <div className="bg-muted/40 rounded p-2 border border-border">{mroPopup.intent}</div>
                </div>
              )}

              <div>
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Result</div>
                <div className="bg-muted/40 rounded p-2 border border-border whitespace-pre-wrap">{mroPopup.result_text ?? "—"}</div>
              </div>

              {mroPopup.search_terms != null && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Search Terms</div>
                  <pre className="bg-muted/40 rounded p-2 border border-border text-xs overflow-x-auto">{JSON.stringify(mroPopup.search_terms, null, 2)}</pre>
                </div>
              )}

              {mroPopup.seed_hsls != null && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Seed HSLs</div>
                  <pre className="bg-muted/40 rounded p-2 border border-border text-xs overflow-x-auto">{JSON.stringify(mroPopup.seed_hsls, null, 2)}</pre>
                </div>
              )}

              {mroPopup.parent_mro_ids != null && Array.isArray(mroPopup.parent_mro_ids) && (mroPopup.parent_mro_ids as unknown[]).length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Parent MRO IDs</div>
                  <pre className="bg-muted/40 rounded p-2 border border-border text-xs overflow-x-auto">{JSON.stringify(mroPopup.parent_mro_ids, null, 2)}</pre>
                </div>
              )}

              {mroPopup.context_bundle != null && (
                <div>
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Context Bundle</div>
                  <pre className="bg-muted/40 rounded p-2 border border-border text-xs overflow-x-auto max-h-64">{JSON.stringify(mroPopup.context_bundle, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMroPopup(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Architecture Pane ─────────────────────────────────────────────

function ArchitecturePane() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Complete InformationPhysics.ai AIO / HSL / MRO architecture — data ingestion through recursive episodic memory.</p>
      <div className="overflow-auto border border-border rounded-lg bg-gradient-to-b from-slate-50 to-slate-100 p-4">
        <svg viewBox="0 0 1400 1000" className="w-full min-w-[900px]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ag-navy" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#0F3460"/><stop offset="100%" stopColor="#1A5276"/></linearGradient>
            <linearGradient id="ag-aio" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#DBEAFE"/><stop offset="100%" stopColor="#BFDBFE"/></linearGradient>
            <linearGradient id="ag-hsl" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#D1FAE5"/><stop offset="100%" stopColor="#A7F3D0"/></linearGradient>
            <linearGradient id="ag-mro" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#EDE9FE"/><stop offset="100%" stopColor="#DDD6FE"/></linearGradient>
            <linearGradient id="ag-chat" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FCE7F3"/><stop offset="100%" stopColor="#FBCFE8"/></linearGradient>
            <linearGradient id="ag-csv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FFEDD5"/><stop offset="100%" stopColor="#FED7AA"/></linearGradient>
            <linearGradient id="ag-src" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FEF3C7"/><stop offset="100%" stopColor="#FDE68A"/></linearGradient>
            <linearGradient id="ag-db" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#E0E7FF"/><stop offset="100%" stopColor="#C7D2FE"/></linearGradient>
            <linearGradient id="ag-sko" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FEF9C3"/><stop offset="100%" stopColor="#FEF08A"/></linearGradient>
            <marker id="ag-a1" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/></marker>
            <marker id="ag-a2" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#059669"/></marker>
            <marker id="ag-a3" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#DB2777"/></marker>
            <marker id="ag-a4" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#7C3AED"/></marker>
            <marker id="ag-a5" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#DC2626"/></marker>
          </defs>

          {/* Title */}
          <rect width="1400" height="56" fill="url(#ag-navy)"/>
          <text x="700" y="28" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="22" fontWeight="bold" fill="white">InformationPhysics.ai — Complete AIO / HSL / MRO Architecture</text>
          <text x="700" y="48" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="12" fill="#93C5FD">Data Ingestion → Observation Preservation → Relational Topology → Intelligent Retrieval → Episodic Memory</text>

          {/* Column labels */}
          <text x="120" y="82" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="#92400E" letterSpacing="2">DATA SOURCES</text>
          <text x="380" y="82" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="#1E40AF" letterSpacing="2">LAYER 1: OBSERVATION</text>
          <text x="650" y="82" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="#065F46" letterSpacing="2">RELATIONAL TOPOLOGY</text>
          <text x="930" y="82" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="#9D174D" letterSpacing="2">INTELLIGENT RETRIEVAL</text>
          <text x="1210" y="82" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="#5B21B6" letterSpacing="2">LAYER 2: RECOLLECTION</text>

          {/* CSV Source */}
          <rect x="30" y="95" width="180" height="75" rx="8" fill="url(#ag-csv)" stroke="#EA580C" strokeWidth="1.5"/>
          <text x="120" y="118" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="bold" fill="#9A3412">CSV Files</text>
          <text x="120" y="136" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fill="#78350F">Tabular data</text>
          <text x="120" y="150" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fill="#78350F">Headers + Rows</text>
          <text x="120" y="163" textAnchor="middle" fontFamily="Courier New,monospace" fontSize="9" fill="#9A3412">parseCSV() → csvToAio()</text>

          {/* PDF Source */}
          <rect x="30" y="180" width="180" height="75" rx="8" fill="url(#ag-src)" stroke="#D97706" strokeWidth="1.5"/>
          <text x="120" y="203" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="bold" fill="#92400E">PDF Documents</text>
          <text x="120" y="221" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fill="#78350F">Invoices, reports</text>
          <text x="120" y="235" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fill="#78350F">Claude AI extraction</text>
          <text x="120" y="248" textAnchor="middle" fontFamily="Courier New,monospace" fontSize="9" fill="#92400E">/v1/op/pdf-extract</text>

          {/* Future Sources */}
          <rect x="30" y="265" width="180" height="50" rx="8" fill="#F1F5F9" stroke="#94A3B8" strokeWidth="1" strokeDasharray="5,3"/>
          <text x="120" y="288" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fill="#94A3B8">APIs, DBs, Streams...</text>
          <text x="120" y="303" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#94A3B8">(future sources)</text>

          {/* Arrow Sources → AIO */}
          <line x1="210" y1="175" x2="270" y2="175" stroke="#475569" strokeWidth="2" markerEnd="url(#ag-a1)"/>
          <text x="240" y="168" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#64748B">ingest</text>

          {/* AIO Engine */}
          <rect x="275" y="95" width="210" height="220" rx="10" fill="url(#ag-aio)" stroke="#2563EB" strokeWidth="2"/>
          <rect x="275" y="95" width="210" height="32" rx="10" fill="#2563EB"/><rect x="275" y="117" width="210" height="10" fill="#2563EB"/>
          <text x="380" y="116" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="bold" fill="white">AIO Engine</text>
          <rect x="288" y="138" width="184" height="36" rx="5" fill="white" stroke="#93C5FD" strokeWidth="1"/>
          <text x="380" y="153" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#1E40AF">Measurement Act</text>
          <text x="380" y="166" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Row → bracket notation</text>
          <rect x="288" y="180" width="184" height="36" rx="5" fill="white" stroke="#93C5FD" strokeWidth="1"/>
          <text x="380" y="195" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#1E40AF">AIO Object</text>
          <text x="380" y="208" textAnchor="middle" fontFamily="Courier New,monospace" fontSize="8" fill="#475569">[FieldName.Value][Field2.Val2]</text>
          <rect x="288" y="222" width="184" height="36" rx="5" fill="white" stroke="#93C5FD" strokeWidth="1"/>
          <text x="380" y="237" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#1E40AF">Element Index</text>
          <text x="380" y="250" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">information_elements table</text>
          <rect x="288" y="264" width="184" height="36" rx="5" fill="white" stroke="#93C5FD" strokeWidth="1"/>
          <text x="380" y="279" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#1E40AF">Deduplication</text>
          <text x="380" y="292" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">CSV fingerprint check</text>

          {/* Arrow AIO → HSL */}
          <line x1="485" y1="200" x2="535" y2="200" stroke="#059669" strokeWidth="2" markerEnd="url(#ag-a2)"/>
          <text x="510" y="193" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#059669">link</text>

          {/* HSL Fabric */}
          <rect x="540" y="95" width="220" height="220" rx="10" fill="url(#ag-hsl)" stroke="#059669" strokeWidth="2"/>
          <rect x="540" y="95" width="220" height="32" rx="10" fill="#059669"/><rect x="540" y="117" width="220" height="10" fill="#059669"/>
          <text x="650" y="116" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="bold" fill="white">HSL Fabric</text>
          <rect x="553" y="138" width="194" height="36" rx="5" fill="white" stroke="#6EE7B7" strokeWidth="1"/>
          <text x="650" y="153" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#065F46">Single-Element HSL</text>
          <text x="650" y="166" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">One entity → linked AIOs</text>
          <rect x="553" y="180" width="194" height="36" rx="5" fill="white" stroke="#6EE7B7" strokeWidth="1"/>
          <text x="650" y="195" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#065F46">Compound HSL</text>
          <text x="650" y="208" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">AND-logic multi-element</text>
          <rect x="553" y="222" width="194" height="36" rx="5" fill="white" stroke="#6EE7B7" strokeWidth="1"/>
          <text x="650" y="237" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#065F46">Semantic Strings</text>
          <text x="650" y="250" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">100 element columns</text>
          <rect x="553" y="264" width="194" height="36" rx="5" fill="white" stroke="#6EE7B7" strokeWidth="1"/>
          <text x="650" y="279" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#065F46">AIO References</text>
          <text x="650" y="292" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Pointers to constituent AIOs</text>

          {/* Arrow HSL → ChatAIO */}
          <line x1="760" y1="200" x2="790" y2="200" stroke="#DB2777" strokeWidth="2" markerEnd="url(#ag-a3)"/>

          {/* ChatAIO */}
          <rect x="790" y="95" width="280" height="220" rx="10" fill="url(#ag-chat)" stroke="#DB2777" strokeWidth="2"/>
          <rect x="790" y="95" width="280" height="32" rx="10" fill="#DB2777"/><rect x="790" y="117" width="280" height="10" fill="#DB2777"/>
          <text x="930" y="116" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="bold" fill="white">ChatAIO — AI Retrieval</text>
          <rect x="803" y="136" width="124" height="60" rx="5" fill="white" stroke="#F9A8D4" strokeWidth="1"/>
          <text x="865" y="152" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#9D174D">Send (Broad)</text>
          <text x="865" y="166" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#475569">All AIOs + HSLs</text>
          <text x="865" y="178" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#475569">1 LLM call</text>
          <rect x="933" y="136" width="124" height="60" rx="5" fill="white" stroke="#F9A8D4" strokeWidth="1"/>
          <text x="995" y="152" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#9D174D">AIO Search</text>
          <text x="995" y="166" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#475569">4-phase algebra</text>
          <text x="995" y="178" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#475569">φ → σ → π → Ψ</text>
          <rect x="803" y="202" width="254" height="18" rx="3" fill="#FDF2F8"/>
          <text x="808" y="214" fontFamily="Courier New,monospace" fontSize="8" fill="#9D174D">φ Parse → σ Match HSLs → π Gather AIOs → Ψ Answer</text>
          <rect x="803" y="226" width="80" height="24" rx="4" fill="#FDF2F8" stroke="#F9A8D4" strokeWidth="1"/>
          <text x="843" y="242" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#9D174D">PDF</text>
          <rect x="889" y="226" width="80" height="24" rx="4" fill="#FDF2F8" stroke="#F9A8D4" strokeWidth="1"/>
          <text x="929" y="242" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#9D174D">Prompts</text>
          <rect x="975" y="226" width="80" height="24" rx="4" fill="#FDF2F8" stroke="#F9A8D4" strokeWidth="1"/>
          <text x="1015" y="242" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#9D174D">Markdown</text>
          <rect x="803" y="258" width="254" height="44" rx="5" fill="white" stroke="#F9A8D4" strokeWidth="1"/>
          <text x="930" y="275" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fontWeight="bold" fill="#9D174D">Claude AI (claude-sonnet-4-6)</text>
          <text x="930" y="292" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Evidence-grounded synthesis</text>

          {/* Arrow ChatAIO → MRO */}
          <line x1="1070" y1="175" x2="1100" y2="175" stroke="#7C3AED" strokeWidth="2" markerEnd="url(#ag-a4)"/>
          <text x="1085" y="168" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#7C3AED">save</text>

          {/* MRO */}
          <rect x="1100" y="95" width="270" height="155" rx="10" fill="url(#ag-mro)" stroke="#7C3AED" strokeWidth="2"/>
          <rect x="1100" y="95" width="270" height="32" rx="10" fill="#7C3AED"/><rect x="1100" y="117" width="270" height="10" fill="#7C3AED"/>
          <text x="1235" y="116" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="13" fontWeight="bold" fill="white">Memory Result Objects</text>
          <rect x="1113" y="138" width="244" height="28" rx="5" fill="white" stroke="#C4B5FD" strokeWidth="1"/>
          <text x="1235" y="156" textAnchor="middle" fontFamily="Cambria Math,serif" fontSize="12" fontStyle="italic" fill="#5B21B6">MRO = ⟨ Q, S, C, O, R, P, L ⟩</text>
          <rect x="1113" y="172" width="118" height="28" rx="5" fill="white" stroke="#C4B5FD" strokeWidth="1"/>
          <text x="1172" y="190" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#5B21B6">Save MRO</text>
          <rect x="1237" y="172" width="118" height="28" rx="5" fill="white" stroke="#C4B5FD" strokeWidth="1"/>
          <text x="1296" y="190" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#5B21B6">View MROs</text>
          <rect x="1113" y="206" width="244" height="28" rx="5" fill="white" stroke="#C4B5FD" strokeWidth="1"/>
          <text x="1235" y="224" textAnchor="middle" fontFamily="Courier New,monospace" fontSize="8" fill="#5B21B6">[MROKey.HSL-n-AIO-m][Query.text]</text>

          {/* SKO Future */}
          <rect x="1100" y="265" width="270" height="50" rx="8" fill="url(#ag-sko)" stroke="#CA8A04" strokeWidth="1.5" strokeDasharray="5,3"/>
          <text x="1235" y="286" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="#854D0E">Layer 3: SKOs (Future)</text>
          <text x="1235" y="303" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#92400E">Governed promotion from MRO convergence</text>
          <line x1="1235" y1="250" x2="1235" y2="265" stroke="#CA8A04" strokeWidth="1.5" strokeDasharray="4,3"/>

          {/* Database Layer */}
          <rect x="30" y="345" width="1340" height="105" rx="12" fill="url(#ag-db)" stroke="#6366F1" strokeWidth="2"/>
          <rect x="30" y="345" width="1340" height="30" rx="12" fill="#4F46E5"/><rect x="30" y="367" width="1340" height="8" fill="#4F46E5"/>
          <text x="700" y="365" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="14" fontWeight="bold" fill="white">PostgreSQL — Persistent Storage Layer</text>
          {[["aio_data","50 elem cols","PRIMARY",50],["hsl_data","100 elem cols","RELATIONAL",215],["mro_objects","query + result","EPISODIC",380],["info_elements","field + count","INDEX",545],["info_objects","IO registry","REGISTRY",710],["saved_prompts","prompt text","USER",875],["users/roles","auth + RLS","SECURITY",1040],["settings","API keys","CONFIG",1205]].map(([name,desc,label,x],i) => (
            <g key={i}>
              <rect x={x} y="385" width="155" height="55" rx="6" fill="white" stroke="#A5B4FC" strokeWidth="1"/>
              <text x={x+78} y="403" textAnchor="middle" fontFamily="Courier New,monospace" fontSize="9" fontWeight="bold" fill="#4338CA">{name}</text>
              <text x={x+78} y="418" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#475569">{desc}</text>
              <text x={x+78} y="432" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="7" fill="#6366F1">{label}</text>
            </g>
          ))}

          {/* API Layer */}
          <rect x="30" y="470" width="1340" height="55" rx="10" fill="#FFF7ED" stroke="#EA580C" strokeWidth="1.5"/>
          <rect x="30" y="470" width="1340" height="24" rx="10" fill="#EA580C"/>
          <text x="700" y="488" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="12" fontWeight="bold" fill="white">FastAPI Backend — RESTful API Layer</text>
          <text x="700" y="515" textAnchor="middle" fontFamily="Courier New,monospace" fontSize="9" fill="#9A3412">/v1/io  /v1/aio-data  /v1/hsl-data  /v1/mro-objects  /v1/op/chat  /v1/op/aio-search  /v1/op/pdf-extract  /v1/info-elements  /v1/saved-prompts</text>

          {/* Frontend Layer */}
          <rect x="30" y="540" width="1340" height="55" rx="10" fill="#F0FDF4" stroke="#16A34A" strokeWidth="1.5"/>
          <rect x="30" y="540" width="1340" height="24" rx="10" fill="#16A34A"/>
          <text x="700" y="558" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="12" fontWeight="bold" fill="white">Next.js 16 Frontend — React 19 + Radix UI + Tailwind CSS</text>
          <text x="700" y="585" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="10" fill="#166534">Home • Converter • HSL Builder • ChatAIO • R&D • System Admin • User Guide • Workflow • Papers • PDF Import</text>

          {/* Deploy Layer */}
          <rect x="30" y="610" width="1340" height="35" rx="8" fill="#1E293B"/>
          <text x="700" y="632" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="11" fontWeight="bold" fill="white">Railway Deployment — GitHub CI/CD — msbodner/information-physics-demo-system</text>

          {/* Recursive loop */}
          <path d="M 1370 175 Q 1390 175 1390 450 Q 1390 660 700 660 Q 30 660 30 450 Q 30 175 120 175" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeDasharray="8,4" markerEnd="url(#ag-a5)"/>
          <rect x="1345" y="390" width="50" height="50" rx="5" fill="#FEE2E2" stroke="#DC2626" strokeWidth="1"/>
          <text x="1370" y="408" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fontWeight="bold" fill="#DC2626">Recursive</text>
          <text x="1370" y="420" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#DC2626">Memory</text>
          <text x="1370" y="432" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="8" fill="#DC2626">Loop</text>

          {/* Legend */}
          <rect x="30" y="660" width="1340" height="90" rx="8" fill="white" stroke="#CBD5E1" strokeWidth="1"/>
          <text x="700" y="680" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="12" fontWeight="bold" fill="#0F3460">Architecture Legend</text>
          <rect x="50" y="693" width="14" height="14" rx="2" fill="#DBEAFE" stroke="#2563EB" strokeWidth="1.5"/><text x="70" y="704" fontFamily="Arial,sans-serif" fontSize="10" fill="#1E3A5F" fontWeight="bold">AIOs</text><text x="100" y="704" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Primary observation objects</text>
          <rect x="280" y="693" width="14" height="14" rx="2" fill="#D1FAE5" stroke="#059669" strokeWidth="1.5"/><text x="300" y="704" fontFamily="Arial,sans-serif" fontSize="10" fill="#065F46" fontWeight="bold">HSL</text><text x="325" y="704" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Relational topology</text>
          <rect x="480" y="693" width="14" height="14" rx="2" fill="#EDE9FE" stroke="#7C3AED" strokeWidth="1.5"/><text x="500" y="704" fontFamily="Arial,sans-serif" fontSize="10" fill="#5B21B6" fontWeight="bold">MROs</text><text x="535" y="704" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Episodic memory objects</text>
          <rect x="700" y="693" width="14" height="14" rx="2" fill="#FCE7F3" stroke="#DB2777" strokeWidth="1.5"/><text x="720" y="704" fontFamily="Arial,sans-serif" fontSize="10" fill="#9D174D" fontWeight="bold">ChatAIO</text><text x="770" y="704" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">AI retrieval engine</text>
          <rect x="920" y="693" width="14" height="14" rx="2" fill="#FEF9C3" stroke="#CA8A04" strokeWidth="1.5" strokeDasharray="3,2"/><text x="940" y="704" fontFamily="Arial,sans-serif" fontSize="10" fill="#854D0E" fontWeight="bold">SKOs</text><text x="970" y="704" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">Future abstractions</text>
          <line x1="1100" y1="700" x2="1130" y2="700" stroke="#DC2626" strokeWidth="2.5" strokeDasharray="5,3"/><text x="1140" y="704" fontFamily="Arial,sans-serif" fontSize="10" fill="#DC2626" fontWeight="bold">Recursive Loop</text><text x="1240" y="704" fontFamily="Arial,sans-serif" fontSize="9" fill="#475569">MROs feed back</text>

          <text x="700" y="740" textAnchor="middle" fontFamily="Arial,sans-serif" fontSize="9" fill="#94A3B8">© 2026 InformationPhysics.ai, LLC — Michael Simon Bodner, Ph.D. — AIO/HSL/MRO Demo System V4.3</text>
        </svg>
      </div>
    </div>
  )
}

// ── System Management Page ─────────────────────────────────────────

interface SystemManagementProps {
  onBack: () => void
  onNavigate?: (view: string) => void
}

const SESSION_KEY = "ipx.sysadmin.session"

export function SystemManagement({ onBack, onNavigate }: SystemManagementProps) {
  // Restore session from sessionStorage (survives reloads within the tab, cleared on tab close)
  const [authedUser, setAuthedUser] = useState<LoginResult | null>(() => {
    if (typeof window === "undefined") return null
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY)
      if (!raw) return null
      const parsed = JSON.parse(raw) as LoginResult
      return isAdmin(parsed.role) ? parsed : null
    } catch { return null }
  })

  const handleLogin = useCallback((user: LoginResult) => {
    try { window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(user)) } catch {}
    setAuthedUser(user)
  }, [])

  const handleLogout = useCallback(() => {
    try { window.sessionStorage.removeItem(SESSION_KEY) } catch {}
    setAuthedUser(null)
  }, [])

  if (!authedUser) {
    return <LoginGateScreen onLogin={handleLogin} onBack={onBack} />
  }

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Top header bar */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-3 flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
            <ArrowLeft className="w-4 h-4" />Back
          </Button>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-primary-foreground" />
            </div>
            <h1 className="text-lg font-bold text-foreground">System Management</h1>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>{authedUser.username}</span>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-1 text-xs">
              <Lock className="w-3 h-3" />Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Body: left sidebar nav + right content */}
      <div className="flex flex-1 min-h-0">
        <Tabs defaultValue="users" orientation="vertical" className="flex flex-row flex-1 min-h-0">

          {/* ── Vertical sidebar ── */}
          <TabsList className="flex flex-col w-56 shrink-0 bg-slate-900 rounded-none p-3 gap-0.5 items-stretch self-stretch h-full overflow-y-auto">
            <div className="px-2 py-2 mb-1">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Admin Panel</p>
            </div>

            {([
              { value: "users",         icon: <Users className="w-4 h-4" />,          label: "Users" },
              { value: "roles",         icon: <Shield className="w-4 h-4" />,          label: "Roles" },
              { value: "aio-data",      icon: <Database className="w-4 h-4" />,        label: "AIO Data" },
              { value: "hsl-data",      icon: <LayoutList className="w-4 h-4" />,      label: "HSL Data" },
              { value: "mro-data",      icon: <Brain className="w-4 h-4" />,           label: "MRO Data" },
              { value: "demo-reset",    icon: <ShieldAlert className="w-4 h-4" />,     label: "Demo Reset" },
              { value: "apikey",        icon: <Key className="w-4 h-4" />,             label: "API Key" },
              { value: "csvs",          icon: <FileSpreadsheet className="w-4 h-4" />, label: "Saved CSVs" },
              { value: "aios",          icon: <FileText className="w-4 h-4" />,        label: "Saved AIOs" },
              { value: "saved-prompts", icon: <Bookmark className="w-4 h-4" />,        label: "Saved Prompts" },
              { value: "info-elements", icon: <Atom className="w-4 h-4" />,            label: "Info Elements" },
              { value: "architecture",  icon: <Network className="w-4 h-4" />,         label: "Architecture" },
              { value: "references",    icon: <Library className="w-4 h-4" />,          label: "References" },
            ] as const).map(({ value, icon, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="w-full justify-start gap-3 px-3 py-2.5 rounded-md text-sm font-medium
                  text-slate-300 bg-transparent border-0
                  hover:bg-slate-800 hover:text-white
                  data-[state=active]:bg-indigo-600 data-[state=active]:text-white
                  data-[state=active]:shadow-none
                  transition-colors duration-150"
              >
                {icon}{label}
              </TabsTrigger>
            ))}

            {/* R & D — opens the Compound HSL Builder view (lives outside Tabs;
                clicking it navigates the parent shell to the rnd view). */}
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate("rnd")}
                className="w-full flex items-center justify-start gap-3 px-3 py-2.5 rounded-md text-sm font-medium
                  text-slate-300 bg-transparent border-0
                  hover:bg-slate-800 hover:text-white
                  transition-colors duration-150"
              >
                <Atom className="w-4 h-4" />R &amp; D
              </button>
            )}
          </TabsList>

          {/* ── Content area ── */}
          <div className="flex-1 min-h-0 overflow-y-auto p-6 bg-background">
            <TabsContent value="users" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Users className="w-5 h-5" />User Management</CardTitle></CardHeader>
                <CardContent><UserManagementPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="roles" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Shield className="w-5 h-5" />Roles</CardTitle></CardHeader>
                <CardContent><RolesPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="aio-data" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Database className="w-5 h-5" />AIO Data</CardTitle></CardHeader>
                <CardContent><AioDataPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="hsl-data" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><LayoutList className="w-5 h-5" />HSL Data</CardTitle></CardHeader>
                <CardContent><HslDataPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="mro-data" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5" />MRO Data</CardTitle></CardHeader>
                <CardContent><MroDataPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="demo-reset" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5" />Demo Reset &amp; Backup</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Clear the system for a fresh demo. Save the current state as a backup first, and restore it later if needed.
                  </p>
                </CardHeader>
                <CardContent><DemoResetPane /></CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="apikey" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Key className="w-5 h-5" />API Key Settings</CardTitle></CardHeader>
                <CardContent><ApiKeyPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="csvs" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileSpreadsheet className="w-5 h-5" />Saved CSVs</CardTitle></CardHeader>
                <CardContent><SavedCsvsPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="aios" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" />Saved AIOs</CardTitle></CardHeader>
                <CardContent><SavedAiosPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="saved-prompts" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bookmark className="w-5 h-5" />Saved Prompts</CardTitle></CardHeader>
                <CardContent><SavedPromptsPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="info-elements" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Atom className="w-5 h-5" />Information Elements</CardTitle></CardHeader>
                <CardContent><InformationElementsPane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="architecture" className="mt-0">
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><Network className="w-5 h-5" />System Architecture</CardTitle></CardHeader>
                <CardContent><ArchitecturePane /></CardContent></Card>
            </TabsContent>

            <TabsContent value="references" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Library className="w-5 h-5" />Reference Documents</CardTitle>
                  <p className="text-sm text-muted-foreground">Documentation, workflow guides, and foundational research papers for the Information Physics Standard Model.</p>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {[
                      {
                        view: "workflow",
                        icon: <Cpu className="w-6 h-6 text-[#0F3460]" />,
                        title: "Workflow Description",
                        desc: "Step-by-step guide to the AIO conversion, HSL building, and ChatAIO retrieval workflow.",
                        color: "border-[#0F3460]/30 hover:border-[#0F3460]/70",
                      },
                      {
                        view: "reference",
                        icon: <FileText className="w-6 h-6 text-[#0F3460]" />,
                        title: "Information Physics Reference",
                        desc: "Comprehensive reference for the Information Physics Standard Model — AIO, HSL, and MRO specifications.",
                        color: "border-[#0F3460]/30 hover:border-[#0F3460]/70",
                      },
                      {
                        view: "paper",
                        icon: <BookOpen className="w-6 h-6 text-emerald-600" />,
                        title: "AIO Reference Paper",
                        desc: "Foundational research paper defining the Associated Information Object (AIO) data model and bracket notation.",
                        color: "border-emerald-300/50 hover:border-emerald-400",
                      },
                      {
                        view: "mro-paper",
                        icon: <Brain className="w-6 h-6 text-emerald-600" />,
                        title: "MRO Reference Paper",
                        desc: "Research paper defining Memory Result Objects — episodic AI memory with provenance, ranking, and lineage.",
                        color: "border-emerald-300/50 hover:border-emerald-400",
                      },
                      {
                        view: "paper-iii",
                        icon: <Atom className="w-6 h-6 text-emerald-600" />,
                        title: "Paper III — Precomputed Substrates for LLMs",
                        desc: "Advanced research paper on deterministic semantic substrate retrieval — the foundation of Substrate Chat mode.",
                        color: "border-emerald-300/50 hover:border-emerald-400",
                      },
                      {
                        view: "bulk-hsl-technote",
                        icon: <Layers className="w-6 h-6 text-rose-700" />,
                        title: "Technical Notes — Bulk HSL Build",
                        desc: "Confidential / Trade-Secret engineering reference for the tenant-wide HSL reconstruction function (POST /v1/hsl-data/rebuild-from-aios). Subject to NDA on file.",
                        color: "border-rose-300/50 hover:border-rose-400",
                      },
                    ].map(({ view, download, filename, icon, title, desc, color }) => (
                      <button
                        key={view ?? download}
                        onClick={() => {
                          if (download) {
                            const a = document.createElement("a")
                            a.href = download
                            a.download = filename ?? ""
                            document.body.appendChild(a)
                            a.click()
                            document.body.removeChild(a)
                          } else {
                            onNavigate?.(view!)
                          }
                        }}
                        disabled={!download && !onNavigate}
                        className={`text-left p-5 rounded-xl border-2 bg-card transition-colors duration-150 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-default ${color}`}
                      >
                        <div className="flex items-start gap-4">
                          <div className="shrink-0 mt-0.5">{icon}</div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="font-semibold text-foreground">{title}</p>
                              {download && (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-rose-700 bg-rose-100 border border-rose-300 rounded px-1.5 py-0.5">
                                  <FileDown className="w-3 h-3" />.docx
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>

        </Tabs>
      </div>
    </div>
  )
}
