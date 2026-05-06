-- 035_prompt_library_v2.sql
--
-- Replace the 5 seeded library bodies with the May 2026 update from
-- /Users/informationphysics/Prompt Library.docx. The newer doc dropped:
--   * "Prompt N — Title" headers
--   * Italic "Exercises: × × × · HSL signals: …" metadata lines
--   * Preambles ("Conduct a project manager performance analysis…")
--   * Numbered list prefixes (1., 2., …)
--   * Closing lines ("Format as an executive workforce planning brief.")
--
-- Just the questions remain. We keep the titles + categories + metadata
-- columns from the original seed (still accurate descriptive labels),
-- but rewrite `body` to match the doc.
--
-- Idempotent: only updates rows where is_seeded=true AND the body
-- doesn't already match — re-running this migration on a database
-- that's already on v2 is a no-op. Operator-edited bodies (where the
-- admin pencil-icon'd a prompt in System Admin → Prompt Library) are
-- NOT touched even when is_seeded=true, because their body won't
-- match the v1 expected text.

DO $$
DECLARE
  v_pm_workload     text := E'For each active PM (Sarah Mitchell, James Okafor, Daniel Torres, Angela Brooks, Jennifer Cross, Laura Vance, Chen Wei, Priya Nair, Marcus Reid), list: number of active projects, total current contract value under management, and aggregate % work completed across their portfolio.\n\nWhich PM has the highest ratio of change order cost to original contract value across their projects? Identify the specific change orders driving that ratio.\n\nList all safety incidents documented in the daily field reports. Which superintendent''s projects account for them, and what corrective actions were documented?\n\nMarcus Reid appears as both Superintendent and Project Manager on some projects. For those dual-role assignments, does % Work Completed track ahead of or behind the portfolio average?\n\nIf Meridian CG wanted to assign a new $35M hospital project today, which PM has the most available capacity — and which would be the riskiest assignment given current workload?';
  v_bid_strategy    text := E'For the two proposals in the corpus (PRJ-027 Hospital, PRJ-029 Public Safety), which CSI divisions carry the largest allowances as a percentage of base bid? What does that suggest about design maturity at proposal time?\n\nFrom bid tabulation data, calculate the average spread between the awarded low bid and the second-lowest bid across all packages. Where is the spread widest, and what trade does that represent?\n\nLooking at projects with Status = Lost or Dead in the register, are losses concentrated in a particular market sector, bid type, or geographic region?\n\nEstimator Fiona Marsh is listed on the most projects in the register. What is her implied win rate based on the projects she estimated that are now Active vs. Lost?';
  v_rfi_pipeline    text := E'List all open RFIs with no answer date. For each: project, submitter, days overdue, and stated cost/schedule impact where known.\n\nWhich submittals show status "Revise & Resubmit"? Have any been subsequently resubmitted and approved, or are they still outstanding?\n\nPRJ-005 Harbor Bridge had an RFI with a $47,000 cost impact. Did that result in a change order? What was the full timeline from RFI submission to resolution?\n\nCross-reference the daily field reports: are field delays noted on the same projects that have open RFIs or outstanding submittals? Could those open items be causing the delays?';
  v_subcontractor   text := E'Which subcontractors have insurance policies expiring within 90 days of May 6 2026? List company, trade, and expiration date.\n\nFor bid packages where a non-lowest bidder was awarded the contract, what was the stated justification and what dollar premium was paid over the low bid?\n\nApex Mechanical Systems appears on multiple projects. What is their total committed backlog across all assignments, and do any project timelines overlap in a way that could create capacity risk?\n\nWhich MBE/WBE subcontractors are currently active on CMatRisk contract projects?';
  v_financial       text := E'For PRJ-001 Riverside Mixed-Use Development, produce a complete financial snapshot as of April 2025.\n\nPull data from: (1) invoice INV-PRJ001-003, (2) the cost code budget tracker for PRJ-001, (3) the project register entry, and (4) any related purchase orders.\n\nReconcile the following:\n- Current contract value vs. original estimated value\n- Amount billed this period, paid to date, and retention currently held\n- Which CSI divisions show cost overruns vs. budget, and by how much?\n- Are any PO committed amounts exceeding the corresponding budget line?\n\nSummarize findings and flag any financial risk items.';
BEGIN
  -- Skip work entirely if the table doesn't exist yet (defensive: the
  -- 034 migration creates it; running 035 first by accident shouldn't
  -- crash with a table-not-found).
  IF to_regclass('public.prompt_library') IS NULL THEN
    RAISE NOTICE 'prompt_library table does not exist; skipping v2 update';
    RETURN;
  END IF;

  UPDATE prompt_library SET body = v_pm_workload,    updated_at = now()
   WHERE category = 'pm-workload'   AND is_seeded = true AND body <> v_pm_workload;
  UPDATE prompt_library SET body = v_bid_strategy,   updated_at = now()
   WHERE category = 'bid-strategy'  AND is_seeded = true AND body <> v_bid_strategy;
  UPDATE prompt_library SET body = v_rfi_pipeline,   updated_at = now()
   WHERE category = 'rfi-pipeline'  AND is_seeded = true AND body <> v_rfi_pipeline;
  UPDATE prompt_library SET body = v_subcontractor,  updated_at = now()
   WHERE category = 'subcontractor' AND is_seeded = true AND body <> v_subcontractor;
  UPDATE prompt_library SET body = v_financial,      updated_at = now()
   WHERE category = 'financial'     AND is_seeded = true AND body <> v_financial;
END $$;
