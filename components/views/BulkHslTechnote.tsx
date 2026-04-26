"use client"

import { ArrowLeft, Settings, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function BulkHslTechnote({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
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
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">Technical Notes — Bulk HSL Build</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <article className="prose prose-sm dark:prose-invert max-w-none">

          {/* Confidential banner */}
          <div className="border-2 border-rose-500/60 bg-rose-50 dark:bg-rose-950/20 rounded-lg p-4 mb-8 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-rose-700 dark:text-rose-400 mb-1">CONFIDENTIAL — TRADE SECRET</p>
              <p className="text-rose-700/80 dark:text-rose-300/80 leading-relaxed">
                This document describes the internal logic, data structures, and operational behavior of a proprietary subsystem of the Information Physics Demo System. It contains confidential information and trade secrets of InformationPhysics.ai, LLC, including algorithmic detail not present in public-facing materials. Subject to the Transaction-Grade One-Way Non-Disclosure Agreement on file. Unauthorized use, disclosure, or reproduction is strictly prohibited and may result in civil and criminal liability.
              </p>
            </div>
          </div>

          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Engineering Reference — Internal / NDA-Restricted</p>
            <h1 className="text-2xl font-bold text-foreground mb-2 text-balance">Technical Notes — Bulk HSL Build</h1>
            <p className="text-base text-muted-foreground mb-1 italic">Logic, Workflow, and Operational Notes for the Tenant-Wide HSL Reconstruction Function</p>
            <p className="text-sm font-medium text-foreground mt-4">Michael Simon Bodner, Ph.D.</p>
            <p className="text-xs text-primary">Founder &amp; Chief Scientist, InformationPhysics.ai</p>
            <p className="text-sm text-muted-foreground">April 2026 — Software Version V4.3.0</p>
            <p className="text-xs text-muted-foreground mt-1">Endpoint: <code className="bg-muted px-1.5 py-0.5 rounded">POST /v1/hsl-data/rebuild-from-aios</code></p>
            <p className="text-xs text-muted-foreground mt-2">© 2026 InformationPhysics.ai, LLC. All rights reserved.</p>
          </div>

          <Card className="mb-10">
            <CardHeader><CardTitle className="text-base">Abstract</CardTitle></CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Bulk HSL Build is the tenant-wide reconstruction function for the Hyper-Semantic Layer (HSL). Its job is to scan every Associated Information Object (AIO) belonging to a single tenant, identify the <code className="bg-muted px-1 rounded">[Key.Value]</code> elements that two or more AIOs share, and emit one HSL pointer record per shared element group. The result is a precomputed, deterministic, query-time-ready relational layer that AIO Search and Substrate retrieval modes use to traverse the corpus without any embedding store, vector index, or graph database.</p>
              <p>This document covers the production version of the function as shipped in V4.3.0, exposed at <code className="bg-muted px-1 rounded">POST /v1/hsl-data/rebuild-from-aios</code> and surfaced on the application home page as the Bulk HSL Build button immediately to the left of ChatAIO. It is the authoritative engineering description for the function&apos;s logic, inputs, outputs, side effects, performance envelope, and known limitations.</p>
            </CardContent>
          </Card>

          <Section num={1} title="Purpose and Scope">
            <p>Bulk HSL Build operates strictly on Layer 1 (AIO) data and writes strictly to the relational HSL layer. It never reads or writes MROs, embeddings, or any external service.</p>
            <Sub title="Out of scope for this document">
              HSL hand-edit (covered under HSL Data administration); per-AIO incremental HSL synthesis on AIO insert (a future feature); MRO compaction and trust scoring (covered in the Substrate technote).
            </Sub>
          </Section>

          <Section num={2} title="The Object Model in One Page">
            <p>All three layers are tenant-isolated by PostgreSQL Row-Level Security with FORCE ROW LEVEL SECURITY enabled. Bulk HSL Build sets the tenant via <code className="bg-muted px-1 rounded">SET LOCAL app.tenant_id</code> at the top of its transaction; every SELECT and INSERT in the function is therefore implicitly filtered to that tenant. Cross-tenant leakage is structurally prevented at the database tier, not at the application tier.</p>
            <div className="overflow-x-auto my-3">
              <table className="w-full text-xs border border-border">
                <thead className="bg-[#0F3460] text-white">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Layer</th>
                    <th className="px-3 py-2 text-left font-semibold">Storage</th>
                    <th className="px-3 py-2 text-left font-semibold">What it represents</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="px-3 py-2 align-top font-semibold">AIO (Layer 1)</td>
                    <td className="px-3 py-2 align-top"><code className="bg-muted px-1 rounded">aio_data</code>; <code className="bg-muted px-1 rounded">aio_name</code> + 50 element columns, each holding free-form text containing zero or more <code className="bg-muted px-1 rounded">[Key.Value]</code> tokens.</td>
                    <td className="px-3 py-2 align-top">A single self-describing observation. Captured as-found, with no schema commitment. The atom of the system.</td>
                  </tr>
                  <tr className="border-b border-border bg-muted/30">
                    <td className="px-3 py-2 align-top font-semibold">HSL (Relational)</td>
                    <td className="px-3 py-2 align-top"><code className="bg-muted px-1 rounded">hsl_data</code>; <code className="bg-muted px-1 rounded">hsl_name</code> + 100 element columns, each cell holding the <code className="bg-muted px-1 rounded">aio_name</code> of a member AIO.</td>
                    <td className="px-3 py-2 align-top">A precomputed pointer set: &ldquo;all AIOs in this tenant that share <code className="bg-muted px-1 rounded">[Key.Value]</code>.&rdquo; A denormalized inverted-index row, not a graph edge.</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 align-top font-semibold">MRO (Layer 2)</td>
                    <td className="px-3 py-2 align-top"><code className="bg-muted px-1 rounded">mro_objects</code>; persisted retrieval episode with query, result, lineage, trust score.</td>
                    <td className="px-3 py-2 align-top">Episodic memory. Out of scope here, but Substrate retrieval consumes the HSLs that Bulk HSL Build produces.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section num={3} title="External Interface (Inputs and Outputs)">
            <p>Bulk HSL Build is a POST endpoint with no request body. It is parameter-free by design: the function rebuilds against the complete AIO set of the requesting tenant in a single deterministic pass. This keeps the operator-facing contract narrow — there is exactly one button, one click, one outcome.</p>
            <Sub title="Method / Path"><code className="bg-muted px-1 rounded">POST /v1/hsl-data/rebuild-from-aios</code></Sub>
            <Sub title="Headers"><code className="bg-muted px-1 rounded">X-Tenant-Id</code> (optional; defaults to <code className="bg-muted px-1 rounded">tenantA</code>). Authentication is governed by the gateway; the function trusts the tenant header.</Sub>
            <Sub title="Body">None. The function takes no parameters.</Sub>
            <Sub title="Side effects">INSERTs new rows into <code className="bg-muted px-1 rounded">hsl_data</code>. Never UPDATEs or DELETEs. Existing HSL rows are preserved unchanged.</Sub>
            <Sub title="Idempotency">Safe to call repeatedly. The duplicate-name check makes a second invocation a no-op for any HSL that already exists, so re-runs converge.</Sub>
            <Sub title="Concurrency">Single transaction per call; one call per tenant at a time is the recommended operational constraint. The system does not currently take an advisory lock — see §8.</Sub>
            <Sub title="Response shape">
              <Code>{`{
  "created":             <int>,  // new HSL rows inserted
  "skipped_single_aio":  <int>,  // [K.V] groups in only 1 AIO
  "already_existed":     <int>,  // hsl_name already present
  "total_aios_scanned":  <int>   // size of aio_data at scan time
}`}</Code>
            </Sub>
          </Section>

          <Section num={4} title="End-to-End Workflow">
            <p>The function is structured as eleven discrete stages. Stages 2–5 are pure CPU/memory work; stages 7 and 9 are the only stages that touch the database after the initial AIO scan.</p>
            <ol className="list-decimal list-inside space-y-1.5 text-sm text-muted-foreground">
              <li><strong className="text-foreground">Tenant scoping</strong> — open a connection, call <code className="bg-muted px-1 rounded">set_tenant(conn, tenant)</code> which issues <code className="bg-muted px-1 rounded">SET LOCAL app.tenant_id</code>. RLS now restricts every subsequent query.</li>
              <li><strong className="text-foreground">AIO scan</strong> — <code className="bg-muted px-1 rounded">SELECT aio_name, elem01..elem50 FROM aio_data</code>; stream all rows into memory in a single sequential pass.</li>
              <li><strong className="text-foreground">Bracket-token extraction</strong> — for each non-null element string, run <code className="bg-muted px-1 rounded">\\[([^.\\]]+)\\.(.+?)\\]</code> to extract every <code className="bg-muted px-1 rounded">[Key.Value]</code> occurrence. Multiple tokens per cell are supported.</li>
              <li><strong className="text-foreground">Skip-list filter</strong> — discard tokens whose value is in <code className="bg-muted px-1 rounded">{"{ unknown, n/a, none, null, \"\", 0, 0.0, false, true }"}</code> (case-insensitive) or shorter than 2 characters.</li>
              <li><strong className="text-foreground">In-memory inverted index</strong> — build <code className="bg-muted px-1 rounded">index[key][value] → [aio_name, ...]</code>. Each AIO contributes once per distinct token it contains.</li>
              <li><strong className="text-foreground">Group emission</strong> — for each <code className="bg-muted px-1 rounded">(key, value)</code>, if the AIO list has &lt;2 members increment <code className="bg-muted px-1 rounded">skipped_single_aio</code> and continue; otherwise prepare an HSL emission.</li>
              <li><strong className="text-foreground">Existence check</strong> — compute <code className="bg-muted px-1 rounded">hsl_name = &quot;[Key.Value].hsl&quot;</code>. <code className="bg-muted px-1 rounded">SELECT hsl_id FROM hsl_data WHERE hsl_name = %s LIMIT 1</code>. If a row exists, increment <code className="bg-muted px-1 rounded">already_existed</code>. Existing HSLs are never overwritten.</li>
              <li><strong className="text-foreground">Width truncation</strong> — truncate the AIO list to the first 100 names; pad the remainder of 100 element columns with NULL.</li>
              <li><strong className="text-foreground">Insert</strong> — INSERT a single row carrying <code className="bg-muted px-1 rounded">hsl_id</code> (UUID v4), <code className="bg-muted px-1 rounded">hsl_name</code>, the 100 element columns, <code className="bg-muted px-1 rounded">created_at</code>, <code className="bg-muted px-1 rounded">updated_at</code>, <code className="bg-muted px-1 rounded">tenant_id</code>.</li>
              <li><strong className="text-foreground">Commit</strong> — single COMMIT after every <code className="bg-muted px-1 rounded">(key, value)</code> pair is processed. Every new HSL lands or none of them does.</li>
              <li><strong className="text-foreground">Telemetry &amp; response</strong> — log the four counters at INFO and return JSON. Frontend toasts &ldquo;Built N HSLs&rdquo;.</li>
            </ol>
          </Section>

          <Section num={5} title="Algorithmic Detail">
            <Sub title="5.1  Bracket-token grammar">
              <Code>{`[ Key . Value ]
  Key   :: one or more characters, NOT containing  .  or  ]
  Value :: one or more characters, NOT containing  ]   (lazy)
  Regex :: \\[([^.\\]]+)\\.(.+?)\\]`}</Code>
              Both Key and Value are <code className="bg-muted px-1 rounded">.strip()</code>-trimmed after capture. Whitespace tolerance is deliberate: tokens are preserved exactly, similarity is established at the (Key, Value) tuple level.
            </Sub>
            <Sub title="5.2  Skip-list and minimum-length filter">
              Two filters reject low-information tokens before they enter the inverted index: a value-skip set (case-insensitive) and a minimum length of 2. Both are conservative — false negatives (real signal lost) are rare; false positives (noise HSLs created) would degrade every downstream search.
            </Sub>
            <Sub title="5.3  The inverted index as ground truth">
              The inverted index built in stage 5 is the closest thing the system has to a canonical model of tenant knowledge. Every HSL-producing function in the codebase must produce HSLs that are a subset of what this index would emit, otherwise the topology becomes inconsistent. Bulk HSL Build is therefore the reference oracle.
            </Sub>
            <Sub title="5.4  Determinism">
              Given the same AIO data set, two runs create the same set of HSL names. The order of AIOs inside an HSL&apos;s element columns can vary, because Python dict insertion order tracks scan order, which depends on row order returned by the database. Acceptable: HSL columns are an unordered set; downstream search treats columns positionally only as storage, never semantically.
            </Sub>
            <Sub title="5.5  Idempotency and the 100-AIO width cap">
              Stage 7&apos;s existence check is the idempotency boundary. Consequence: if a tenant has more than 100 AIOs sharing an element, only the first 100 (in scan order) are pinned by the original run. Subsequent AIOs that would have joined cannot be added by Bulk HSL Build because the existing row is preserved untouched. See §8 for remediation.
            </Sub>
          </Section>

          <Section num={6} title="Code Anatomy">
            <p>The function lives in a single file, <code className="bg-muted px-1 rounded">infophysics_impl_grade/api/routes/hsl.py</code>, in approximately 70 source lines. Dependencies are limited to: the project&apos;s <code className="bg-muted px-1 rounded">db()</code> context manager, <code className="bg-muted px-1 rounded">set_tenant()</code>, the standard library (<code className="bg-muted px-1 rounded">re</code>, <code className="bg-muted px-1 rounded">uuid</code>, <code className="bg-muted px-1 rounded">datetime</code>), and column-name constants from the AIO module.</p>
            <Sub title="6.1  Anchor signature">
              <Code>{`@router.post("/v1/hsl-data/rebuild-from-aios")
def rebuild_hsls_from_aios(
    x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-Id"),
):
    tenant = x_tenant_id or "tenantA"
    _SKIP_VALUES = {"unknown", "n/a", "none", "null", "",
                    "0", "0.0", "false", "true"}
    _VALUE_RE = re.compile(r"\\[([^.\\]]+)\\.(.+?)\\]")`}</Code>
            </Sub>
            <Sub title="6.2  Inverted-index build">
              <Code>{`for row in aio_rows:
    aio_name = row[0]
    if not aio_name:
        continue
    for el in row[1:]:
        if not el or not isinstance(el, str):
            continue
        for m in _VALUE_RE.finditer(el):
            key = m.group(1).strip()
            val = m.group(2).strip()
            if val.lower() in _SKIP_VALUES or len(val) < 2:
                continue
            index.setdefault(key, {})\\
                 .setdefault(val, []).append(aio_name)`}</Code>
            </Sub>
            <Sub title="6.3  Emission">
              <Code>{`for key, val_map in index.items():
    for val, aio_names in val_map.items():
        if len(aio_names) < 2:
            skipped += 1; continue
        hsl_name = f"[{key}.{val}].hsl"
        cur.execute(
          "SELECT hsl_id FROM hsl_data WHERE hsl_name = %s LIMIT 1",
          (hsl_name,),
        )
        if cur.fetchone():
            already_existed += 1; continue
        elems = aio_names[:100] + [None] * (100 - len(aio_names[:100]))
        cur.execute(INSERT_SQL,
                    [str(uuid.uuid4()), hsl_name] + elems
                    + [now, now, tenant])
        created += 1`}</Code>
            </Sub>
            <Sub title="6.4  Frontend invocation">
              The home-page button hits the Next.js proxy at <code className="bg-muted px-1 rounded">/api/hsl-data/rebuild-from-aios</code>, which POSTs to FastAPI with the <code className="bg-muted px-1 rounded">X-Tenant-Id</code> header. The toast displays the four counters returned by the backend.
            </Sub>
          </Section>

          <Section num={7} title="Performance Envelope">
            <p>Asymptotic cost is dominated by two terms: (a) AIO scan and bracket-token extraction at <code className="bg-muted px-1 rounded">O(N · E · T)</code>, and (b) per-group existence check + INSERT at <code className="bg-muted px-1 rounded">O(G)</code> database round-trips.</p>
            <div className="overflow-x-auto my-3">
              <table className="w-full text-xs border border-border">
                <thead className="bg-[#0F3460] text-white">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">AIO count</th>
                    <th className="px-3 py-2 text-left font-semibold">Tokens scanned (typ.)</th>
                    <th className="px-3 py-2 text-left font-semibold">HSLs emitted (typ.)</th>
                    <th className="px-3 py-2 text-left font-semibold">Wall time (typ.)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border"><td className="px-3 py-2">100</td><td className="px-3 py-2">≈1,500</td><td className="px-3 py-2">≈50–150</td><td className="px-3 py-2">&lt; 200 ms</td></tr>
                  <tr className="border-b border-border bg-muted/30"><td className="px-3 py-2">1,000</td><td className="px-3 py-2">≈15,000</td><td className="px-3 py-2">≈500–1,500</td><td className="px-3 py-2">0.5 – 1.5 s</td></tr>
                  <tr className="border-b border-border"><td className="px-3 py-2">10,000</td><td className="px-3 py-2">≈150,000</td><td className="px-3 py-2">≈5,000–15,000</td><td className="px-3 py-2">8 – 25 s</td></tr>
                  <tr className="bg-muted/30"><td className="px-3 py-2">100,000</td><td className="px-3 py-2">≈1.5 M</td><td className="px-3 py-2">≈50,000+</td><td className="px-3 py-2">Several minutes; not yet field-tested.</td></tr>
                </tbody>
              </table>
            </div>
            <p>Two notes for the operational reader:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>The single-COMMIT design holds an open transaction. On very large tenants, splitting into batches of ≈5,000 inserts per commit is an unimplemented optimization that should land before any tenant exceeds ≈25,000 AIOs.</li>
              <li>The G-count round-trip pattern (one SELECT + one INSERT per group) is the next optimization target. A single <code className="bg-muted px-1 rounded">INSERT … ON CONFLICT DO NOTHING</code> with multi-row VALUES would replace 2G round-trips with O(1).</li>
            </ul>
          </Section>

          <Section num={8} title="Edge Cases and Known Limitations">
            <Sub title="8.1  AIOs without aio_name">Rows whose <code className="bg-muted px-1 rounded">aio_name</code> is NULL or empty are skipped. Such rows should not exist in well-formed tenants but the function tolerates them defensively.</Sub>
            <Sub title="8.2  Non-string element columns">Element columns are typed text in the schema, but the function explicitly checks <code className="bg-muted px-1 rounded">isinstance(el, str)</code>. A future migration introducing JSON or array columns will require a corresponding extraction path.</Sub>
            <Sub title="8.3  Tokens containing the closing bracket">The lazy quantifier in the value capture cannot match a literal &ldquo;]&rdquo;. A value containing &ldquo;]&rdquo; (e.g., <code className="bg-muted px-1 rounded">[Note.see [4]]</code>) is truncated to the first inner bracket. The price of the simple grammar; rare in practice.</Sub>
            <Sub title="8.4  Width cap of 100 AIOs per HSL">Once an HSL exists with 100 element columns filled, a later rebuild cannot widen it. Remediations: (1) operationally, delete the saturated HSL via the HSL admin pane and re-run; (2) engineering, extend the schema beyond 100 columns or migrate the element list to a side table. Both are roadmap items.</Sub>
            <Sub title="8.5  Concurrent invocations">Two simultaneous calls for the same tenant can both pass the existence check for the same <code className="bg-muted px-1 rounded">hsl_name</code> and both attempt to INSERT. Without a uniqueness constraint, both rows would land. Operational policy: one rebuild call per tenant at a time. Engineering remediation: a <code className="bg-muted px-1 rounded">UNIQUE INDEX hsl_data(tenant_id, hsl_name)</code>, recommended before exposing the function to multi-operator administration.</Sub>
            <Sub title="8.6  Trailing skip values that are real">A tenant whose domain genuinely uses, say, the value &ldquo;true&rdquo; as a discriminator will not get HSLs for it. Wrap such values with disambiguating text at the source (e.g., <code className="bg-muted px-1 rounded">[Status.true-confirmed]</code>).</Sub>
            <Sub title="8.7  No removal pass">Bulk HSL Build never deletes HSLs. If an AIO is removed and its element drops below the 2-AIO threshold, the corresponding HSL becomes a stale single-pointer row. A planned companion function, &ldquo;HSL prune,&rdquo; will sweep these.</Sub>
          </Section>

          <Section num={9} title="Operator User Experience">
            <p>Bulk HSL Build is intentionally surfaced as a one-click action on the home page, immediately to the left of ChatAIO. There is no confirmation dialog: the function is non-destructive (it only INSERTs), idempotent (a second click is a no-op for already-existing HSLs), and bounded (it commits in a single transaction).</p>
            <Sub title="Visible affordances">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li>Button label: &ldquo;Bulk HSL Build&rdquo;, with a stacked-layers icon.</li>
                <li>During execution: spinning loader and label &ldquo;Building HSLs…&rdquo;. Button disabled to prevent double-submit.</li>
                <li>On success: toast &ldquo;Built N HSLs&rdquo; using the <code className="bg-muted px-1 rounded">created</code> counter.</li>
                <li>On failure: toast surfaces the API error string. The function is transactional, so a backend failure leaves no half-state.</li>
              </ul>
            </Sub>
            <Sub title="Where the function used to live">
              In V4.2.x the function was reachable only from the R&amp;D view. As of V4.3.0 it has been promoted to the home page because it is the canonical &ldquo;reset the topology&rdquo; action that any operator running a fresh demo or onboarding a new tenant needs to perform. The R&amp;D entry point has been removed; this document is the authoritative reference for what that button does.
            </Sub>
          </Section>

          <Section num={10} title="Trade-Secret Surface">
            <p>The non-public, defensible elements of Bulk HSL Build — those that distinguish it from a naive inverted-index builder and that constitute the protectable invention — are enumerated below. Each is described at the level a buyer&apos;s technical evaluator can verify against the source, but not at the level a competitor can reimplement without independent investment.</p>
            <ul className="list-disc list-inside space-y-2">
              <li><strong className="text-foreground">The bracket-token grammar as the substrate for HSL synthesis.</strong> AIOs are not parsed by a per-tenant schema; they are parsed by a single regex that treats every observation as a sequence of <code className="bg-muted px-1 rounded">[Key.Value]</code> tokens. This is the design choice that allows the same function to operate on financial, clinical, manufacturing, and narrative corpora without modification.</li>
              <li><strong className="text-foreground">The skip-list / minimum-length filter.</strong> The exact composition of the skip set was derived from production observation across multiple corpora.</li>
              <li><strong className="text-foreground">The 2-AIO emission threshold and the 100-AIO width cap.</strong> Both are tuning constants chosen to make the HSL layer useful without making it gigantic. They are part of the invention, not arbitrary defaults.</li>
              <li><strong className="text-foreground">The canonical <code className="bg-muted px-1 rounded">hsl_name</code> format <code className="bg-muted px-1 rounded">[Key.Value].hsl</code>.</strong> The link by which Substrate retrieval, R&amp;D tooling, MRO compaction, and the HSL admin pane all agree on which HSL is which.</li>
              <li><strong className="text-foreground">The single-pass, single-transaction, parameter-free contract.</strong> Operationally what makes the function safe to expose as a one-click action; conceptually what makes the relational HSL layer a deterministic function of the AIO set and therefore reproducible without external state.</li>
              <li><strong className="text-foreground">The structural choice to compute HSLs offline rather than as a query-time graph traversal.</strong> The pivotal architectural commitment of the entire Information Physics platform: retrieval at query time uses HSLs as a lookup, not a computation.</li>
            </ul>
            <p>Disclosure of any of the above outside the boundary of the Transaction-Grade One-Way NDA on file would constitute a material breach.</p>
          </Section>

          <Section num={11} title="Roadmap (Next Engineering Steps)">
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Add <code className="bg-muted px-1 rounded">UNIQUE INDEX hsl_data(tenant_id, hsl_name)</code> to make concurrent rebuilds structurally safe.</li>
              <li>Replace the 2G existence-check round-trips with a batched <code className="bg-muted px-1 rounded">INSERT … ON CONFLICT DO NOTHING</code>.</li>
              <li>Implement HSL Prune as the dual function: scan HSLs, remove rows whose surviving element count is &lt; 2.</li>
              <li>Implement incremental, per-AIO HSL synth-on-insert so Bulk HSL Build becomes a recovery tool rather than a routine action.</li>
              <li>Lift the 100-AIO width cap by migrating element columns to a side table (<code className="bg-muted px-1 rounded">hsl_member</code>) keyed on <code className="bg-muted px-1 rounded">(hsl_id, aio_name)</code>.</li>
              <li>Add an <code className="bg-muted px-1 rounded">--as-of</code> timestamp parameter to support point-in-time rebuilds for forensic and regression scenarios.</li>
            </ol>
            <p>Items 1 and 2 are recommended before any production deployment beyond the demo footprint. Items 3–6 are R&amp;D items consistent with the platform&apos;s preserve-first thesis and will be undertaken inside the same trade-secret regime as the existing function.</p>
          </Section>

          <p className="text-center text-xs text-muted-foreground border-t border-border pt-4 mt-8">
            Prepared by InformationPhysics.ai, LLC. Confidential — subject to the Transaction-Grade One-Way NDA on file. © 2026 InformationPhysics.ai, LLC. All rights reserved.
          </p>
        </article>
      </main>
    </div>
  )
}
