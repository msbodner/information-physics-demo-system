#!/usr/bin/env python3
"""Seed script: upload acc_rfis AIO records into information_objects.
Run via start.sh after migrations complete."""
import os, sys, uuid
from datetime import datetime, timezone
from urllib.parse import quote

try:
    import psycopg
except ImportError:
    print("psycopg not available — skipping AIO seed")
    sys.exit(0)

TENANT_ID = os.environ.get("NEXT_PUBLIC_TENANT_ID", "tenantA")

AIO_RECORDS = [
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0042][Project ID.PRJ-001][Project Name.Riverside Mixed-Use Development][Title.Foundation Bearing Capacity Clarification][Status.Closed][Priority.High][Submitted By.Marcus Reid][Submitted Date.2024-04-10][Due Date.2024-04-17][Closed Date.2024-04-15][Assigned To.Sarah Mitchell][Discipline.Structural][Question.Geotech report indicates bearing capacity of 2500 psf but structural drawings specify 3000 psf. Please clarify design basis.][Response.Structural engineer confirmed 2500 psf governs. Revised footing schedule issued via ASI-007.][Cost Impact.Yes][Schedule Impact (Days).3]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0043][Project ID.PRJ-001][Project Name.Riverside Mixed-Use Development][Title.MEP Coordination Conflict at Level 4 Ceiling][Status.Open][Priority.High][Submitted By.Priya Nair][Submitted Date.2024-05-02][Due Date.2024-05-09][Closed Date.][Assigned To.James Okafor][Discipline.MEP][Question.HVAC ductwork and fire suppression mains conflict in corridor at gridline D4. Ceiling height insufficient to accommodate both.][Response.][Cost Impact.][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0044][Project ID.PRJ-001][Project Name.Riverside Mixed-Use Development][Title.Exterior Glazing Unit Substitution][Status.In Review][Priority.Medium][Submitted By.Angela Brooks][Submitted Date.2024-05-14][Due Date.2024-05-28][Closed Date.][Assigned To.Sarah Mitchell][Discipline.Architectural][Question.Specified glazing unit is on 20-week lead time. Requesting approval for equal substitution from alternate manufacturer.][Response.][Cost Impact.][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0018][Project ID.PRJ-002][Project Name.Highland Medical Center Expansion][Title.Medical Gas Rough-In Location][Status.Closed][Priority.High][Submitted By.Daniel Torres][Submitted Date.2024-07-01][Due Date.2024-07-08][Closed Date.2024-07-06][Assigned To.James Okafor][Discipline.Plumbing][Question.Drawings show medical gas outlets on east wall but equipment layout requires west wall placement in rooms 412-418.][Response.Architect approved relocation. Updated drawing issued. Coordinate with infection control for wall penetrations.][Cost Impact.Yes][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0019][Project ID.PRJ-002][Project Name.Highland Medical Center Expansion][Title.Seismic Bracing at Level 2 Mechanical Room][Status.Closed][Priority.High][Submitted By.Chen Wei][Submitted Date.2024-07-15][Due Date.2024-07-22][Closed Date.2024-07-20][Assigned To.James Okafor][Discipline.Structural][Question.Seismic bracing details missing for equipment larger than 400 lbs in mechanical room 202.][Response.Engineer of record provided seismic calculations and detail SK-S14 for all equipment anchoring.][Cost Impact.No][Schedule Impact (Days).2]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0020][Project ID.PRJ-002][Project Name.Highland Medical Center Expansion][Title.Flooring Transition at Sterile/Non-Sterile Boundary][Status.Open][Priority.Medium][Submitted By.Laura Vance][Submitted Date.2024-08-03][Due Date.2024-08-17][Closed Date.][Assigned To.Priya Nair][Discipline.Architectural][Question.No flooring transition detail provided at sterile corridor interface. What transition strip and sealant is specified?][Response.][Cost Impact.][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0011][Project ID.PRJ-003][Project Name.Greenway Office Park - Phase 2][Title.Parking Structure Waterproofing Spec Conflict][Status.Closed][Priority.Medium][Submitted By.Marcus Reid][Submitted Date.2024-02-20][Due Date.2024-03-05][Closed Date.2024-03-01][Assigned To.Chen Wei][Discipline.Civil][Question.Spec section 071800 references membrane waterproofing but details on sheet C-14 show crystalline waterproofing. Which governs?][Response.Crystalline waterproofing governs per project engineer clarification. Spec will be updated via bulletin.][Cost Impact.No][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0012][Project ID.PRJ-003][Project Name.Greenway Office Park - Phase 2][Title.EV Charging Conduit Routing][Status.Open][Priority.Low][Submitted By.Angela Brooks][Submitted Date.2024-03-12][Due Date.2024-03-26][Closed Date.][Assigned To.Sarah Mitchell][Discipline.Electrical][Question.EV charging stub-ups not shown on electrical site plan. Requesting routing and pull box locations for 40 future EV stalls.][Response.][Cost Impact.][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0005][Project ID.PRJ-004][Project Name.Lakeview Elementary School][Title.Gym Floor Spring System Spec][Status.In Review][Priority.Medium][Submitted By.Daniel Torres][Submitted Date.2024-01-08][Due Date.2024-01-22][Closed Date.][Assigned To.Priya Nair][Discipline.Architectural][Question.Gym floor spec calls for 2-inch spring system but budget estimate was based on 1.5-inch. Can owner confirm spec intent?][Response.][Cost Impact.][Schedule Impact (Days).0]",
    "[OriginalCSV.acc_rfis.csv][FileDate.2026-03-08][FileTime.19:30:00][RFI ID.RFI-0006][Project ID.PRJ-004][Project Name.Lakeview Elementary School][Title.Fire Alarm Device Layout Gym][Status.Closed][Priority.High][Submitted By.James Okafor][Submitted Date.2024-01-20][Due Date.2024-01-27][Closed Date.2024-01-25][Assigned To.Angela Brooks][Discipline.Fire Protection][Question.No fire alarm devices shown in gym volume above 15 ft AFF. Code requires coverage per NFPA 72.][Response.FPE added devices on SK-FA-09. Devices required at 20 ft AFF on north and south walls.][Cost Impact.No][Schedule Impact (Days).1]",
]

def run():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("No DATABASE_URL — skipping AIO seed")
        return
    try:
        conn = psycopg.connect(url)
        with conn:
            with conn.cursor() as cur:
                # Ensure tenant exists
                cur.execute(
                    "INSERT INTO tenants(tenant_id, name) VALUES(%s,%s) ON CONFLICT DO NOTHING",
                    (TENANT_ID, TENANT_ID),
                )
                # Check how many of these AIO records already exist for this source
                cur.execute(
                    "SELECT COUNT(*) FROM information_objects WHERE tenant_id=%s AND type='AIO' AND source_object_id='acc_rfis.csv'",
                    (TENANT_ID,),
                )
                existing = cur.fetchone()[0]
                if existing >= len(AIO_RECORDS):
                    print(f"AIO seed: {existing} records already exist — skipping")
                    return
                # Insert all AIO records
                now = datetime.now(timezone.utc)
                inserted = 0
                for line in AIO_RECORDS:
                    raw_uri = f"data:text/aio,{quote(line)}"
                    cur.execute(
                        """
                        INSERT INTO information_objects
                          (io_id, tenant_id, type, created_at, raw_uri, mime_type, size_bytes, source_system, source_object_id)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                        """,
                        (
                            str(uuid.uuid4()), TENANT_ID, "AIO", now,
                            raw_uri, "text/aio", len(line),
                            "csv-converter", "acc_rfis.csv",
                        ),
                    )
                    inserted += 1
        conn.close()
        print(f"AIO seed: inserted {inserted} records for acc_rfis.csv")
    except Exception as e:
        print(f"AIO seed failed (non-fatal): {e}")

if __name__ == "__main__":
    run()
