"use client"

import { Button } from "@/components/ui/button"
import {
  Database, ArrowRight, Layers, Cpu, Globe, Zap, Network,
} from "lucide-react"

interface SplashScreenProps {
  onEnter: () => void
}

export function SplashScreen({ onEnter }: SplashScreenProps) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#0F3460] flex items-center justify-center">
                <Network className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">Information Physics Demo System</h1>
                <p className="text-xs text-muted-foreground">by InformationPhysics.ai</p>
              </div>
            </div>
            <div className="text-xs font-mono text-muted-foreground">V4.4</div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="max-w-6xl mx-auto px-6 py-16 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#0F3460] text-white text-sm font-medium mb-6">
            <Globe className="w-4 h-4" />
            Information Physics Standard Model
          </div>
          <h2 className="text-5xl font-bold text-foreground mb-3">AIO/HSL/MRO Demo System V4.4</h2>
          <p className="text-lg text-muted-foreground mb-2">by InformationPhysics.ai</p>
          <p className="text-lg text-muted-foreground mb-10 leading-relaxed">
            Transform your CSV data into Associated Information Objects (AIOs) — the fundamental
            unit of information in the new Information Physics Standard Model.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="grid md:grid-cols-3 gap-6 mb-16 max-w-5xl mx-auto">
          <div className="p-6 rounded-xl bg-card border border-border text-left shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center mb-4">
              <Layers className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Application Agnostic</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              AIOs are information objects not tied to any application or relational database
              schema, enabling universal data interoperability.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border text-left shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center mb-4">
              <Cpu className="w-5 h-5 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Hyper-Semantic Model</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              AIOs form the basis of a new hyper-semantic model that captures meaning and
              relationships in a way traditional data formats cannot.
            </p>
          </div>
          <div className="p-6 rounded-xl bg-card border border-border text-left shadow-sm">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center mb-4">
              <Zap className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Next-Gen LLM Foundation</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              This hyper-semantic model serves as the foundation upon which a new class of Large
              Language Models operate with enhanced understanding, memory, and auditability.
            </p>
          </div>
        </div>

        {/* Conversion Process */}
        <div className="mb-16">
          <h3 className="text-2xl font-bold text-foreground mb-8">The Conversion Process</h3>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-border min-w-[120px] shadow-sm">
              <span className="text-2xl font-mono font-bold text-[#0F3460]">CSV</span>
              <span className="text-xs text-muted-foreground">Tabular Data</span>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-border min-w-[120px] shadow-sm">
              <span className="text-2xl font-mono font-bold text-[#0F3460]">[Col.Val]</span>
              <span className="text-xs text-muted-foreground">AIO Format</span>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-blue-300 min-w-[120px] shadow-sm">
              <span className="text-2xl font-mono font-bold text-blue-600">.aio</span>
              <span className="text-xs text-muted-foreground">Semantic Object</span>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-emerald-300 min-w-[120px] shadow-sm">
              <span className="text-2xl font-mono font-bold text-emerald-600">.hsl</span>
              <span className="text-xs text-muted-foreground text-center">Hyper-Semantic-Layer Object</span>
            </div>
            <ArrowRight className="w-5 h-5 text-muted-foreground" />
            <div className="flex flex-col items-center gap-2 p-4 rounded-lg bg-card border border-emerald-300 min-w-[120px] shadow-sm">
              <span className="text-2xl font-mono font-bold text-emerald-600">.mro</span>
              <span className="text-xs text-muted-foreground text-center">Memory Result Object</span>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-6 max-w-2xl mx-auto leading-relaxed">
            Each row of your CSV is transformed into a single-line AIO prefixed with source metadata:{" "}
            <span className="font-mono text-xs">[OriginalCSV.filename][FileDate.YYYY-MM-DD][FileTime.HH:MM:SS][Column1.Value1][Column2.Value2]...</span>
          </p>
        </div>

        {/* Enter button */}
        <div className="flex flex-col items-center gap-3">
          <Button size="lg" onClick={onEnter} className="gap-2 px-10 bg-[#0F3460] hover:bg-[#1A5276] text-white">
            Enter Information Physics Demo System
            <ArrowRight className="w-4 h-4" />
          </Button>
          <p className="text-xs text-muted-foreground">
            <Database className="w-3 h-3 inline mr-1" />
            V4.4 — Self-maintaining HSL substrate: synth-on-insert, Prune HSLs, hsl_member side table, point-in-time rebuild
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border mt-8">
        <div className="max-w-6xl mx-auto px-6 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            InformationPhysics.ai — Pioneering the Information Physics Standard Model
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            © 2026 Michael Simon Bodner, Ph.D. · All rights reserved
          </p>
        </div>
      </footer>
    </div>
  )
}
