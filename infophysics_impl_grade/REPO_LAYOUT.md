# Repo layout

- openapi/openapi.yaml
- migrations/
  - 000_extensions.sql
  - 001_base_tables.sql
  - 002_indexes.sql
  - 003_rls.sql
- api/
  - main.py
- worker/
  - runner.py
- docker-compose.yml
- pyproject.toml
- .env.example
- .github/workflows/ci.yml
