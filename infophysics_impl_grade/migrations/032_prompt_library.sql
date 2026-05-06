-- 032_prompt_library.sql
--
-- Curated prompt library — admin-managed exemplar prompts that
-- operators can pick from inside ChatAIO. Distinct from `saved_prompts`,
-- which holds operator-personal bookmarks; this table holds shared
-- library entries that ship with the system and that admins
-- maintain via the System Admin → Prompt Library tab.
--
-- Five seed entries come from the May 2026 Prompt Library doc:
-- demonstration prompts that exercise specific cross-document
-- joins in the demo corpus (financial reconciliation, subcontractor
-- audit, RFI pipeline, bid strategy, PM workload). Marked
-- is_seeded=true so the UI can show a small "seeded" badge and
-- guard the delete action with an extra confirm.

CREATE TABLE IF NOT EXISTS prompt_library (
  prompt_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  body        text        NOT NULL,
  category    text        NOT NULL DEFAULT 'general',
  metadata    text,                 -- e.g. the "Exercises: ... HSL signals: ..." subtitle
  is_seeded   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prompt_library_category ON prompt_library(category);
CREATE INDEX IF NOT EXISTS idx_prompt_library_updated   ON prompt_library(updated_at DESC);

-- ── Seed (idempotent) ────────────────────────────────────────────
-- ON CONFLICT against title would require a unique constraint we
-- don't want; instead we gate on a stable seed-only marker so
-- re-running the migration on an existing database doesn't
-- duplicate the rows or stomp operator edits.

INSERT INTO prompt_library (title, body, category, metadata, is_seeded)
SELECT v.title, v.body, v.category, v.metadata, true
FROM (VALUES
  -- ── 1 — Cross-document financial reconciliation ──────────────
  (
    'Cross-document financial reconciliation',
    E'For PRJ-001 Riverside Mixed-Use Development, produce a complete financial snapshot as of April 2025.\n\nPull data from: (1) invoice INV-PRJ001-003, (2) the cost code budget tracker for PRJ-001, (3) the project register entry, and (4) any related purchase orders.\n\nReconcile the following:\n- Current contract value vs. original estimated value\n- Amount billed this period, paid to date, and retention currently held\n- Which CSI divisions show cost overruns vs. budget, and by how much?\n- Are any PO committed amounts exceeding the corresponding budget line?\n\nSummarize findings and flag any financial risk items.',
    'financial',
    'Exercises: Invoice × PO × CostCode_Budget × Project register · HSL signals: billing period, retention, cost variance, committed amounts'
  ),
  -- ── 2 — Subcontractor risk & compliance audit ────────────────
  (
    'Subcontractor risk & compliance audit',
    E'Run a subcontractor risk audit across the Meridian CG portfolio.\n\nUsing the subcontractor directory, bid tabulation records, and change order log:\n\n1. Which subcontractors have insurance policies expiring within 90 days of May 6 2026? List company, trade, and expiration date.\n\n2. For bid packages where a non-lowest bidder was awarded the contract, what was the stated justification and what dollar premium was paid over the low bid?\n\n3. Apex Mechanical Systems appears on multiple projects. What is their total committed backlog across all assignments, and do any project timelines overlap in a way that could create capacity risk?\n\n4. Which MBE/WBE subcontractors are currently active on CMatRisk contract projects?\n\nFlag any items that warrant attention from the Project Accountant or Purchasing Manager.',
    'subcontractor',
    'Exercises: SubcontractorDirectory × BidTabulation × Change Order CO-PRJ001-007 · HSL signals: MBE/WBE flag, insurance expiry, bid award justification, backlog'
  ),
  -- ── 3 — RFI & submittal pipeline health check ────────────────
  (
    'RFI & submittal pipeline health check',
    E'Analyze the current RFI and submittal pipeline health for all active projects as of May 6 2026.\n\n1. List all open RFIs with no answer date. For each: project, submitter, days overdue, and stated cost/schedule impact where known.\n\n2. Which submittals show status "Revise & Resubmit"? Have any been subsequently resubmitted and approved, or are they still outstanding?\n\n3. PRJ-005 Harbor Bridge had an RFI with a $47,000 cost impact. Did that result in a change order? What was the full timeline from RFI submission to resolution?\n\n4. Cross-reference the daily field reports: are field delays noted on the same projects that have open RFIs or outstanding submittals? Could those open items be causing the delays?\n\nProduce a prioritized watch list of the three highest-risk open items across the portfolio.',
    'rfi-pipeline',
    'Exercises: RFI_Log × Submittal_Log × DailyFieldReport × Project register · HSL signals: open RFI, revise & resubmit, schedule impact, days added, field delay'
  ),
  -- ── 4 — Bid strategy & competitive intelligence ──────────────
  (
    'Bid strategy & competitive intelligence',
    E'I want to understand Meridian CG''s bid performance and competitive positioning.\n\nUsing the proposal documents, bid tabulation records, and the project register:\n\n1. For the two proposals in the corpus (PRJ-027 Hospital, PRJ-029 Public Safety), which CSI divisions carry the largest allowances as a percentage of base bid? What does that suggest about design maturity at proposal time?\n\n2. From bid tabulation data, calculate the average spread between the awarded low bid and the second-lowest bid across all packages. Where is the spread widest, and what trade does that represent?\n\n3. Looking at projects with Status = Lost or Dead in the register, are losses concentrated in a particular market sector, bid type, or geographic region?\n\n4. Estimator Fiona Marsh is listed on the most projects in the register. What is her implied win rate based on the projects she estimated that are now Active vs. Lost?\n\nReturn findings as a structured competitive intelligence brief.',
    'bid-strategy',
    'Exercises: Proposals (PRJ-027, PRJ-029) × BidTabulation × Project register (Status = Lost/Dead) · HSL signals: bid type, allowance percentage, estimator, market sector, award spread'
  ),
  -- ── 5 — PM workload & delivery performance ────────────────────
  (
    'PM workload & delivery performance',
    E'Conduct a project manager performance and workload analysis across the full portfolio.\n\nUsing the project register, daily field reports, RFI log, and change order data:\n\n1. For each active PM (Sarah Mitchell, James Okafor, Daniel Torres, Angela Brooks, Jennifer Cross, Laura Vance, Chen Wei, Priya Nair, Marcus Reid), list: number of active projects, total current contract value under management, and aggregate % work completed across their portfolio.\n\n2. Which PM has the highest ratio of change order cost to original contract value across their projects? Identify the specific change orders driving that ratio.\n\n3. List all safety incidents documented in the daily field reports. Which superintendent''s projects account for them, and what corrective actions were documented?\n\n4. Marcus Reid appears as both Superintendent and Project Manager on some projects. For those dual-role assignments, does % Work Completed track ahead of or behind the portfolio average?\n\n5. If Meridian CG wanted to assign a new $35M hospital project today, which PM has the most available capacity — and which would be the riskiest assignment given current workload?\n\nFormat as an executive workforce planning brief.',
    'pm-workload',
    'Exercises: Full project register × DailyFieldReport × RFI_Log × Change Order · HSL signals: project manager, work completed, safety incident, schedule impact, dual role'
  )
) AS v(title, body, category, metadata)
WHERE NOT EXISTS (
  -- Seed only when no seeded rows exist yet. Re-running the migration
  -- after the operator has personalized the library is safe.
  SELECT 1 FROM prompt_library WHERE is_seeded = true
);
