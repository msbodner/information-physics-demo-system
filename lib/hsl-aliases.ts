// lib/hsl-aliases.ts
// ─────────────────────────────────────────────────────────────────────────
// Field-name aliasing for HSL cue lookups.
//
// AIOs across CSVs use different shapes for what is semantically the same
// field — e.g. AIA305 stores "Project_ID", acc_rfis/acc_issues/acc_submittals
// use "Project ID", acc_vendors uses "Projects Assigned", acc_cost_codes
// uses "Applicable Projects". Without aliasing, the cue extractor and HSL
// traversal treat these as unrelated and fragment the neighborhood — a
// PRJ-003 query then misses operational records keyed by the variant name.
//
// canonicalField(name) folds any known alias to its canonical form. Both
// the cue side and the AIO-element side run through it before comparison,
// so cues emitted as `[Project.PRJ-003]` align with elements stored under
// any of the aliases above.
//
// V1 lives entirely on the frontend so we can iterate the alias table
// without database migrations. Promote to backend once the table stabilizes.
// ─────────────────────────────────────────────────────────────────────────

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const table: Record<string, string[]> = {
    Project: [
      "Project",
      "Project_ID",
      "Project ID",
      "ProjectID",
      "Projects Assigned",
      "Applicable Projects",
      "Active Projects",
    ],
  }
  const out: Record<string, string> = {}
  for (const [canonical, aliases] of Object.entries(table)) {
    for (const a of aliases) out[a.toLowerCase()] = canonical
  }
  return out
})()

/**
 * Fold an arbitrary field name onto its canonical form for cross-CSV
 * cue matching. Unknown names are returned unchanged (case-preserving).
 */
export function canonicalField(name: string): string {
  if (!name) return name
  return ALIAS_TO_CANONICAL[name.toLowerCase()] ?? name
}
