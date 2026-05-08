"use client"

// V5.1 — Bulk HSL Process Technote.
//
// Companion to the V4.4 BulkHslTechnote.tsx (deeper engineering
// reference for the rebuild-from-aios endpoint specifically). This
// note is the "as-built in V5.1" plain description of how HSLs come
// into existence in the running system, covering BOTH the inline
// `synth_hsls_for_aio` path that fires on every AIO write AND the
// one-shot `Bulk HSL Build` button.
//
// Why a fresh technote rather than editing the V4.4 one:
// - The V4.4 reference predates V4.5+ (skip-value list expansion),
//   V4.6 (member side-table reads), V5.0 (Exhaustive Live's HSL
//   probing pattern), and V5.1 (no functional bulk-rebuild changes
//   but the operator mental model around it has matured).
// - Operators kept asking "is the bulk button doing the same thing
//   as the inline synth — or is it different?" The answer is "same
//   rules, different execution shape" — and that's worth saying
//   plainly in one place.

import { ArrowLeft, Settings, ShieldAlert, Layers } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function BulkHslProcessTechnoteV51({
  onBack,
  onSysAdmin,
}: {
  onBack: () => void
  onSysAdmin: () => void
}) {
  const Section = ({ num, title, children }: { num: number; title: string; children: React.ReactNode }) => (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{num}. {title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  )

  const Sub = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="pl-4 border-l-2 border-rose-500/40 mb-3">
      <p className="text-sm font-semibold text-foreground mb-1">{title}</p>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  )

  const Code = ({ children }: { children: string }) => (
    <pre className="p-3 rounded-lg bg-muted font-mono text-[12px] leading-relaxed whitespace-pre overflow-x-auto my-3 border border-border">{children}</pre>
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft className="w-4 h-4" />Back
            </Button>
            <h1 className="text-lg font-bold text-foreground">Bulk HSL Process — V5.1 As-Built</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2">
            <Settings className="w-4 h-4" />System Admin
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Confidential banner */}
        <div className="mb-6 border-l-4 border-rose-600 bg-rose-50 dark:bg-rose-950/20 dark:border-rose-700 px-4 py-3 rounded-r flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-rose-700 mt-0.5 shrink-0" />
          <div className="text-xs leading-relaxed">
            <p className="font-semibold text-rose-900 dark:text-rose-200 mb-1">Confidential / Trade Secret — Subject to NDA on file</p>
            <p className="text-rose-900/80 dark:text-rose-200/80">This engineering reference describes the production HSL-synthesis pipeline as of Software Version V5.1.0. Distribution outside the executed-NDA holder set is prohibited.</p>
          </div>
        </div>

        {/* Title block */}
        <Card className="mb-6 border-rose-200/50 dark:border-rose-800/50">
          <CardHeader className="text-center">
            <Layers className="w-10 h-10 mx-auto mb-2 text-rose-700" />
            <CardTitle className="text-2xl">Bulk HSL Process</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">As-built reference for the V5.1.0 Hyper-Semantic Layer synthesis pipeline</p>
            <p className="text-xs text-muted-foreground mt-1">May 2026 — Software Version V5.1.0</p>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground italic text-center">
              Information Physics Standard Model · AIO/HSL/MRO Demo System V5.1
            </p>
          </CardContent>
        </Card>

        {/* Abstract */}
        <Card className="mb-6 bg-muted/30">
          <CardContent className="pt-5 text-sm text-muted-foreground leading-relaxed">
            <p className="font-semibold text-foreground mb-2">Abstract</p>
            <p>
              Hyper-Semantic Layers (HSLs) are precomputed pointer tables that connect Associated Information Objects (AIOs) sharing
              a common <code className="bg-muted px-1 rounded">[Key.Value]</code> element. Every HSL anchors on exactly one
              {" "}<code className="bg-muted px-1 rounded">(Key, Value)</code> pair, requires at least two member AIOs to exist, and is
              maintained through the lifetime of the corpus by two cooperating paths: an <em>incremental</em> path that fires inline
              on every AIO write, and a <em>bulk</em> path exposed as the home-page <strong>Bulk HSL Build</strong> button. Both paths
              apply identical rules; they differ only in execution shape. This note documents the rules, the data they touch, and the
              boundary conditions every operator should understand before invoking the bulk path.
            </p>
          </CardContent>
        </Card>

        {/* Sections */}
        <Section num={1} title="What an HSL is and when it gets created">
          <p>
            An HSL is a row in <code className="bg-muted px-1 rounded">hsl_data</code> whose
            {" "}<code className="bg-muted px-1 rounded">hsl_name</code> has the canonical form
            {" "}<code className="bg-muted px-1 rounded">[Key.Value].hsl</code> and whose member list is the set of AIO names that
            carry that exact <code className="bg-muted px-1 rounded">[Key.Value]</code> token in their bracket string.
          </p>
          <p>An HSL is created the first time the system observes a <code className="bg-muted px-1 rounded">(Key, Value)</code> pair appearing in <strong>two or more</strong> AIOs in the same tenant. Singletons never become HSLs — a layer with one member is not yet a Hyper-Semantic Layer; it is just an unshared element.</p>
          <Sub title="Skip-value gate">
            Values matching the noise list <code className="bg-muted px-1 rounded">{`{unknown, n/a, none, null, "", 0, 0.0, false, true}`}</code> never anchor an HSL, even if 50 AIOs share them. Values shorter than 2 characters are also skipped. Defined in <code className="bg-muted px-1 rounded">_SKIP_VALUES</code> at <code className="bg-muted px-1 rounded">api/routes/hsl.py:48</code>.
          </Sub>
          <Sub title="Once created, never re-created">
            The unique constraint <code className="bg-muted px-1 rounded">UNIQUE INDEX hsl_data(tenant_id, hsl_name)</code> (added in V4.4) makes the create step idempotent. Concurrent inserts of the same HSL name resolve to a single row; the loser of the race appends to that row's member list rather than crashing.
          </Sub>
        </Section>

        <Section num={2} title="The two synthesis paths">
          <Sub title="2.1 Inline path — synth_hsls_for_aio">
            <p>Fires automatically inside <code className="bg-muted px-1 rounded">create_aio_data</code> and <code className="bg-muted px-1 rounded">update_aio_data</code> in <code className="bg-muted px-1 rounded">api/routes/aio.py</code>, before the response returns to the caller. For each <code className="bg-muted px-1 rounded">(Key, Value)</code> pair the AIO carries:</p>
            <Code>{`for each (Key, Value) in this AIO:
  hsl_name = f"[{Key}.{Value}].hsl"

  # 1. Does the HSL already exist?
  if hsl_data row exists for tenant + hsl_name:
      INSERT INTO hsl_member (hsl_id, member_value=aio_name)
        ON CONFLICT DO NOTHING
      # plus best-effort dual-write into the next free legacy
      # element column (capped at 100; overflow stays in side table)
      appended += 1
      continue

  # 2. No HSL yet — does ANOTHER AIO carry this same (Key, Value)?
  SELECT 1 FROM aio_data
   WHERE tenant_id = T AND aio_name <> me
     AND elements_text LIKE '%[Key.Value]%'  -- lower-cased
   LIMIT 1

  if found:
      INSERT INTO hsl_data (hsl_name, hsl_element_1=other, hsl_element_2=me, ...)
      INSERT INTO hsl_member (...) for both
      created += 1
  else:
      skipped_single += 1`}</Code>
            <p>The function returns <code className="bg-muted px-1 rounded">{`{appended, created, skipped_single}`}</code> counters; the AIO write commits regardless. A synth failure is logged but never fails the AIO write — best-effort by design.</p>
          </Sub>
          <Sub title="2.2 Bulk path — POST /v1/hsl-data/rebuild-from-aios">
            <p>Triggered by clicking <strong>Bulk HSL Build</strong> on the home page (or by an external integration calling the endpoint). Without parameters it operates on every AIO in the tenant; with <code className="bg-muted px-1 rounded">?as_of=&lt;ISO8601&gt;</code> it scopes to a point-in-time snapshot for forensic / regression rebuilds. Algorithm:</p>
            <Code>{`# Phase 0 — load + index
SELECT aio_name, element_1..element_50 FROM aio_data WHERE created_at <= as_of
build full {Key: {Value: [aio_names]}} index in memory

# Phase 0.5 — filter to candidates with >= 2 members
candidates = [(hsl_name, [aio_names]) for groups with len(names) >= 2]
skipped_single = single-member groups

# Phase 0.6 — safety cap
if len(candidates) * avg_members > 1_000_000:
    HTTP 413 → "scope via as_of"

# Phase 1 — bulk INSERT in 200-row batches
for batch of 200:
    INSERT INTO hsl_data (hsl_id, hsl_name, hsl_element_1..100, ...)
      VALUES ...
      ON CONFLICT (tenant_id, hsl_name) DO NOTHING
      RETURNING hsl_id, hsl_name
    created      += inserted_count
    already_existed += conflicted_count

# Phase 2 — bulk side-table writes in 1,000-row batches
for batch of 1000:
    INSERT INTO hsl_member (hsl_id, member_value, member_kind='aio', ...)
      ON CONFLICT DO NOTHING

# Response
return { created, already_existed, skipped_single,
         total_aios_scanned }`}</Code>
            <p>The bulk path is <strong>additive only</strong>. It never UPDATEs or DELETEs <code className="bg-muted px-1 rounded">hsl_data</code> or <code className="bg-muted px-1 rounded">hsl_member</code>. Removal of stale HSLs (whose member counts dropped below 2 due to AIO deletes) is the job of <code className="bg-muted px-1 rounded">prune_hsls</code> at <code className="bg-muted px-1 rounded">POST /v1/hsl-data/prune</code> — exposed as the <strong>Prune HSLs</strong> button next to Bulk HSL Build.</p>
          </Sub>
          <Sub title="2.3 Same rules, different execution shape">
            Both paths apply the identical <code className="bg-muted px-1 rounded">≥ 2 AIOs share seed → create-or-append</code> rule, the identical skip-value list, and the identical <code className="bg-muted px-1 rounded">[Key.Value].hsl</code> naming convention. The differences are operational: the inline path runs O(elements) on every AIO write with single-row writes; the bulk path scans the entire corpus once, builds an in-memory index, and writes in batches of 200 / 1,000.
          </Sub>
        </Section>

        <Section num={3} title="Rules summary">
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li>Look at every <code className="bg-muted px-1 rounded">[Key.Value]</code> element of every AIO in the tenant.</li>
            <li>Skip values in the noise list (<code className="bg-muted px-1 rounded">unknown</code>, <code className="bg-muted px-1 rounded">n/a</code>, <code className="bg-muted px-1 rounded">none</code>, <code className="bg-muted px-1 rounded">null</code>, <code className="bg-muted px-1 rounded">""</code>, <code className="bg-muted px-1 rounded">0</code>, <code className="bg-muted px-1 rounded">0.0</code>, <code className="bg-muted px-1 rounded">false</code>, <code className="bg-muted px-1 rounded">true</code>).</li>
            <li>Skip values shorter than 2 characters.</li>
            <li>Group surviving elements by <code className="bg-muted px-1 rounded">(Key, Value)</code>.</li>
            <li>For each group with <strong>≥ 2 distinct AIO members</strong>: ensure an HSL named <code className="bg-muted px-1 rounded">[Key.Value].hsl</code> exists for this tenant.</li>
            <li>If the HSL exists, append every member that isn't already in its <code className="bg-muted px-1 rounded">hsl_member</code> side table.</li>
            <li>If the HSL doesn't exist, create it with all members listed.</li>
            <li>Never delete or mutate existing HSLs (additive-only invariant).</li>
            <li>Single-member groups produce no HSL and are counted as <code className="bg-muted px-1 rounded">skipped_single</code>.</li>
          </ul>
        </Section>

        <Section num={4} title="Inputs and outputs">
          <Sub title="Inputs (Bulk path)">
            HTTP POST. Optional <code className="bg-muted px-1 rounded">?as_of=&lt;ISO8601&gt;</code> query param (point-in-time scope). Tenant resolved from <code className="bg-muted px-1 rounded">X-Tenant-Id</code> request header. No request body required.
          </Sub>
          <Sub title="Outputs (Bulk path)">
            JSON: <code className="bg-muted px-1 rounded">{`{ created, already_existed, skipped_single, total_aios_scanned }`}</code>. The home-page toast renders these four counters verbatim.
          </Sub>
          <Sub title="Inputs (Inline path)">
            None — driven by the AIO write that triggered it. <code className="bg-muted px-1 rounded">synth_hsls_for_aio(conn, tenant, aio_name, elements)</code> takes the same connection, tenant, and the AIO's elements list it just persisted.
          </Sub>
          <Sub title="Outputs (Inline path)">
            Returns <code className="bg-muted px-1 rounded">{`{ appended, created, skipped_single }`}</code> for caller logging. The AIO write succeeds regardless.
          </Sub>
          <Sub title="Side effects (both paths)">
            Both paths INSERT into <code className="bg-muted px-1 rounded">hsl_data</code> (new HSLs) and <code className="bg-muted px-1 rounded">hsl_member</code> (member roster). Neither UPDATEs the legacy <code className="bg-muted px-1 rounded">hsl_element_1..100</code> columns destructively — the inline path dual-writes into the next free slot, the bulk path populates them at create-time only.
          </Sub>
        </Section>

        <Section num={5} title="Boundary conditions and operational notes">
          <Sub title="5.1 Safety cap on the bulk path">
            <p>The bulk endpoint refuses with HTTP 413 when <code className="bg-muted px-1 rounded">len(candidates) × avg_members &gt; 1,000,000</code>. The error body recommends scoping via <code className="bg-muted px-1 rounded">?as_of=…</code>. The cap protects PostgreSQL from a single multi-minute write burst.</p>
            <p>Typical demo scale (a few thousand AIOs across a handful of CSVs / PDFs) never approaches this. The cap matters at production scale or when seeded with millions of historical AIOs.</p>
          </Sub>
          <Sub title="5.2 Bulk is additive — Prune HSLs is the deletion path">
            Deleting AIOs in System Admin (or restoring from a backup that omits some AIOs) leaves orphan HSLs whose member counts dropped below 2. <strong>Bulk HSL Build does not remove these.</strong> The <strong>Prune HSLs</strong> button is the canonical removal pass — a single CTE DELETE that drops every HSL whose live-AIO member count is below 2. MRO references (<code className="bg-muted px-1 rounded">member_kind = 'mro'</code>) do not count toward the floor.
          </Sub>
          <Sub title="5.3 When to click Bulk HSL Build">
            <ul className="list-disc list-inside space-y-1">
              <li>After a bulk import that bypassed the API (e.g., direct <code className="bg-muted px-1 rounded">psql</code> insert, demo backup restore from raw SQL).</li>
              <li>After hand-editing <code className="bg-muted px-1 rounded">aio_data</code> in System Admin in a way that introduced new <code className="bg-muted px-1 rounded">[Key.Value]</code> tokens.</li>
              <li>For forensic point-in-time replay (<code className="bg-muted px-1 rounded">?as_of=…</code>).</li>
              <li>After a schema-format migration that touched bracket strings.</li>
            </ul>
            For routine operation — the click-the-button-after-importing-CSVs reflex from V4.3 and earlier — the inline path is sufficient and the bulk button is unnecessary.
          </Sub>
          <Sub title="5.4 Concurrent invocations are race-free">
            Two simultaneous calls for the same tenant cannot duplicate HSLs. The <code className="bg-muted px-1 rounded">UNIQUE INDEX hsl_data(tenant_id, hsl_name)</code> turns racing inserts into a no-op via <code className="bg-muted px-1 rounded">ON CONFLICT DO NOTHING</code>; the side-table writer re-queries the surviving row and tops up its members. No application-level lock is required.
          </Sub>
          <Sub title="5.5 What V5.0 and V5.1 did not change">
            The bulk-rebuild logic has been stable since V4.4. V4.5 expanded the <code className="bg-muted px-1 rounded">_SKIP_VALUES</code> noise list. V4.6 read-paths started consulting the side table preferentially. V5.0 added the Exhaustive Live retrieval mode (which probes HSLs but never creates them). V5.1 ships the React-state fix on PDF Import + comprehensive Summarize All — neither touches HSL synthesis. The pipeline described above is the same code path as in V4.4 with the same invariants.
          </Sub>
        </Section>

        <Section num={6} title="Counter glossary">
          <ul className="list-disc list-inside space-y-2 ml-2">
            <li><code className="bg-muted px-1 rounded">created</code> — number of HSLs newly inserted by this call. Inserted means a row appeared in <code className="bg-muted px-1 rounded">hsl_data</code> that wasn't there before.</li>
            <li><code className="bg-muted px-1 rounded">already_existed</code> — number of candidate HSL names that lost the <code className="bg-muted px-1 rounded">ON CONFLICT</code> race because the row was already present. Their member rosters are still topped up in Phase 2.</li>
            <li><code className="bg-muted px-1 rounded">appended</code> (inline path only) — number of (HSL, AIO) pairs the inline path inserted into <code className="bg-muted px-1 rounded">hsl_member</code>. Top-up of an existing HSL.</li>
            <li><code className="bg-muted px-1 rounded">skipped_single</code> — number of <code className="bg-muted px-1 rounded">(Key, Value)</code> groups that had fewer than 2 distinct AIO members and were dropped before any write happened.</li>
            <li><code className="bg-muted px-1 rounded">total_aios_scanned</code> — bulk path only; the row count from the initial <code className="bg-muted px-1 rounded">SELECT FROM aio_data</code>.</li>
          </ul>
        </Section>

        <Section num={7} title="Reference — file paths and line ranges">
          <ul className="list-disc list-inside space-y-1 font-mono text-xs">
            <li><code className="bg-muted px-1 rounded">api/routes/hsl.py:47-48</code> — <code className="bg-muted px-1 rounded">_SKIP_VALUES</code> noise list</li>
            <li><code className="bg-muted px-1 rounded">api/routes/hsl.py:478-498</code> — <code className="bg-muted px-1 rounded">_extract_kv_pairs</code> (length floor + skip filter)</li>
            <li><code className="bg-muted px-1 rounded">api/routes/hsl.py:501-627</code> — <code className="bg-muted px-1 rounded">synth_hsls_for_aio</code> (inline path)</li>
            <li><code className="bg-muted px-1 rounded">api/routes/hsl.py:634-770</code> — <code className="bg-muted px-1 rounded">rebuild_hsls_from_aios</code> (bulk endpoint)</li>
            <li><code className="bg-muted px-1 rounded">api/routes/aio.py</code> — <code className="bg-muted px-1 rounded">create_aio_data</code> / <code className="bg-muted px-1 rounded">update_aio_data</code> call sites for the inline path</li>
            <li><code className="bg-muted px-1 rounded">migrations/023_hsl_member_and_uniqueness.sql</code> — UNIQUE INDEX + side table</li>
            <li><code className="bg-muted px-1 rounded">migrations/029_fix_hsl_ier_index.sql</code> — IER population from <code className="bg-muted px-1 rounded">hsl_name</code> (V4.5)</li>
          </ul>
        </Section>

        <Section num={8} title="See also">
          <ul className="list-disc list-inside space-y-1">
            <li><strong>Technical Notes — Bulk HSL Build (V4.4)</strong> — deeper engineering reference for the bulk endpoint specifically: schema, batching, concurrency, performance envelope.</li>
            <li><strong>User Guide → Recall Search</strong> — how HSLs are consumed at retrieval time (find-by-needles, HSL-driven AIO ranking).</li>
            <li><strong>Search Modes Compendium V5.0 §10</strong> — HSL-driven retrieval across Recall, Live, and Exhaustive Live.</li>
            <li><strong>Information Physics Standard Model</strong> — formal definitions of AIO, HSL, MRO and the operator algebra connecting them.</li>
          </ul>
        </Section>

        <p className="text-xs text-muted-foreground italic text-center mt-8 pt-4 border-t border-border">
          © 2026 InformationPhysics.ai, LLC — Michael Simon Bodner, Ph.D. — Confidential / Trade Secret — Subject to NDA on file
        </p>
      </main>
    </div>
  )
}
