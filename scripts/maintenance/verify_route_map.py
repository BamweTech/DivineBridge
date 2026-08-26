"""Print the stable Flask route contract for migration review.

Run with ``USE_LOCAL_STORAGE=true python scripts/verify_route_map.py`` and
compare the output before and after a route migration. It intentionally uses
only URL, methods, and endpoint identity so implementation moves remain free
to change internals without changing the deployed surface.
"""

from pathlib import Path
import sys

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
# Keep repo root first so ``scripts/`` cannot shadow stdlib packages (e.g. email).
sys.path[:] = [str(REPOSITORY_ROOT)] + [
    p for p in sys.path if p not in {str(REPOSITORY_ROOT), str(SCRIPTS_DIR), ""}
]

from app import app  # noqa: E402


def main():
    for rule in sorted(app.url_map.iter_rules(), key=lambda item: (item.rule, item.endpoint)):
        methods = ",".join(sorted(rule.methods - {"HEAD", "OPTIONS"}))
        print(f"{methods:12} {rule.rule:70} {rule.endpoint}")


if __name__ == "__main__":
    main()
