"use client"

import { ArrowLeft, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export function AIOReferencePaper({ onBack, onSysAdmin }: { onBack: () => void; onSysAdmin: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2"><ArrowLeft className="w-4 h-4" />Back</Button>
            <h1 className="text-lg font-bold text-foreground">AIO Reference Paper</h1>
          </div>
          <Button variant="outline" size="sm" onClick={onSysAdmin} className="gap-2"><Settings className="w-4 h-4" />System Admin</Button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-6 py-10">
        <article className="prose prose-sm dark:prose-invert max-w-none">

          <div className="text-center mb-10">
            <h1 className="text-2xl font-bold text-foreground mb-2 text-balance">Inherent Contextual Basis for the Definition of Associated Information Objects as the Basic Quantum Particle of Information Physics</h1>
            <p className="text-base text-muted-foreground mb-1">Expanded: Hyper-Semantic Layer Strings, Precomputation, and a New Substrate for LLM/ML</p>
            <p className="text-sm font-medium text-foreground mt-4">Michael Simon Bodner, Ph.D.</p>
            <p className="text-sm text-muted-foreground">February 2026</p>
            <p className="text-xs text-muted-foreground mt-2">{"© 2026 Michael Simon Bodner. All rights reserved."}</p>
          </div>

          <Card className="mb-10">
            <CardHeader><CardTitle className="text-base">Abstract</CardTitle></CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>This paper introduces a cognitive-theory-grounded basis for defining the Associated Information Object (AIO) as the basic "quantum particle" of Information Physics. The central claim is that information systems should store and operate on observations as bounded, inherently contextual objects -- more like human episodic memory -- rather than as decontextualized tables optimized for predefined queries.</p>
              <p>{"We argue that the AIO is application-agnostic not by omission of structure, but because its structure is derived directly from the act of measurement: the binding of observed values to their semantic descriptors at the moment of capture. We then connect AIO behavior to established ideas in cognitive science: encoding specificity, context-dependent memory, temporal context models, and situation model theory."}</p>
              <p>{"We further propose that this cognitive, inherently contextual architecture leads naturally to a hyper-semantic layer (HSL): an information-universe model in which AIOs are \"particles\" linked by HSL \"strings\" (threads) that encode shared semantic elements, relations, and contextual proximity. In this architecture, most compute is shifted to ingestion -- where strings are formed -- so that downstream question answering and reporting can recover relevant context by traversing strings rather than repeatedly recomputing joins, searches, or large-scale embedding scans."}</p>
              <p>{"The result is a new substrate for LLM/ML systems: one that reduces repeated inference-time work, increases auditability, and enables cognition-like associative retrieval. Performance gains depend on workload and implementation, but the core premise is structural: precomputed linkage converts expensive repeated discovery into inexpensive retrieval over prepared semantic structure."}</p>
            </CardContent>
          </Card>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">1. Introduction: From Tables to Observations</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Most enterprise data architectures begin with a simplifying assumption: information should be stored in normalized tables and optimized for known query workloads. That assumption performs a form of compression: it projects rich observations into rigid schemas, discarding context that is not immediately needed.</p>
              <p>Human cognition does not work this way. A lived observation is stored as an integrated episode: a structured whole whose components remain bound together by the context in which they were perceived. Later, a partial cue can evoke the larger episode without requiring an explicit query plan or predefined join path.</p>
              <p>Information Physics adopts this cognitive stance: preserve observations as objects first, and treat queries as measurements applied later.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">2. The Cognitive Analogy: Observation as a Stored Object</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Consider the following example: you see a woman ride by on a bicycle wearing a retro University of Michigan blue shirt. You do not store this as a row in a table. You store it as an event: a unified memory that includes the shirt, the bicycle, the person, the motion, the weather, the location, and your own internal state.</p>
              <p>Later, you encounter a retro University of Michigan shirt again. Without running a search algorithm, your mind may "remember" the earlier episode -- often bringing back multiple linked elements (bicycle, location, weather, person) as a coherent bundle.</p>
              <p>This phenomenon is consistent with cognitive theories in which retrieval is cue-driven and context-dependent: cues are effective when they overlap with the conditions present during encoding, and remembered events carry contextual traces that support later reconstruction.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">3. Defining the AIO as a Measurement-Bound Object</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"An Associated Information Object (AIO) is a minimal, self-describing record-object produced by a measurement act. Its defining feature is explicit binding: each value is stored together with the semantic label that described it at capture time."}</p>
              <p>This yields a preserve-first representation in which the observation remains interpretable even when downstream applications, schemas, and query needs change.</p>
              <p>{"AIOs are not \"schema-free.\" Rather, they carry the schema that was present at the time of measurement, embedded locally in the object itself. This is the basis for application agnosticism: the object is not committed to any single future schema, but it retains the semantic bindings necessary to support many future interpretations."}</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">4. Deriving AIO Properties from the Construct of Creation</h2>
            <p className="text-sm leading-relaxed text-muted-foreground mb-4">This section derives core AIO properties from the fact that AIOs are created as measurement objects.</p>
            <div className="space-y-4">
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.1 Preserve-first and self-description</p>
                <p className="text-sm text-muted-foreground">Because the measurement is stored with its descriptors, the object remains meaningful without external schema lookup.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.2 Late-binding interpretability</p>
                <p className="text-sm text-muted-foreground">Because bindings are local, the same AIO can be re-indexed, re-clustered, and re-projected as questions evolve.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.3 Traceable provenance</p>
                <p className="text-sm text-muted-foreground">If every transformation produces new derived objects rather than overwriting originals, the system can maintain lineage consistent with audit and governance needs.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.4 Multi-instrument measurability</p>
                <p className="text-sm text-muted-foreground">AIOs can be measured with different instruments over time (lexical retrieval, vector similarity, structured projections, estimation), without reconstructing the original ingestion pipeline.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">4.5 Context preservation</p>
                <p className="text-sm text-muted-foreground">By storing multiple attributes of an observation together, the AIO preserves co-occurrence relationships that are often lost when information is split across tables or extracted into narrow features.</p>
              </div>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">5. Cognitive Theory Grounding</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Information Physics does not reject ML or LLMs; it rejects the idea that the storage substrate must be optimized primarily for pattern recognition or keyword search. Instead, it adopts a cognitive model: store observations as contextual objects and let retrieval emerge from the overlap between cues and stored context.</p>
            </div>
            <div className="space-y-4 mt-4">
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.1 Encoding specificity and cue overlap</p>
                <p className="text-sm text-muted-foreground">The encoding specificity principle emphasizes that what is stored during encoding determines which cues will be effective at retrieval; matching retrieval cues to encoded context improves access to episodic traces.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.2 Context-dependent memory</p>
                <p className="text-sm text-muted-foreground">Work in context-dependent memory demonstrates that recall can depend on the match between learning and retrieval environments, supporting the notion that contextual traces are part of what is stored.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.3 Temporal context models</p>
                <p className="text-sm text-muted-foreground">Models such as the Temporal Context Model treat context as a drifting representation that becomes associated with items and then serves as a powerful cue for sequential and associative retrieval.</p>
              </div>
              <div className="pl-4 border-l-2 border-primary/30">
                <p className="text-sm font-semibold text-foreground mb-1">5.4 Situation model theory</p>
                <p className="text-sm text-muted-foreground">Situation model research argues that people form integrated representations of events or states of affairs; these representations support comprehension and later memory retrieval in ways that differ from retrieval over decontextualized propositions.</p>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground mt-4">These strands converge on a practical implication: a system that preserves contextual bindings at the object level can support retrieval that resembles human recollection -- cueing a whole episode from a partial match.</p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{"6. AIOs as the \"Quantum Particle\" of Information Physics"}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"In physics, a particle is a minimal unit that participates in larger structures and interactions. In Information Physics, the AIO plays an analogous role: it is the minimal unit of preserved observation that can be linked, clustered, transformed, and measured while retaining identity and context."}</p>
              <p>{"Calling the AIO a \"quantum particle\" is not a claim of literal quantum mechanics. It is a claim about granularity and composability: the AIO is the smallest practical unit that still contains meaningful contextual structure, and larger informational phenomena (threads, neighborhoods, boundaries) are built from interactions among these units."}</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">7. From Inherent Context to a Hyper-Semantic Layer (HSL)</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>If AIOs are preserved as contextual particles, the next architectural step is almost forced: build an explicit relational substrate that mirrors associative recall. This substrate is the Hyper-Semantic Layer (HSL).</p>
              <p>The HSL is not merely an index. It is a topology: an overlay structure that captures how AIOs relate through shared information elements, semantic equivalence, entity identity, temporal proximity, and domain constraints.</p>
              <p>In cognitive terms, HSL is the engineered analogue of the associative structure that forms between episodic memories. When a cue appears, retrieval occurs by traveling the associative structure -- not by re-running a full search over all experiences.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{"8. HSL \"Strings\": Threads as the Basis of Information Recovery"}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"We define an HSL \"string\" as a durable connective structure that ties AIOs together via common information elements or semantically equivalent elements (e.g., the same vendor, invoice number, project, location, clause, part number, or concept)."}</p>
              <p>A string can be understood as a governed, versioned, auditable link set. It may be explicit (declared) or inferred (computed under controlled operators).</p>
              <p>Strings can be layered: element-level strings (exact header/value matches), entity-level strings (resolved identity), semantic strings (embedding similarity neighborhoods), temporal strings (adjacency and sequence), and policy/domain strings (allowed connection surfaces).</p>
              <p>In the information-universe metaphor: AIOs are particles; strings are the relational fabric that allows information energy (query intent) to propagate through the universe to recover relevant context.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">{"9. Shifting Compute to Ingestion: \"Pay Once, Use Many Times\""}</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Traditional analytics pays repeatedly: each question triggers new joins, filters, scans, and retrieval operations that rediscover structure already implicit in the data.</p>
              <p>In an HSL-first architecture, most of the expensive work is performed at ingestion and enrichment time: canonicalization (e.g., header unification), entity resolution, embedding generation, clustering, link inference, and string construction.</p>
              <p>Once strings exist, information recovery is less about discovery and more about traversal: starting from a cue (a header/value, entity, semantic neighborhood, or seed object) and expanding along strings within a bounded radius and policy scope.</p>
              <p>This does not eliminate compute; it changes its timing and reuse. The benefit is that repeated questions reuse precomputed structure, reducing repeated inference-time work.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">10. Implications for LLM/ML: A New Substrate Rather than a New Model</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>{"Most current LLM/ML enterprise deployments treat the world as a flat corpus that must be searched repeatedly at inference time. This drives compute into every question: embedding search, reranking, prompt assembly, repeated extraction, and repeated summarization."}</p>
              <p>{"In the HSL model, LLMs and ML models become measurement instruments operating on an already-structured information universe. The retrieval step is no longer \"find needles in a haystack\" but \"follow the relevant strings.\""}</p>
              <p>This changes the optimization target: instead of maximizing inference-time retrieval over unstructured stores, we maximize ingestion-time formation of high-quality strings and auditable link structure.</p>
              <p>LLMs become more reliable because they are grounded in explicitly recovered context bundles (the connected subgraph), and governance improves because every traversal and derived answer can point back to the exact contributing AIOs and strings.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">11. Performance and Cost Claims: Why Compute Can Drop Dramatically</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>The claim is not that physics magic happens. The claim is that precomputing relational structure turns repeated discovery into retrieval. Under typical enterprise workloads (where many questions are variations on recurring business entities and processes), this can reduce repeated work substantially.</p>
              <p>{"Qualitatively: instead of scanning or embedding-searching across the entire repository for each query, the system begins from a small set of cues and expands along precomputed strings -- often operating on orders of magnitude fewer candidate objects."}</p>
              <p>In practice, the reduction depends on how well the strings capture the domain's true connectivity (invoice-to-PO-to-vendor, project-to-cost-code-to-contract, etc.), and on how effectively locality constraints bound traversal (time windows, domain scopes, graph radius).</p>
              <p>The architecture therefore offers a principled path toward large decreases in per-query compute and latency for many operational analytics tasks -- particularly reporting, reconciliation, and context-rich Q&A.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">12. Conclusion</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>The Associated Information Object is best understood as a measurement-bound, context-preserving unit of observation. Its application agnosticism is a direct consequence of how it is created: it retains semantic bindings locally and does not commit the record to any one downstream schema.</p>
              <p>By aligning storage and retrieval with principles from human memory -- encoding specificity, context dependence, temporal context, and situation models -- Information Physics offers an alternative to schema-first and search-first paradigms.</p>
              <p>This cognitive framing leads naturally to the Hyper-Semantic Layer: a structured information universe where AIOs are linked by strings that enable rapid contextual recovery. In such a system, most compute is performed once -- on the way in -- so that retrieval and reporting can reuse prepared semantic structure.</p>
              <p>The result is a new substrate for LLM/ML: models measure and explain within recovered context bundles rather than repeatedly reconstructing context from scratch.</p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-bold text-foreground border-b border-border pb-2 mb-4">References</h2>
            <div className="text-sm leading-relaxed text-muted-foreground space-y-3">
              <p>Tulving, E., & Thomson, D. M. (1973). Encoding specificity and retrieval processes in episodic memory. <em>Psychological Review</em>, 80(5), 352-373.</p>
              <p>Godden, D. R., & Baddeley, A. D. (1975). Context-dependent memory in two natural environments: On land and underwater. <em>British Journal of Psychology</em>.</p>
              <p>Zwaan, R. A., & Radvansky, G. A. (1998). Situation models in language comprehension and memory. <em>Psychological Bulletin</em>, 123(2), 162-185.</p>
              <p>Howard, M. W., & Kahana, M. J. (2002). A distributed representation of temporal context. <em>Journal of Mathematical Psychology</em>, 46(3), 269-299.</p>
              <p>Renoult, L., & Rugg, M. D. (2020). An historical perspective on Endel Tulving's episodic-semantic distinction. <em>Neuropsychologia</em>, 139, 107366.</p>
              <p>Copeland, D. E., Magliano, J. P., & Radvansky, G. A. (2005). Situation Models in Comprehension, Memory, and Augmented Cognition. In <em>Cognitive Systems: Human Cognitive Models in Systems Design</em>.</p>
            </div>
          </section>

        </article>
      </main>
      <footer className="border-t border-border mt-8"><div className="max-w-4xl mx-auto px-6 py-6 text-center"><p className="text-xs text-muted-foreground">{"© 2026 Michael Simon Bodner. All rights reserved."}</p></div></footer>
    </div>
  )
}
