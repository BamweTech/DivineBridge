.PHONY: install test lint format clean run-local

# Install dependencies
install:
	pip install -r requirements-dev.txt

# Run tests
test:
	pytest tests/ --cov=. --cov-report=term-missing

# Run linter
lint:
	flake8 .

# Format code
format:
	black .

# Clean up
clean:
	find . -type d -name "__pycache__" -exec rm -r {} +
	find . -type f -name "*.pyc" -delete
	find . -type f -name "*.pyo" -delete
	find . -type f -name "*.pyd" -delete
	find . -type f -name ".coverage" -delete
	find . -type d -name ".pytest_cache" -exec rm -r {} +
	find . -type d -name "*.egg-info" -exec rm -r {} +

# Run locally
run-local:
	FLASK_ENV=development python app.py

# Run all checks before deployment
check: lint test 