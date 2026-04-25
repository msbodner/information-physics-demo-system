"use client"

import { ArrowLeft, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function PaperIII({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  const Section = ({ num, title, children }: { num: number; title: string; children: React.ReactNode }) => (
    <section className="mb-8">
      <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{num}. {title}</h2>
      <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">{children}</div>
    </section>
  )

  const Sub = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="pl-4 border-l-2 border-primary/30 mb-3">
      <p className="text-sm font-semibold text-foreground mb-1">{title}</p>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">Information Physics Paper III</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <article className="prose prose-sm dark:prose-invert max-w-none">

          <div className="text-center mb-10">
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Information Physics — Paper III</p>
            <h1 className="text-2xl font-bold text-foreground mb-2 text-balance">Precomputed Semantic Substrates for Large Language Models</h1>
            <p className="text-base text-muted-foreground mb-1 italic">Using the AIO / HSL / MRO Pipeline as a Structural Alternative to Retrieval-Augmented Generation and Medallion Gold Curation</p>
            <p className="text-sm font-medium text-foreground mt-4">Michael Simon Bodner, Ph.D.</p>
            <p className="text-xs text-primary">Founder &amp; Chief Scientist, InformationPhysics.ai</p>
            <p className="text-sm text-muted-foreground">April 2026</p>
            <p className="text-xs text-muted-foreground mt-2">© 2026 InformationPhysics.ai. All rights reserved.</p>
          </div>

          <Card className="mb-10">
            <CardHeader><CardTitle className="text-base">Abstract</CardTitle></CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>This paper proposes that the AIO → HSL → MRO pipeline introduced in the prior two Information Physics papers can serve as a direct structural replacement for traditional Retrieval-Augmented Generation (RAG) pipelines and Medallion-style Bronze/Silver/Gold data curation layers when preparing context for Large Language Models such as Claude.</p>
              <p>Where RAG retrieves semantically similar chunks by approximate vector search over a flat corpus, the Information Physics architecture traverses a precomputed topology of shared semantic elements. Where Medallion Gold presents a statically curated, batch-refreshed set of analytic tables, the MRO layer enables recursive, self-enriching episodic memory that is updated by every successful query.</p>
              <p>We describe the layer-by-layer mapping, the mathematical differences between traversal-based retrieval and similarity-based retrieval, and a concrete five-step procedure for assembling Claude-ready context bundles. This procedure is now implemented in the AIO/HSL/MRO Demo System V4.1 ChatAIO &quot;Substrate&quot; mode.</p>
            </CardContent>
          </Card>

          <Section num={1} title="Introduction: From RAG to Substrate-Augmented Cognition">
            <p>The first two Information Physics papers argued that enterprise information should be stored as measurement-bound, context-preserving objects (AIOs), that shared semantic elements form a relational topology (the Hyper-Semantic Layer), and that successful retrieval episodes should themselves be preserved as derived objects (Memory Result Objects).</p>
            <p>This paper addresses a different question: given that the full pipeline exists, how should its output be consumed by a Large Language Model? The dominant approach is Retrieval-Augmented Generation, typically fed by a Medallion-style data pipeline. We argue that the Information Physics pipeline is a direct structural replacement for both — with specific mathematical advantages at each layer.</p>
          </Section>

          <Section num={2} title="The Medallion Pattern and Traditional RAG">
            <p>The Medallion architecture is a three-tier curation pattern: Bronze (raw), Silver (cleaned and enriched), Gold (curated analytic objects). RAG then operates over the Gold layer by embedding chunks, doing approximate nearest-neighbor search, and stuffing top-k results into the LLM window.</p>
            <p>Known failure modes: Bronze-to-Silver transformations discard context not anticipated as useful; Silver-to-Gold curation embeds current assumptions into the schema; chunking breaks semantic coherence; embedding compresses meaning into a fixed vector space; cosine similarity is approximate by definition; provenance is frequently lost at the chunking stage.</p>
          </Section>

          <Section num={3} title="AIO as Bronze plus Silver: Encoding-Specific Preservation">
            <p>When csvToAio processes a source row, raw values are preserved exactly (Bronze) and each value is bound at capture to its semantic key (Silver). Metadata prefix fixes origin, date, time. Two Medallion tiers collapsed into a single ingestion operation.</p>
            <Sub title="3.1 Preserve-first and self-description">Each measurement is stored with its descriptors. No external schema required.</Sub>
            <Sub title="3.2 Record-aligned chunking">The AIO boundary is the record boundary — no straddling, no splitting.</Sub>
            <Sub title="3.3 Lossless downstream instrumentation">The same AIO supports lexical, vector, structured, and compound measurement without re-ingestion.</Sub>
            <Sub title="3.4 Traceable lineage">Every HSL, MRO, or LLM response can point back to the exact contributing AIO.</Sub>
          </Section>

          <Section num={4} title="HSL as Gold: Precomputed Topology Instead of Batch Curation">
            <p>An HSL record is a materialized semantic neighborhood — the precomputed set of all AIOs that share a specific element value. Built once at ingestion; retrieval is graph traversal, not vector search.</p>
            <div className="p-3 rounded-lg bg-muted font-mono text-xs whitespace-pre my-3">
{`RAG over Medallion Gold:
  Query → embed(q) → cosine(q_vec, chunk_vecs ∀ chunks) → top_k
  Cost:  O(n) in corpus size, per query.
  Match: approximate, single metric.

HSL traversal:
  Query → parse_cue → match_elements(cue, HSL_index)
        → traverse(HSL, elements, bounded_radius) → subgraph
  Cost:  O(k) where k is neighborhood size.
  Match: exact on selected semantic dimensions.`}
            </div>
            <p>The performance difference is a change in algorithmic class, not a constant-factor improvement.</p>
          </Section>

          <Section num={5} title="MRO as Self-Enriching Gold: Recursive Episodic Curation">
            <p>Every successful retrieval-and-inference event produces a derived object:</p>
            <div className="p-3 rounded-lg bg-muted font-mono text-xs my-3">MRO_t = ⟨ Q_t, S_t, C_t, O_t, R_t, P_t, L_t ⟩</div>
            <p>Persisted back into the HSL, the MRO lets the Gold tier curate itself through use rather than through scheduled ETL. Each MRO carries four governance controls:</p>
            <Sub title="5.1 Source lineage">Explicit links to contributing AIOs and HSLs; never standalone.</Sub>
            <Sub title="5.2 Validity scope">Role and domain boundaries enforced.</Sub>
            <Sub title="5.3 Freshness metadata">Time-based decay as the corpus evolves.</Sub>
            <Sub title="5.4 Admissibility">Retrieval accelerator, not truth object; AIOs remain the grounding layer.</Sub>
          </Section>

          <Section num={6} title="The Five-Step Procedure (now live in ChatAIO Substrate Mode)">
            <p>Click the purple <strong>Substrate</strong> button in ChatAIO to invoke this pipeline end-to-end:</p>
            <Sub title="Step 1 — Cue extraction">Parse the natural-language query into the cue set K ⊂ E × (V ∪ {"{"}*{"}"}) using the Information Elements directory and the AIO value vocabulary.</Sub>
            <Sub title="Step 2 — HSL traversal">Compute the bounded neighborhood N(K) as the set intersection of per-cue AIO sets (Compound HSL).</Sub>
            <Sub title="Step 3 — MRO pre-fetch">Rank prior MROs by Jaccard(K_m, K) × freshness(t_m) × confidence; surface top-N as priors.</Sub>
            <Sub title="Step 4 — Context bundle assembly">Serialize into tiered prompt: MRO priors (framing) → HSL neighborhoods (relational context) → AIO evidence (grounding) → query.</Sub>
            <Sub title="Step 5 — MRO capture">Persist the query, cues, traversal path, and response as a new MRO linked back to contributing HSLs.</Sub>
          </Section>

          <Section num={7} title="Implementation in V4.1">
            <p>The Substrate mode is implemented in three new modules:</p>
            <Sub title="lib/aio-math.ts">Core mathematics: cue extraction, HSL traversal (set intersection), Jaccard similarity, exponential freshness decay, MRO ranking, and tiered bundle assembly.</Sub>
            <Sub title="lib/aio-chat-pipeline.ts">Orchestration layer: runs the five-step pipeline end-to-end, calls Claude with the assembled bundle, and persists the captured MRO.</Sub>
            <Sub title="components/chat-aio-dialog.tsx">UI integration: the purple Substrate button invokes the pipeline; response metadata shows cue count, neighborhood size, priors used, and MRO-save status.</Sub>
            <p>See the <strong>Mathematics Reference</strong> in the System Admin → Documentation menu for the full technical specification of every operation.</p>
          </Section>

          <Section num={8} title="Conclusion">
            <p>Traditional RAG fed by Medallion curation is workable but lossy. The AIO/HSL/MRO architecture implements the same function on different structural principles: encoding-specific capture, precomputed topology, recursive episodic enrichment. The substrate is exact on the dimensions that matter, bounded in per-query cost, fully provenant, and self-improving through use.</p>
            <p>With V4.1 and Substrate Mode, the substrate is now live. Claude reads from it natively.</p>
          </Section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">References</h2>
            <ul className="space-y-2 text-xs text-muted-foreground">
              <li>Bodner, M. S. (2026). <em>Inherent Contextual Basis for the Definition of Associated Information Objects as the Basic Quantum Particle of Information Physics</em>. InformationPhysics.ai.</li>
              <li>Bodner, M. S. (2026). <em>Memory Result Objects as Derived Episodic Particles of Information Physics</em>. InformationPhysics.ai.</li>
              <li>Tulving, E., &amp; Thomson, D. M. (1973). Encoding specificity and retrieval processes in episodic memory. <em>Psychological Review</em>, 80(5), 352–373.</li>
              <li>Howard, M. W., &amp; Kahana, M. J. (2002). A distributed representation of temporal context. <em>Journal of Mathematical Psychology</em>, 46(3), 269–299.</li>
              <li>Zwaan, R. A., &amp; Radvansky, G. A. (1998). Situation models in language comprehension and memory. <em>Psychological Bulletin</em>, 123(2), 162–185.</li>
              <li>Lewis, P., Perez, E., Piktus, A., et al. (2020). Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks. <em>NeurIPS 2020</em>.</li>
            </ul>
          </section>

          <p className="text-center text-xs text-muted-foreground border-t border-border pt-4">
            © 2026 InformationPhysics.ai — All rights reserved
          </p>
        </article>
      </main>
    </div>
  )
}
