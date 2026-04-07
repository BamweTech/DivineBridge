# tests/ — Test Suite

Python test suite for the Flask backend, run with pytest.

## Running tests

```bash
USE_LOCAL_STORAGE=true pytest tests/ -v --tb=short
```

The `USE_LOCAL_STORAGE=true` env var is required to avoid Google Cloud Storage dependencies in tests. This matches the CI configuration in `.github/workflows/ci.yml`.

## Test organization

- Test files are named `test_<module>.py` matching the module under test.
- Tests for route blueprints test the HTTP API via Flask's test client.
- Tests for service modules test business logic directly.

## Dev dependencies

Install from `requirements-dev.txt`:

```bash
pip install -r requirements-dev.txt
```

This includes pytest, flake8, black, and other dev tools.

## Writing new tests

```python
import pytest
from app import create_app

@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_endpoint(client):
    response = client.get('/api/endpoint')
    assert response.status_code == 200
    data = response.get_json()
    assert data['success'] is True
```

## Conventions

- Mock Firebase and external services; do not make real network calls in tests.
- Use `USE_LOCAL_STORAGE=true` for storage operations.
- One assertion concept per test function.
- Keep tests focused and fast.

## Linting and formatting

- `flake8 --max-line-length=120 --exclude=venv,flask_session,local_storage_data,.git app.py routes/ core/ tests/`
- `black --check --line-length=120 app.py routes/ core/ tests/`

## Mobile tests

Mobile type checking and linting run separately in the `mobile/` directory:

```bash
cd mobile && npx tsc --noEmit && npm run lint && npx expo-doctor
```
