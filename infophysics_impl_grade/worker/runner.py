import os, time, json, uuid
import psycopg
from datetime import datetime, timezone

def db():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)

def set_tenant(conn, tenant_id: str):
    with conn.cursor() as cur:
        cur.execute("SET LOCAL app.tenant_id = %s", (tenant_id,))

def record_event(conn, tenant_id: str, operator: str, inputs: list, outputs: list, params: dict, model_ref=None):
    event_id = str(uuid.uuid4())
    ts = datetime.now(timezone.utc)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO derivation_events(event_id, tenant_id, operator, timestamp, parameters, model_ref) VALUES(%s,%s,%s,%s,%s,%s)",
            (event_id, tenant_id, operator, ts, json.dumps(params), model_ref),
        )
        for inp in inputs:
            cur.execute(
                "INSERT INTO derivation_event_inputs(event_id, tenant_id, io_id, ref) VALUES(%s,%s,%s,%s)",
                (event_id, tenant_id, inp.get("io_id"), inp.get("ref")),
            )
        for out in outputs:
            cur.execute(
                "INSERT INTO derivation_event_outputs(event_id, tenant_id, io_id, ref) VALUES(%s,%s,%s,%s)",
                (event_id, tenant_id, out.get("io_id"), out.get("ref")),
            )
    return event_id

def run():
    """
    Skeleton runner:
    - In production, replace this loop with a real queue (SQS/Rabbit/Redis) and per-operator workers.
    - This file only demonstrates writing DerivationEvents under tenant RLS.
    """
    tenant_id = os.environ.get("DEMO_TENANT_ID", "tenantA")
    while True:
        with db() as conn:
            set_tenant(conn, tenant_id)
            # Demo: write a heartbeat derivation event (remove in real deployments)
            record_event(
                conn,
                tenant_id=tenant_id,
                operator="worker_heartbeat",
                inputs=[],
                outputs=[{"io_id": None, "ref": f"heartbeat:{int(time.time())}"}],
                params={"note": "demo heartbeat"},
                model_ref=None,
            )
            conn.commit()
        time.sleep(30)

if __name__ == "__main__":
    run()
