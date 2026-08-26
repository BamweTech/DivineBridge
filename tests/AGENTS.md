# tests/ — Test Suite

Python test suite for the Flask backend and cross-runtime contracts, run with pytest.

## Running tests

```bash
USE_LOCAL_STORAGE=true pytest tests/ -v --tb=short
```

The `USE_LOCAL_STORAGE=true` env var is required to avoid Google Cloud Storage dependencies in tests. This matches the CI configuration in `.github/workflows/ci.yml`.

## Test organization

| Folder | Purpose |
|--------|---------|
| `tests/unit/` | Unit and focused API tests for Flask services and blueprints |
| `tests/contract/` | Route map, API surface, and SFU protocol parity fixtures |
| `tests/integration/` | Deployment readiness / static checks |
| `tests/load/` | Locust load scenarios |

- Test files are named `test_<module>.py` matching the module under test.
- API/SFU fixtures live under `contracts/` (`api-*.json`, `sfu-protocol.json`).

## Dev dependencies

Install from `requirements-dev.txt`:

```bash
pip install -r requirements-dev.txt
```

## Conventions

- Mock Firebase and external services; do not make real network calls in tests.
- Use `USE_LOCAL_STORAGE=true` for storage operations.
- One assertion concept per test function.
- Keep tests focused and fast.

## Linting and formatting

- `flake8 --max-line-length=120 app.py tests/ backend/` (see `.flake8`)
- `black --check --line-length=120 app.py tests/ backend/`

## Mobile / media / web checks

```bash
cd mobile && npx tsc --noEmit && npm run lint && npx expo-doctor
cd media-server && npm run check && npm run test:protocol
cd web/client && npm run build
```
