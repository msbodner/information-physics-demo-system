"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ArrowLeft, BookOpen, ExternalLink, Globe, Layers, Database, FileText, Cpu } from "lucide-react"

interface ReferencePageProps {
  onBack: () => void
}

export function ReferencePage({ onBack }: ReferencePageProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              <h1 className="text-xl font-bold">Reference Guide</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Information Physics &amp; Semantic Architecture</h2>
          <p className="text-muted-foreground leading-relaxed">
            This reference guide provides an overview of the theoretical foundations and technical specifications
            behind the ACC Semantic Layer and Atomic Information Objects (AIOs).
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            Foundational Concepts
          </h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Information Physics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                Information Physics is a framework that treats information as a fundamental physical quantity,
                similar to energy or matter. In this paradigm, data structures are not mere abstractions but
                have real semantic properties that can be measured, transformed, and conserved.
              </p>
              <p className="leading-relaxed text-muted-foreground">
                The ACC (Atomic Cognitive Computing) approach builds on this foundation by defining
                minimal semantic units (AIOs) that preserve meaning through transformations.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Semantic Triples</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                At the core of the AIO format is the semantic triple: Subject-Predicate-Object.
                This is the same foundational structure used in RDF (Resource Description Framework)
                and knowledge graphs.
              </p>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
                <p className="text-muted-foreground">{"// Semantic Triple Example"}</p>
                <p>{"Subject:   Employee_001"}</p>
                <p>{"Predicate: hasDepartment"}</p>
                <p>{"Object:    Engineering"}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Database className="w-5 h-5 text-primary" />
            AIO Specification
          </h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Structure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                Each AIO is a self-contained data object with the following properties:
              </p>
              <ul className="list-disc list-inside space-y-2 text-muted-foreground">
                <li><span className="font-medium text-foreground">Identity</span> - A unique identifier for the AIO</li>
                <li><span className="font-medium text-foreground">Elements</span> - One or more key-value pairs representing semantic attributes</li>
                <li><span className="font-medium text-foreground">Atomicity</span> - Each AIO is indivisible; it represents one complete semantic unit</li>
                <li><span className="font-medium text-foreground">Self-description</span> - The element keys provide semantic context for the values</li>
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">File Format</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                AIO files use a plain text format with structured element declarations:
              </p>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
                <p className="text-muted-foreground">{"// .aio file format"}</p>
                <p>{"AIO_ID: <unique_identifier>"}</p>
                <p>{"Element: <key> = <value>"}</p>
                <p>{"Element: <key> = <value>"}</p>
                <p>{"..."}</p>
              </div>
              <p className="text-sm text-muted-foreground">
                When converting from CSV, each column header becomes an element key,
                and each cell value becomes the corresponding element value.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            Semantic Layer Architecture
          </h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Layer Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                The ACC Semantic Layer sits between raw data and application logic, providing:
              </p>
              <div className="grid gap-3 mt-2">
                {[
                  { title: "Layer 1: Observation (AIOs)", desc: "Raw data captured as self-describing bracket-notation objects — each CSV row becomes an immutable AIO" },
                  { title: "Relational Topology (HSLs)", desc: "Hyper-Semantic Layers link AIOs sharing common element values — single-element and compound AND-logic queries" },
                  { title: "Layer 2: Recollection (MROs)", desc: "Memory Result Objects capture AI query results with full provenance — episodic memory that grows with each interaction" },
                  { title: "Layer 3: Knowledge (SKOs — Future)", desc: "Structured Knowledge Objects — governed abstractions promoted from converging MRO patterns" },
                  { title: "Intelligent Retrieval (ChatAIO)", desc: "AI-powered search with two modes: broad context (Send) and targeted 4-phase algebra (AIO Search)" },
                  { title: "Recursive Memory Loop", desc: "MROs feed back as new data sources, enabling the system to learn from its own query history" },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3 p-3 bg-muted rounded-lg">
                    <Cpu className="w-4 h-4 text-primary shrink-0 mt-1" />
                    <div>
                      <p className="font-medium text-sm">{item.title}</p>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />
            Hyper-Semantic Logic Engine
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="leading-relaxed">
                The Hyper-Semantic Logic Engine processes collections of AIOs to discover and surface
                relationships that may not be immediately apparent in the raw data.
              </p>
              <p className="leading-relaxed text-muted-foreground">
                It works by building an inverted index of all element values across all AIOs,
                enabling O(1) lookup of which AIOs share any given attribute value. This enables
                real-time exploration of data relationships.
              </p>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
                <p className="text-muted-foreground">{"// Hyper-Semantic Query Example"}</p>
                <p>{"Query: Find all AIOs where Department = \"Engineering\""}</p>
                <p>{"Result: [AIO_0001, AIO_0003, AIO_0007, AIO_0012]"}</p>
                <p>{""}</p>
                <p>{"Query: Find all AIOs where City = \"San Francisco\""}</p>
                <p>{"Result: [AIO_0001, AIO_0005, AIO_0009]"}</p>
                <p>{""}</p>
                <p>{"Intersection: AIO_0001 shares both attributes"}</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-purple-600" />
            Memory Result Objects (MROs)
          </h2>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">MRO Formal Structure</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                An MRO captures the complete provenance of an AI-driven query result. It is defined as a 7-tuple:
              </p>
              <div className="bg-muted rounded-lg p-4 font-mono text-sm space-y-1">
                <p>{"MRO = ⟨ Q, S, C, O, R, P, L ⟩"}</p>
                <p className="text-muted-foreground">{"  Q = Query (original user prompt)"}</p>
                <p className="text-muted-foreground">{"  S = Search Terms (parsed field_values + keywords)"}</p>
                <p className="text-muted-foreground">{"  C = Context (matched AIO records)"}</p>
                <p className="text-muted-foreground">{"  O = Output (AI-generated response)"}</p>
                <p className="text-muted-foreground">{"  R = References (matched HSL names)"}</p>
                <p className="text-muted-foreground">{"  P = Provenance (timestamp, model, tenant)"}</p>
                <p className="text-muted-foreground">{"  L = Links (MROKey linking to source HSLs/AIOs)"}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">MRO Key &amp; Lifecycle</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="leading-relaxed">
                Each MRO is assigned a key in the format <code className="bg-muted px-1 rounded font-mono text-xs">[MROKey.HSL-n-AIO-m]</code> where
                n is the count of matched HSLs and m is the count of matched AIOs. This key links the MRO back to its source data.
              </p>
              <p className="leading-relaxed text-muted-foreground">
                The MRO lifecycle follows: <strong>Creation</strong> (AIO Search query) → <strong>Storage</strong> (PostgreSQL mro_objects table) →
                <strong> Retrieval</strong> (View MROs in ChatAIO) → <strong>Feedback</strong> (recursive memory loop where past results inform future queries).
              </p>
              <p className="leading-relaxed text-muted-foreground">
                MROs represent the second layer of the Information Physics hierarchy — while AIOs capture raw observation and HSLs capture relational topology,
                MROs capture the episodic memory of intelligent interaction with the data.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" />
            Further Reading
          </h2>
          <div className="grid gap-3">
            {[
              { title: "RDF (Resource Description Framework)", url: "https://www.w3.org/RDF/", desc: "W3C standard for semantic web data" },
              { title: "Knowledge Graphs", url: "https://en.wikipedia.org/wiki/Knowledge_graph", desc: "Graph-structured knowledge bases" },
              { title: "Linked Data Principles", url: "https://www.w3.org/DesignIssues/LinkedData.html", desc: "Tim Berners-Lee's linked data design principles" },
              { title: "Semantic Web", url: "https://www.w3.org/standards/semanticweb/", desc: "W3C Semantic Web standards and tools" },
            ].map((item) => (
              <Card key={item.title}>
                <CardContent className="py-3 px-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm" className="gap-1">
                      <ExternalLink className="w-3 h-3" />
                      Visit
                    </Button>
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <footer className="pt-8 border-t text-center text-sm text-muted-foreground">
          <p>InformationPhysics (informationphysics.ai) - InformationPhysics.ai</p>
          <p className="mt-1">ACC Semantic Layer Guide - Reference Documentation</p>
        </footer>
      </main>
    </div>
  )
}
