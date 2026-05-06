-- 036_prompt_library_v3.sql
--
-- Replace the 5 composite seeded prompts with 24 atomic ones —
-- one per question/sub-task in the May 2026 update of
-- /Users/informationphysics/Prompt Library.docx.
--
-- The doc was edited to flatten composite prompts into a flat
-- bullet list. The user wanted each bullet to become its own
-- selectable library entry. Counting:
--   PM workload      5 prompts (#1–#5)
--   Bid strategy     4 prompts (#6–#9)
--   RFI pipeline     4 prompts (#10–#13)
--   Subcontractor    4 prompts (#14–#17)
--   Financial        7 prompts (#18–#24, the PRJ-001 reconciliation
--                                broken out into atomic sub-tasks)
--   Total           24
--
-- Idempotency: if there are already exactly 24 seeded rows, the
-- migration no-ops. Otherwise it deletes ALL seeded rows (clearing
-- v1/v2 of the 5 composite prompts) and inserts the 24 atomic ones.
-- Operator-added rows (is_seeded=false) are preserved.
--
-- This means: re-running on a v3 database = no-op. Running on a
-- v1/v2 database (5 composite seeded rows) replaces them with the 24.

DO $$
DECLARE
  current_seeded INT;
BEGIN
  IF to_regclass('public.prompt_library') IS NULL THEN
    RAISE NOTICE 'prompt_library does not exist; skipping v3 reseed';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO current_seeded FROM prompt_library WHERE is_seeded = true;
  IF current_seeded = 24 THEN
    RAISE NOTICE 'prompt_library already has 24 seeded entries; skipping';
    RETURN;
  END IF;

  RAISE NOTICE 'prompt_library v3 reseed: clearing % seeded rows, inserting 24', current_seeded;

  DELETE FROM prompt_library WHERE is_seeded = true;

  INSERT INTO prompt_library (title, body, category, metadata, is_seeded) VALUES
    -- ── PM workload (5) ─────────────────────────────────────────
    (
      'PM portfolio listing',
      E'For each active PM (Sarah Mitchell, James Okafor, Daniel Torres, Angela Brooks, Jennifer Cross, Laura Vance, Chen Wei, Priya Nair, Marcus Reid), list: number of active projects, total current contract value under management, and aggregate % work completed across their portfolio.',
      'pm-workload',
      'Exercises: Project register × DailyFieldReport · HSL signals: project manager, work completed',
      true
    ),
    (
      'Highest change-order ratio PM',
      E'Which PM has the highest ratio of change order cost to original contract value across their projects? Identify the specific change orders driving that ratio.',
      'pm-workload',
      'Exercises: Project register × ChangeOrders · HSL signals: project manager, change order cost',
      true
    ),
    (
      'Safety incidents by superintendent',
      E'List all safety incidents documented in the daily field reports. Which superintendent''s projects account for them, and what corrective actions were documented?',
      'pm-workload',
      'Exercises: DailyFieldReport · HSL signals: safety incident, superintendent, corrective action',
      true
    ),
    (
      'Marcus Reid dual-role assessment',
      E'Marcus Reid appears as both Superintendent and Project Manager on some projects. For those dual-role assignments, does % Work Completed track ahead of or behind the portfolio average?',
      'pm-workload',
      'Exercises: Project register · HSL signals: dual role, work completed',
      true
    ),
    (
      '$35M new project capacity check',
      E'If Meridian CG wanted to assign a new $35M hospital project today, which PM has the most available capacity — and which would be the riskiest assignment given current workload?',
      'pm-workload',
      'Exercises: Project register × workload aggregation · HSL signals: PM workload, contract value',
      true
    ),

    -- ── Bid strategy (4) ────────────────────────────────────────
    (
      'CSI allowances on proposals',
      E'For the two proposals in the corpus (PRJ-027 Hospital, PRJ-029 Public Safety), which CSI divisions carry the largest allowances as a percentage of base bid? What does that suggest about design maturity at proposal time?',
      'bid-strategy',
      'Exercises: Proposals (PRJ-027, PRJ-029) × CSI breakdowns · HSL signals: allowance percentage',
      true
    ),
    (
      'Bid spread analysis',
      E'From bid tabulation data, calculate the average spread between the awarded low bid and the second-lowest bid across all packages. Where is the spread widest, and what trade does that represent?',
      'bid-strategy',
      'Exercises: BidTabulation · HSL signals: award spread, trade',
      true
    ),
    (
      'Lost / Dead concentration',
      E'Looking at projects with Status = Lost or Dead in the register, are losses concentrated in a particular market sector, bid type, or geographic region?',
      'bid-strategy',
      'Exercises: Project register (Status = Lost/Dead) · HSL signals: market sector, bid type, region',
      true
    ),
    (
      'Fiona Marsh implied win rate',
      E'Estimator Fiona Marsh is listed on the most projects in the register. What is her implied win rate based on the projects she estimated that are now Active vs. Lost?',
      'bid-strategy',
      'Exercises: Project register · HSL signals: estimator, status',
      true
    ),

    -- ── RFI pipeline (4) ────────────────────────────────────────
    (
      'Open RFIs overdue list',
      E'List all open RFIs with no answer date. For each: project, submitter, days overdue, and stated cost/schedule impact where known.',
      'rfi-pipeline',
      'Exercises: RFI_Log · HSL signals: open RFI, days overdue, schedule impact',
      true
    ),
    (
      'Revise & Resubmit submittal status',
      E'Which submittals show status "Revise & Resubmit"? Have any been subsequently resubmitted and approved, or are they still outstanding?',
      'rfi-pipeline',
      'Exercises: Submittal_Log · HSL signals: revise & resubmit, approval state',
      true
    ),
    (
      'PRJ-005 Harbor Bridge RFI timeline',
      E'PRJ-005 Harbor Bridge had an RFI with a $47,000 cost impact. Did that result in a change order? What was the full timeline from RFI submission to resolution?',
      'rfi-pipeline',
      'Exercises: RFI_Log × ChangeOrders × Project register · HSL signals: cost impact, timeline',
      true
    ),
    (
      'Field delay vs open item correlation',
      E'Cross-reference the daily field reports: are field delays noted on the same projects that have open RFIs or outstanding submittals? Could those open items be causing the delays?',
      'rfi-pipeline',
      'Exercises: DailyFieldReport × RFI_Log × Submittal_Log · HSL signals: field delay, open item',
      true
    ),

    -- ── Subcontractor (4) ───────────────────────────────────────
    (
      'Insurance expiry within 90 days',
      E'Which subcontractors have insurance policies expiring within 90 days of May 6 2026? List company, trade, and expiration date.',
      'subcontractor',
      'Exercises: SubcontractorDirectory · HSL signals: insurance expiry, trade',
      true
    ),
    (
      'Non-lowest bidder justifications',
      E'For bid packages where a non-lowest bidder was awarded the contract, what was the stated justification and what dollar premium was paid over the low bid?',
      'subcontractor',
      'Exercises: BidTabulation · HSL signals: bid award justification, premium',
      true
    ),
    (
      'Apex Mechanical Systems backlog',
      E'Apex Mechanical Systems appears on multiple projects. What is their total committed backlog across all assignments, and do any project timelines overlap in a way that could create capacity risk?',
      'subcontractor',
      'Exercises: SubcontractorDirectory × Project register · HSL signals: backlog, capacity',
      true
    ),
    (
      'MBE/WBE active on CMatRisk',
      E'Which MBE/WBE subcontractors are currently active on CMatRisk contract projects?',
      'subcontractor',
      'Exercises: SubcontractorDirectory × Project register · HSL signals: MBE/WBE flag, contract type',
      true
    ),

    -- ── Financial reconciliation (7) ────────────────────────────
    (
      'PRJ-001 financial snapshot',
      E'For PRJ-001 Riverside Mixed-Use Development, produce a complete financial snapshot as of April 2025.',
      'financial',
      'Exercises: Multi-source aggregation for PRJ-001',
      true
    ),
    (
      'PRJ-001 source data assembly',
      E'Pull data from: (1) invoice INV-PRJ001-003, (2) the cost code budget tracker for PRJ-001, (3) the project register entry, and (4) any related purchase orders.',
      'financial',
      'Exercises: Invoice × CostCode_Budget × Project register × PO',
      true
    ),
    (
      'Contract value vs estimated',
      E'Reconcile current contract value vs. original estimated value.',
      'financial',
      'Exercises: Project register · HSL signals: contract value, estimate',
      true
    ),
    (
      'Billed / paid / retention',
      E'Reconcile amount billed this period, paid to date, and retention currently held.',
      'financial',
      'Exercises: Invoice · HSL signals: billing period, retention',
      true
    ),
    (
      'CSI cost overruns vs budget',
      E'Which CSI divisions show cost overruns vs. budget, and by how much?',
      'financial',
      'Exercises: CostCode_Budget · HSL signals: CSI division, cost variance',
      true
    ),
    (
      'PO committed exceeding budget',
      E'Are any PO committed amounts exceeding the corresponding budget line?',
      'financial',
      'Exercises: PO × CostCode_Budget · HSL signals: committed amount, budget line',
      true
    ),
    (
      'Financial findings summary',
      E'Summarize findings and flag any financial risk items.',
      'financial',
      'Exercises: Synthesis across financial questions',
      true
    );

  RAISE NOTICE 'prompt_library v3 reseed complete: 24 atomic prompts inserted';
END $$;
