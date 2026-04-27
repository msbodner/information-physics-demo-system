"use client"

import { ArrowLeft, Settings, ShieldAlert, Search, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"

export function SearchModesTechnote({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const Section = ({ num, title, children }: { num: number; title: string; children: React.ReactNode }) => (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{num}. {title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  )

  const Sub = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="pl-4 border-l-2 border-indigo-500/40 mb-3">
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
            <h1 className="text-lg font-bold text-foreground">Technical Notes — Live Search vs. Recall Search</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <article className="prose prose-sm dark:prose-invert max-w-none">

          {/* Confidential banner */}
          <div className="border-2 border-indigo-500/60 bg-indigo-50 dark:bg-indigo-950/20 rounded-lg p-4 mb-8 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-indigo-700 dark:text-indigo-400 mb-1">CONFIDENTIAL — TRADE SECRET</p>
              <p className="text-indigo-700/80 dark:text-indigo-300/80 leading-relaxed">
                This document describes the internal retrieval architecture, performance characteristics,
                and operational tradeoffs of two proprietary subsystems of the Information Physics Demo System.
                It contains confidential information and trade secrets of InformationPhysics.ai, LLC, including
                algorithmic detail not present in public-facing materials. Subject to the Transaction-Grade
                One-Way Non-Disclosure Agreement on file. Unauthorized use, disclosure, or reproduction is
                strictly prohibited.
              </p>
            </div>
          </div>

          <p className="text-sm text-muted-foreground italic mb-6">
            Document version: V4.4 · Status: Internal Reference · Audience: engineering, technical buyers
          </p>

          <Section num={0} title="Summary">
            <p>
              ChatAIO ships two retrieval modes that share the same substrate (AIOs + HSLs + MROs) but
              differ in <em>who assembles context</em> and <em>whether memory is used</em>. Both terminate
              in a Claude synthesis call; the work upstream is what differs.
            </p>

            <div className="overflow-x-auto my-4 not-prose">
              <table className="w-full text-sm border border-border">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold">Dimension</th>
                    <th className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <Search className="w-4 h-4 text-emerald-600" />Live Search
                      </span>
                    </th>
                    <th className="px-3 py-2 font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <Brain className="w-4 h-4 text-purple-600" />Recall Search
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Former name</td>
                    <td className="px-3 py-2">AIO Search</td>
                    <td className="px-3 py-2">Substrate Mode / Substrate Chat</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Endpoint</td>
                    <td className="px-3 py-2 font-mono text-xs">POST /v1/op/aio-search<br />POST /v1/op/aio-search/stream</td>
                    <td className="px-3 py-2 font-mono text-xs">POST /v1/op/substrate-chat<br />POST /v1/op/substrate-chat/stream</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Who assembles context</td>
                    <td className="px-3 py-2">Server (four-phase algebra)</td>
                    <td className="px-3 py-2">Client (substrate envelope)</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Uses MRO priors?</td>
                    <td className="px-3 py-2">No — fresh each query</td>
                    <td className="px-3 py-2 font-semibold">Yes — ranked by Jaccard × freshness × confidence</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">MRO behavior</td>
                    <td className="px-3 py-2">Manual save (&ldquo;Save MRO&rdquo; button)</td>
                    <td className="px-3 py-2">Auto-persists every answer as a new MRO</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Caches</td>
                    <td className="px-3 py-2">Answer cache, parse cache</td>
                    <td className="px-3 py-2">None today (every call hits Claude)</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Quality logging</td>
                    <td className="px-3 py-2 font-semibold">Yes — <code className="text-xs">aio_search_quality</code></td>
                    <td className="px-3 py-2">Not yet (planned)</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-foreground">Best for</td>
                    <td className="px-3 py-2">One-off lookups, audit-style queries, demo flows</td>
                    <td className="px-3 py-2">Conversational sessions, repeat-question workloads</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section num={1} title="When to use which">
            <Sub title="Pick Live Search when…">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li>The user asks a precise, evidence-grounded question (&ldquo;what activities happened in the kitchen on March 12?&rdquo;).</li>
                <li>You want a single, cited answer with no behavioral state — same query → same answer (modulo cache invalidation).</li>
                <li>You&rsquo;re running a demo and want predictable, replayable behavior.</li>
                <li>You care about per-query latency and cost telemetry — Live Search is the only mode currently logged.</li>
              </ul>
            </Sub>
            <Sub title="Pick Recall Search when…">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li>The user is exploring — multiple related questions in one session.</li>
                <li>The corpus has accumulated MROs from prior sessions and you want them reused as priors.</li>
                <li>You want every answer to compound future answers — Recall auto-persists each response as an MRO with provenance.</li>
                <li>The query is open-ended (&ldquo;summarize what we know about Project Atlas&rdquo;) where memory of prior summaries materially helps.</li>
              </ul>
            </Sub>
            <p className="text-xs italic mt-3">
              Heuristic: Live Search optimizes for <strong>precision per query</strong>; Recall Search optimizes for
              <strong> precision per session</strong>. If your user will ask one thing and leave, prefer Live. If they
              will ask five things and the fourth depends on the first, prefer Recall.
            </p>
          </Section>

          <Section num={2} title="Live Search — architecture">
            <p>
              Live Search is the original four-phase algebra. The client sends a single query string;
              the server runs the entire pipeline and returns a cited answer.
            </p>

            <Code>{`Client                 Server (FastAPI + Postgres + Anthropic)
──────                 ────────────────────────────────────────
query ──▶  Phase 1: Parse        (Anthropic Sonnet)
                  └─▶ extract bracket cues [Key.Value]
                       (parse-cache: skip if seen)
              │
           Phase 2: Match HSLs   (Postgres pg_trgm GIN + refs)
                  └─▶ field-aware probe → equality → substring
                       → elements_text → name ILIKE → element fallback
              │
           Phase 3: Gather AIOs  (Postgres + density-aware cap)
                  └─▶ inverted index on information_element_refs
                       adaptive cap tightens when density > 200
              │
           Phase 4: Synthesize   (Anthropic Sonnet)
                  └─▶ system prompt + cued AIO context
              │
           Citation post-pass    (lightweight token scan)
                  └─▶ "sources_used: N of M"
              ◀── reply, search_terms, sources, cache flags`}</Code>

            <Sub title="Caches">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li><strong>Answer cache</strong> — keyed by <code className="text-xs">sha256(mode|tenant|normalized_query)</code>. Exact-match short-circuits the entire pipeline.</li>
                <li><strong>Parse cache</strong> — same hash discriminator under mode <code className="text-xs">aio-search-parse</code>. Short-circuits Phase 1 only when the query body is identical but other inputs differ.</li>
                <li>Both are tenant-scoped via RLS; both use the <code className="text-xs">query_cache</code> table (migration 020).</li>
              </ul>
            </Sub>

            <Sub title="Knobs (env-tunable, no restart needed)">
              <ul className="list-disc list-inside space-y-1 mt-1">
                <li><code className="text-xs">AIO_SEARCH_HSL_CAP</code> · default 500 — max HSLs returned by Phase 2.</li>
                <li><code className="text-xs">AIO_SEARCH_AIO_CAP</code> · default 400 — max AIOs gathered by Phase 3.</li>
                <li><code className="text-xs">AIO_SEARCH_DENSITY_AWARE_CAP</code> · default off — when on, tightens AIO cap if matches/cue &gt; 200.</li>
                <li><code className="text-xs">AIO_SEARCH_PARSE_MODEL</code> · model used for Phase 1.</li>
                <li><code className="text-xs">AIO_SEARCH_LOG_QUALITY</code> · gates per-query telemetry into <code className="text-xs">aio_search_quality</code>.</li>
              </ul>
            </Sub>
          </Section>

          <Section num={3} title="Recall Search — architecture">
            <p>
              Recall Search inverts the contract: the <em>client</em> assembles a substrate envelope
              (HSL gating + MRO priors + needle-matched AIOs) and ships it as a single context bundle.
              The server passes the bundle to Claude with minimal additional logic. This is the
              full Paper III pipeline, exposed as a chat endpoint.
            </p>

            <Code>{`Client (Next.js)                     Server
────────────────                     ──────
query ──▶  Cue extraction (deterministic, client-side)
              │
           HSL traversal: N(K) = ⋂ H(k)
              │   POST /v1/hsl-data/find-by-needles
              │
           MRO pre-fetch + ranking
              │   POST /v1/op/mro-search
              │   rank: Jaccard(cues) × freshness × confidence × trust_score
              │
           AIO needle-match
              │   POST /v1/aio-data/find-by-needles
              │
           Bundle assembly (tiered: priors → cued AIOs → HSLs)
              │
              └──▶ POST /v1/op/substrate-chat
                          │
                          ├─▶ Anthropic Sonnet (system + bundle)
                          │
                          └─▶ MRO write-back (auto-persist new MRO)
              ◀── reply + bundle metadata + new MRO id`}</Code>

            <Sub title="Why client-side assembly?">
              <p className="mt-1">
                The client already holds the corpus snapshot loaded when ChatAIO opens (AIOs, HSLs, MRO cache),
                so it can do cue extraction and bundle assembly without a server round-trip per phase. This
                also means the bundle is <em>auditable</em> — what the client sent is exactly what Claude saw,
                visible in the network tab. Server-side assembly (as in Live Search) hides that envelope.
              </p>
            </Sub>

            <Sub title="MRO priors — the &ldquo;memory&rdquo; in memory-augmented">
              <p className="mt-1">
                Each prior MRO is scored on three axes: <strong>Jaccard overlap</strong> of its stored cue
                set vs. the new query&rsquo;s cues; <strong>freshness</strong> (recency-weighted); and the MRO&rsquo;s
                own <strong>confidence × trust_score</strong> (the latter bumped each time a downstream answer
                cites it). The top-K priors are inlined into the bundle as a tier above the raw AIOs, so
                Claude can reference past answers by their MRO id when relevant. This is what makes Recall
                <em> get smarter over time</em>: every answer becomes a future prior.
              </p>
            </Sub>
          </Section>

          <Section num={4} title="Performance characteristics">
            <p>
              Live baseline against <code className="text-xs">tenantA</code> with the AIO_SEARCH_LOG_QUALITY
              flag on (V4.4 P13 quality logger). Numbers refresh in System Admin → Live Search Stats.
            </p>

            <div className="overflow-x-auto my-4 not-prose">
              <table className="w-full text-sm border border-border">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold">Phase</th>
                    <th className="px-3 py-2 font-semibold text-right">p50</th>
                    <th className="px-3 py-2 font-semibold text-right">p95</th>
                    <th className="px-3 py-2 font-semibold">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium">Parse (LLM)</td>
                    <td className="px-3 py-2 text-right font-mono">~870 ms</td>
                    <td className="px-3 py-2 text-right font-mono">~2.5 s</td>
                    <td className="px-3 py-2 text-xs">Bypassed by parse-cache on repeat queries.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium">Retrieval</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">~90 ms</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700 dark:text-emerald-400">~130 ms</td>
                    <td className="px-3 py-2 text-xs">Index-driven; no longer the bottleneck after V4.4 P1–P9.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2 font-medium">LLM (synthesis)</td>
                    <td className="px-3 py-2 text-right font-mono">~3.5 s</td>
                    <td className="px-3 py-2 text-right font-mono">~6.4 s</td>
                    <td className="px-3 py-2 text-xs">Dominates total. Anthropic-side, not optimizable here.</td>
                  </tr>
                  <tr className="border-t border-border bg-muted/40">
                    <td className="px-3 py-2 font-semibold">Total</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">~5.0 s</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">~8.4 s</td>
                    <td className="px-3 py-2 text-xs">Answer cache hit: ~150 ms (skips everything).</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <Sub title="Recall Search — qualitative">
              <p className="mt-1">
                Recall Search isn&rsquo;t logged into <code className="text-xs">aio_search_quality</code> yet, so
                no baseline numbers are published. Qualitatively: client-side bundle assembly adds 200–400 ms
                of round-trips (HSL find → MRO search → AIO find), which is offset by skipping the server-side
                Phase-1 LLM parse (Recall extracts cues deterministically client-side). Net total per query is
                in the same range as Live Search, but Recall always pays the LLM synthesis cost — there&rsquo;s no
                answer cache today.
              </p>
            </Sub>

            <Sub title="Read for the perf roadmap">
              <p className="mt-1">
                Retrieval is solved (~90 ms p50). The pipeline is dominated by LLM I/O — parse (~17%) +
                synthesis (~70%) is ~88% of total. Useful next moves target <strong>cache uptake</strong>
                (parse cache + answer cache) rather than retrieval algorithms. HNSW or two-stage retrieval
                would optimize the 2% phase and double LLM cost — explicitly deferred until quality logging
                shows a problem worth solving.
              </p>
            </Sub>
          </Section>

          <Section num={5} title="MRO behavior — the lineage difference">
            <p>
              Both modes can produce MROs, but the contract differs and this matters for downstream
              accountability.
            </p>
            <Sub title="Live Search">
              <p className="mt-1">
                MRO creation is <strong>opt-in</strong>. The user clicks &ldquo;Save MRO&rdquo; on a response they
                want to preserve. The MRO is created from the matched HSL ids and is linked back to those
                exact HSLs via <code className="text-xs">/v1/hsl-data/{"{id}"}/link-mro</code>. This produces
                clean lineage: every saved MRO has an explicit, audited HSL provenance.
              </p>
            </Sub>
            <Sub title="Recall Search">
              <p className="mt-1">
                MRO creation is <strong>automatic</strong>. Every Recall response writes a new MRO with
                its full bundle, the cues used, the prior MROs cited, and the synthesized result. The next
                query can then pick this MRO up as a prior. This is what makes Recall recursive — it&rsquo;s
                not just &ldquo;answer the question,&rdquo; it&rsquo;s &ldquo;answer the question and add the answer to the
                substrate.&rdquo; The cost is volume: a chatty session can produce dozens of MROs, some of
                which are low-confidence.
              </p>
            </Sub>
            <p className="text-xs italic mt-3">
              Operational tip: if MRO clutter becomes an issue under heavy Recall use, the right lever is
              <strong> trust_score decay</strong> (low-trust MROs drop out of the prior pool naturally), not
              wholesale deletion.
            </p>
          </Section>

          <Section num={6} title="Observability today vs. planned">
            <p>
              Quality and timing telemetry exists for Live Search via the V4.4 P13 logger
              (<code className="text-xs">aio_search_quality</code> table, migration 024). The data is
              gated by <code className="text-xs">AIO_SEARCH_LOG_QUALITY=1</code> and surfaced in the
              admin <strong>Live Search Stats</strong> pane (V4.4 P15) which polls
              <code className="text-xs"> /v1/aio-search/stats</code> every 30 s.
            </p>
            <p>
              Recall Search is not yet logged into the same table. The natural next step is a sibling
              table or a <code className="text-xs">mode</code> column extension that captures bundle
              size, prior count, MRO write latency, and Claude tokens — at which point the Stats pane
              can render Live + Recall side by side.
            </p>
          </Section>

          <Section num={7} title="Naming history">
            <p>
              Until V4.4 these modes were called <strong>AIO Search</strong> and <strong>Substrate Mode</strong>.
              Both names were paper-anchored or acronym-driven and didn&rsquo;t convey the user-visible
              difference. The rename to <strong>Live Search</strong> / <strong>Recall Search</strong>:
            </p>
            <ul className="list-disc list-inside space-y-1 mt-1">
              <li>preserves all endpoint paths, env vars, table names, mode column values, and code symbols (zero-downtime change),</li>
              <li>updates only the user-facing labels in ChatAIO, the Stats pane, and the in-app guides,</li>
              <li>retains the original names in Paper III, the Bulk HSL technote, and other paper/implementation references where they tie to the literature.</li>
            </ul>
            <p className="text-xs italic mt-3">
              When reading server logs or DB rows, expect to see <code className="text-xs">mode=&apos;aio-search&apos;</code>
              or <code className="text-xs">mode=&apos;aio-search-stream&apos;</code> — those are the on-the-wire identifiers
              for what users now click as &ldquo;Live Search.&rdquo;
            </p>
          </Section>

          <Section num={8} title="Decision matrix — quick reference">
            <div className="overflow-x-auto my-4 not-prose">
              <table className="w-full text-sm border border-border">
                <thead className="bg-muted">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-semibold">Scenario</th>
                    <th className="px-3 py-2 font-semibold">Mode</th>
                    <th className="px-3 py-2 font-semibold">Why</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">First query of a fresh session, narrow factual ask</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-400">Live</td>
                    <td className="px-3 py-2 text-xs">No priors to leverage; latency + cost telemetry available.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">Follow-up question that depends on prior answer</td>
                    <td className="px-3 py-2 font-semibold text-purple-600">Recall</td>
                    <td className="px-3 py-2 text-xs">Prior MROs are the cheapest and most accurate context.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">Audit / compliance — &ldquo;show me what was used to answer this&rdquo;</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-400">Live</td>
                    <td className="px-3 py-2 text-xs">Citations + linked HSLs give clean lineage on save.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">Repeated identical query (cache check)</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-400">Live</td>
                    <td className="px-3 py-2 text-xs">Answer cache returns in ~150 ms; Recall always re-synthesizes.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">Open-ended &ldquo;summarize&rdquo; over an evolving corpus</td>
                    <td className="px-3 py-2 font-semibold text-purple-600">Recall</td>
                    <td className="px-3 py-2 text-xs">Earlier summary MROs become priors for the next pass.</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">Demo / replayability matters</td>
                    <td className="px-3 py-2 font-semibold text-emerald-700 dark:text-emerald-400">Live</td>
                    <td className="px-3 py-2 text-xs">Recall&rsquo;s priors mutate the substrate — same query, different answer over time.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <p className="text-xs text-muted-foreground italic mt-10 pt-6 border-t border-border">
            End of document · For implementation details see <code className="text-xs">api/routes/chat.py</code>
            (<code className="text-xs">aio_search</code>, <code className="text-xs">substrate_chat</code>),
            <code className="text-xs">api/search_quality.py</code>, and migration <code className="text-xs">024_aio_search_quality.sql</code>.
          </p>

        </article>
      </main>
    </div>
  )
}
