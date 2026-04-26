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
            <p className="text-sm text-muted-foreground">April 2026 — Software Version V4.4.0</p>
            <p className="text-xs text-muted-foreground mt-1">Endpoints: <code className="bg-muted px-1.5 py-0.5 rounded">POST /v1/hsl-data/rebuild-from-aios</code> · <code className="bg-muted px-1.5 py-0.5 rounded">POST /v1/hsl-data/prune</code></p>
            <p className="text-xs text-muted-foreground mt-2">© 2026 InformationPhysics.ai, LLC. All rights reserved.</p>
          </div>

          <Card className="mb-10">
            <CardHeader><CardTitle className="text-base">Abstract</CardTitle></CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Bulk HSL Build is the tenant-wide reconstruction function for the Hyper-Semantic Layer (HSL). Its job is to scan every Associated Information Object (AIO) belonging to a single tenant, identify the <code className="bg-muted px-1 rounded">[Key.Value]</code> elements that two or more AIOs share, and emit one HSL pointer record per shared element group. The result is a precomputed, deterministic, query-time-ready relational layer that AIO Search and Substrate retrieval modes use to traverse the corpus without any embedding store, vector index, or graph database.</p>
              <p>This document covers the production version of the function as shipped in V4.4.0, exposed at <code className="bg-muted px-1 rounded">POST /v1/hsl-data/rebuild-from-aios</code> and surfaced on the application home page as the Bulk HSL Build button immediately to the left of ChatAIO. It is the authoritative engineering description for the function&apos;s logic, inputs, outputs, side effects, performance envelope, and known limitations.</p>
              <p><strong className="text-foreground">V4.4 substrate refactor.</strong> Six structural changes shipped together: (1) a <code className="bg-muted px-1 rounded">UNIQUE INDEX</code> on <code className="bg-muted px-1 rounded">hsl_data(tenant_id, hsl_name)</code>; (2) batched <code className="bg-muted px-1 rounded">INSERT … ON CONFLICT DO NOTHING</code> replacing per-group existence-check round-trips; (3) a new <code className="bg-muted px-1 rounded">prune_hsls</code> dual function; (4) an inline <code className="bg-muted px-1 rounded">synth_hsls_for_aio</code> call on every AIO write so Bulk HSL Build becomes a recovery tool rather than a routine action; (5) a side table <code className="bg-muted px-1 rounded">hsl_member</code> that lifts the 100-element width cap; (6) an optional <code className="bg-muted px-1 rounded">?as_of=&lt;ISO8601&gt;</code> query parameter for point-in-time rebuilds. The roadmap that closed §11 in V4.3 is now the subject of §11 below as &ldquo;What changed in V4.4&rdquo;.</p>
            </CardContent>
          </Card>

          <Section num={1} title="Purpose and Scope">
            <p>Bulk HSL Build operates strictly on Layer 1 (AIO) data and writes strictly to the relational HSL layer. It never reads or writes MROs, embeddings, or any external service.</p>
            <Sub title="Out of scope for this document">
              HSL hand-edit (covered under HSL Data administration); MRO compaction and trust scoring (covered in the Substrate technote). Per-AIO incremental HSL synthesis (<code className="bg-muted px-1 rounded">synth_hsls_for_aio</code>) is documented in §11.4 because it now sits beside Bulk HSL Build on the same call surface.
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
            <p>Bulk HSL Build is a POST endpoint that takes one optional query parameter. The default contract — a parameter-free rebuild against the complete current AIO set — is preserved exactly, so the home-page button continues to be one click, one outcome. The optional parameter exists for forensic and regression scenarios.</p>
            <Sub title="Method / Path"><code className="bg-muted px-1 rounded">POST /v1/hsl-data/rebuild-from-aios</code></Sub>
            <Sub title="Headers"><code className="bg-muted px-1 rounded">X-Tenant-Id</code> (optional; defaults to <code className="bg-muted px-1 rounded">tenantA</code>). Authentication is governed by the gateway; the function trusts the tenant header.</Sub>
            <Sub title="Query parameters">
              <code className="bg-muted px-1 rounded">as_of</code> (optional, ISO-8601 timestamp). When supplied, the rebuild considers only AIOs whose <code className="bg-muted px-1 rounded">created_at &le; as_of</code>. Enables point-in-time reconstruction of the HSL topology — useful for forensic replay or for regression-testing a substrate change against a frozen corpus snapshot. Omit for the default behavior. Echoed back in the response shape as <code className="bg-muted px-1 rounded">as_of</code> for audit trails.
            </Sub>
            <Sub title="Body">None.</Sub>
            <Sub title="Side effects">INSERTs new rows into <code className="bg-muted px-1 rounded">hsl_data</code> and into the V4.4 side table <code className="bg-muted px-1 rounded">hsl_member</code>. Never UPDATEs or DELETEs <code className="bg-muted px-1 rounded">hsl_data</code>. (Member-list maintenance for existing HSLs is the job of <code className="bg-muted px-1 rounded">synth_hsls_for_aio</code>; deletion is the job of <code className="bg-muted px-1 rounded">prune_hsls</code>.)</Sub>
            <Sub title="Idempotency">Structural in V4.4: the <code className="bg-muted px-1 rounded">UNIQUE INDEX hsl_data(tenant_id, hsl_name)</code> guarantees that <code className="bg-muted px-1 rounded">INSERT … ON CONFLICT DO NOTHING</code> is a no-op for any HSL that already exists, regardless of how many concurrent rebuild calls race for the same name.</Sub>
            <Sub title="Concurrency">Two simultaneous calls for the same tenant are now safe. The conflict resolution is at the database tier; no application-level lock is required.</Sub>
            <Sub title="Response shape">
              <Code>{`{
  "created":             <int>,         // new HSL rows inserted
  "skipped_single_aio":  <int>,         // [K.V] groups in only 1 AIO
  "already_existed":     <int>,         // hsl_name already present
  "total_aios_scanned":  <int>,         // size of aio_data at scan time
  "as_of":               <iso8601|null> // echo of the input parameter
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
            <Sub title="8.4  Width cap of 100 AIOs per HSL — lifted in V4.4">The historical 100-column cap is now decoupled from the data model. The authoritative member list lives in the side table <code className="bg-muted px-1 rounded">hsl_member(hsl_id, member_value, member_kind)</code> with no upper bound. The legacy <code className="bg-muted px-1 rounded">hsl_element_1..100</code> columns on <code className="bg-muted px-1 rounded">hsl_data</code> are kept dual-written (truncated to the first 100 members) for backward compatibility with the <code className="bg-muted px-1 rounded">elements_text</code> generated column (migration 016) and the legacy fallback paths in <code className="bg-muted px-1 rounded">chat.py</code>. Reads now go through the side table; the column overflow is silent.</Sub>
            <Sub title="8.5  Concurrent invocations — fixed in V4.4">Two simultaneous calls for the same tenant are now safe by construction. The <code className="bg-muted px-1 rounded">UNIQUE INDEX hsl_data(tenant_id, hsl_name)</code> turns a racing INSERT into a no-op via <code className="bg-muted px-1 rounded">ON CONFLICT DO NOTHING</code>; the side-table writer re-queries the surviving row and tops up its members. No application-level lock is taken or required.</Sub>
            <Sub title="8.6  Trailing skip values that are real">A tenant whose domain genuinely uses, say, the value &ldquo;true&rdquo; as a discriminator will not get HSLs for it. Wrap such values with disambiguating text at the source (e.g., <code className="bg-muted px-1 rounded">[Status.true-confirmed]</code>).</Sub>
            <Sub title="8.7  Removal — added as a dual function in V4.4">Bulk HSL Build still never deletes HSLs. The dual function <code className="bg-muted px-1 rounded">prune_hsls</code> at <code className="bg-muted px-1 rounded">POST /v1/hsl-data/prune</code> is now the authoritative removal pass. A single CTE DELETE removes every HSL whose surviving live-AIO member count has dropped below 2; <code className="bg-muted px-1 rounded">ON DELETE CASCADE</code> on the FK from <code className="bg-muted px-1 rounded">hsl_member.hsl_id</code> removes the side-table rows. MRO references (<code className="bg-muted px-1 rounded">member_kind = &apos;mro&apos;</code>) do not count toward the floor — an HSL with one live AIO and three MRO refs is still pruned.</Sub>
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
            <Sub title="Prune HSLs — the dual button (V4.4)">
              Sitting immediately right of Bulk HSL Build on the home page is the new Prune HSLs button (scissors icon). It is destructive — it deletes every HSL whose surviving live-AIO member count has dropped below 2 — so the click goes through a <code className="bg-muted px-1 rounded">window.confirm</code> guard before reaching the backend. The success toast reports the count and the first five pruned <code className="bg-muted px-1 rounded">hsl_name</code>s, or &ldquo;nothing to prune&rdquo; when the substrate is already coherent.
            </Sub>
            <Sub title="Where the function used to live">
              In V4.2.x the function was reachable only from the R&amp;D view. As of V4.3.0 it was promoted to the home page because it is the canonical &ldquo;reset the topology&rdquo; action that any operator running a fresh demo or onboarding a new tenant needs to perform. As of V4.4 it has changed status again: it is no longer the routine path for HSL growth — that path is now <code className="bg-muted px-1 rounded">synth_hsls_for_aio</code>, fired inline on every AIO write — and is positioned as a recovery / forensic tool. The button stays where it is; the operator&apos;s mental model shifts.
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

          <Section num={11} title="What Changed in V4.4">
            <p>Every item on the V4.3 roadmap that closed this document has shipped. The substrate is now structurally coherent: concurrent rebuilds are safe, growth is incremental, removal is a first-class operation, and the topology is reproducible against any historical AIO snapshot. The six changes below are documented in the order they appeared on the V4.3 roadmap so the diff against that document is easy to verify.</p>

            <Sub title="11.1  UNIQUE INDEX hsl_data(tenant_id, hsl_name)">
              Migration <code className="bg-muted px-1 rounded">023_hsl_member_and_uniqueness.sql</code> creates the index. Concurrent rebuilds, concurrent <code className="bg-muted px-1 rounded">synth_hsls_for_aio</code> calls from parallel AIO inserts, and any future multi-operator administration are now structurally race-free. The index is also a precondition for the batched <code className="bg-muted px-1 rounded">ON CONFLICT</code> path in §11.2.
            </Sub>

            <Sub title="11.2  Batched INSERT … ON CONFLICT DO NOTHING">
              The V4.3 algorithm performed two database round-trips per group (one SELECT for existence, one INSERT). At <code className="bg-muted px-1 rounded">G ≈ 5,000–15,000</code> groups per rebuild, that is the dominant cost. V4.4 collapses this to a two-phase pattern: phase 1 inserts up to 200 candidate <code className="bg-muted px-1 rounded">hsl_data</code> rows per round-trip via a <code className="bg-muted px-1 rounded">VALUES</code> list, with <code className="bg-muted px-1 rounded">ON CONFLICT (tenant_id, hsl_name) DO NOTHING RETURNING hsl_id, hsl_name</code>; phase 2 follows up with an <code className="bg-muted px-1 rounded">executemany</code> of up to 1,000 <code className="bg-muted px-1 rounded">hsl_member</code> rows per round-trip. Names that collided in phase 1 are re-queried so their member side-table is still topped up. Empirically the round-trip count drops from <code className="bg-muted px-1 rounded">2G</code> to <code className="bg-muted px-1 rounded">⌈G/200⌉ + ⌈M/1000⌉</code>, a 100×–500× reduction at typical demo scale.
            </Sub>

            <Sub title="11.3  prune_hsls — the dual function">
              <code className="bg-muted px-1 rounded">POST /v1/hsl-data/prune</code> is a single CTE statement: a <code className="bg-muted px-1 rounded">live_member_counts</code> CTE counts <code className="bg-muted px-1 rounded">member_kind = &apos;aio&apos;</code> rows that still resolve to a live <code className="bg-muted px-1 rounded">aio_data.aio_name</code>; a <code className="bg-muted px-1 rounded">doomed</code> CTE selects every HSL whose surviving count is &lt; 2; the outer DELETE removes them, and <code className="bg-muted px-1 rounded">ON DELETE CASCADE</code> sweeps <code className="bg-muted px-1 rounded">hsl_member</code>. The whole operation is atomic under FORCE RLS — no application-level loop, no half-state. Returns <code className="bg-muted px-1 rounded">{`{ pruned: int, names: string[] }`}</code> with the first 50 pruned <code className="bg-muted px-1 rounded">hsl_name</code>s for audit. The frontend Prune HSLs button confirms before invoking.
            </Sub>

            <Sub title="11.4  synth_hsls_for_aio — incremental, per-AIO">
              On every successful <code className="bg-muted px-1 rounded">create_aio_data</code> and <code className="bg-muted px-1 rounded">update_aio_data</code>, the AIO route fires <code className="bg-muted px-1 rounded">synth_hsls_for_aio(conn, tenant, aio_name, elements)</code> before commit. For each <code className="bg-muted px-1 rounded">[Key.Value]</code> pair the AIO carries: if the corresponding HSL exists, the AIO is appended to <code className="bg-muted px-1 rounded">hsl_member</code> idempotently; otherwise the function looks for at least one <em>other</em> AIO in the same tenant carrying the same pair (single indexed LIKE against <code className="bg-muted px-1 rounded">elements_text</code>) and creates the HSL with both members; otherwise it skips the pair as a single-AIO anchor. The call is best-effort — failures are logged but never fail the AIO write — and the function is structured to handle the concurrent-create race via <code className="bg-muted px-1 rounded">ON CONFLICT DO NOTHING</code> followed by re-query and append. The architectural consequence is that Bulk HSL Build is now a <em>recovery tool</em>: in steady state, the topology is correct after every AIO write and the rebuild button is rarely needed.
            </Sub>

            <Sub title="11.5  hsl_member side table — width cap lifted">
              <code className="bg-muted px-1 rounded">hsl_member(hsl_id, member_value, member_kind, tenant_id, created_at)</code> with <code className="bg-muted px-1 rounded">PRIMARY KEY (hsl_id, member_value)</code>, FK to <code className="bg-muted px-1 rounded">hsl_data</code> with <code className="bg-muted px-1 rounded">ON DELETE CASCADE</code>, and FORCE ROW LEVEL SECURITY mirroring <code className="bg-muted px-1 rounded">hsl_data</code>&apos;s policy. <code className="bg-muted px-1 rounded">member_kind</code> is a CHECK-constrained text column (<code className="bg-muted px-1 rounded">&apos;aio&apos;</code> or <code className="bg-muted px-1 rounded">&apos;mro&apos;</code>) so prune can ignore MRO references when computing the surviving floor. Reads of <code className="bg-muted px-1 rounded">HslDataOut</code> now bulk-fetch from this table via <code className="bg-muted px-1 rounded">_members_for_hsls(cur, ids)</code> and pad/truncate to the 100-element wire shape the API contract still exposes; writes dual-write the side table and the legacy <code className="bg-muted px-1 rounded">hsl_element_1..100</code> columns so <code className="bg-muted px-1 rounded">elements_text</code> (migration 016) and the legacy fallback paths in <code className="bg-muted px-1 rounded">chat.py</code> continue to work unchanged. The dual-write is the seam at which a future migration will retire the element columns once all consumers are migrated.
            </Sub>

            <Sub title="11.6  ?as_of=&lt;ISO8601&gt; — point-in-time rebuilds">
              The rebuild query gains a single <code className="bg-muted px-1 rounded">WHERE aio_data.created_at &le; %s</code> clause when <code className="bg-muted px-1 rounded">as_of</code> is supplied. Use cases: (a) reproducing a substrate state at the moment a regression was introduced, (b) auditing a Substrate-mode retrieval against the topology that existed when the MRO was created, (c) rolling back the substrate to a known-good prior state without rolling back the AIO corpus itself. The parameter is echoed in the response for audit; the <code className="bg-muted px-1 rounded">created_at</code> on the resulting HSL rows is still <code className="bg-muted px-1 rounded">now()</code>, so the rebuild itself remains forward-temporal.
            </Sub>

            <Sub title="11.7  What this means for the operator and the substrate">
              The substrate is now a self-maintaining layer. AIO inserts grow it; AIO deletes (followed by Prune HSLs) shrink it; Bulk HSL Build is the reset button when the two have somehow diverged. The trade-secret invariant of §10 is unchanged — the HSL layer is still a deterministic function of the AIO set, computed offline, used at query time as a lookup not a computation. V4.4 simply makes that function continuous in time rather than a periodic batch.
            </Sub>
          </Section>

          <Section num={12} title="Future Roadmap">
            <ol className="list-decimal list-inside space-y-1.5">
              <li>Drop the legacy <code className="bg-muted px-1 rounded">hsl_element_1..100</code> columns from <code className="bg-muted px-1 rounded">hsl_data</code> once <code className="bg-muted px-1 rounded">chat.py</code>&apos;s fallback paths and the <code className="bg-muted px-1 rounded">elements_text</code> generated column have been migrated to read from <code className="bg-muted px-1 rounded">hsl_member</code> directly. Reduces row width by &gt;90% and removes the dual-write from every HSL writer.</li>
              <li>Expose the <code className="bg-muted px-1 rounded">as_of</code> parameter as a UI surface inside the System Admin panel — currently it is reachable only via the API client.</li>
              <li>Periodic background prune as a Postgres extension or a scheduled job, so the operator does not have to remember to click the button after a bulk AIO delete.</li>
              <li>Surface the <code className="bg-muted px-1 rounded">synth_hsls_for_aio</code> counters (appended / created / skipped_single) as per-write telemetry on the AIO insert response, so the operator can watch the substrate grow in real time.</li>
              <li>Multi-tenant aware backfill in migration 023 — the current backfill loops over a single hard-coded tenant and is correct for the demo footprint but will need a per-tenant loop before exposure to multi-tenant production.</li>
            </ol>
          </Section>

          <p className="text-center text-xs text-muted-foreground border-t border-border pt-4 mt-8">
            Prepared by InformationPhysics.ai, LLC. Confidential — subject to the Transaction-Grade One-Way NDA on file. © 2026 InformationPhysics.ai, LLC. All rights reserved.
          </p>
        </article>
      </main>
    </div>
  )
}
