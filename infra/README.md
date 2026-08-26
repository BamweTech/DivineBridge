# Infrastructure boundary

This directory is the canonical home for maintained infrastructure
documentation and non-conventional deployment definitions.

Root-level `Dockerfile`, `cloud-run-config.yaml`, `firebase.json`,
`firestore.rules`, `firestore.indexes.json`, and `storage.rules` remain at
their tool-required paths. Do not relocate or duplicate them until each CLI,
workflow, and deployment script has been updated and validated in staging.

The Flask container, Firebase configuration, and SFU deployment remain
separate runtime concerns.
