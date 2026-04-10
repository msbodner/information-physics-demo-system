#!/bin/sh
set -e

# Run DB migrations (idempotent)
echo "Running migrations..."
python3 -c "
import psycopg, os, glob, sys
url = os.environ.get('DATABASE_URL')
if not url:
    print('No DATABASE_URL — skipping migrations')
    sys.exit(0)
conn = psycopg.connect(url)
for f in sorted(glob.glob('migrations/*.sql')):
    print(f'  Applying {f}...')
    sql = open(f).read()
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
conn.close()
print('Migrations done.')
"

# Seed default admin user (non-fatal)
echo "Seeding default admin user..."
python3 -c "
import psycopg, os, sys
try:
    import bcrypt
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'bcrypt>=4.0', '--quiet'])
    import bcrypt
url = os.environ.get('DATABASE_URL')
if not url:
    print('No DATABASE_URL — skipping seed')
    sys.exit(0)
conn = psycopg.connect(url)
pw_hash = bcrypt.hashpw(b'Admin@1234', bcrypt.gensalt()).decode()
with conn.cursor() as cur:
    cur.execute('''
        INSERT INTO users (username, email, password_hash, role)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (email) DO NOTHING
    ''', ('Michael Bodner', 'bodner.michael@gmail.com', pw_hash, 'System Admin'))
conn.commit()
conn.close()
print('Seed done.')
" || echo "Seed skipped (non-fatal)"

# Load API key from DB into env if present
echo "Loading API key from DB..."
python3 -c "
import psycopg, os
url = os.environ.get('DATABASE_URL')
if not url:
    exit(0)
try:
    conn = psycopg.connect(url)
    with conn.cursor() as cur:
        cur.execute(\"SELECT value FROM system_settings WHERE key = 'anthropic_api_key'\")
        row = cur.fetchone()
        if row:
            with open('/tmp/api_key_env', 'w') as f:
                f.write(f\"export ANTHROPIC_API_KEY='{row[0]}'\n\")
            print('API key loaded from DB.')
    conn.close()
except Exception as e:
    print(f'Could not load API key from DB: {e}')
" || true

if [ -f /tmp/api_key_env ]; then
    . /tmp/api_key_env
    rm -f /tmp/api_key_env
fi

# Seed AIO records (non-fatal)
echo "Seeding AIO records..."
python3 seeds/seed_aios.py || echo "AIO seed skipped (non-fatal)"

# Start the API server
exec uvicorn api.main:app --host 0.0.0.0 --port "${PORT:-8000}"
