# Appwrite TablesDB cutover in progress

The selected production data backend is the existing Appwrite TablesDB database
`6abe5c8c00331e943f9e` in project `6972444700208a437da1`, endpoint
`https://sfo.cloud.appwrite.io/v1`. Appwrite Storage bucket
`69cbf6750039400951c0` holds file bytes. Render has no attached persistent disk.

The API key supplied by the operator was validated against both the bucket and
database API and saved in Render's server environment. The local `.env` is ignored
by Git. Never put the key in browser code, documentation, or source control.

## Provisioned schema

`tablesdb_schema()` in the monolithic `alaada_workspaces.py` defines twelve
`aw_`-prefixed tables. They were created with empty table permissions and row
security enabled. The existing `users` table was not modified. The public API must
continue checking verified identity, workspace membership and explicit sharing;
the server API key bypasses Appwrite row permissions.

The SDK accepts `columns` for top-level table creation, but nested index objects
on this deployed Appwrite API require `attributes`. Composite index column sizes
must fit its 767-character limit. The current resource title index fits that limit.
Appwrite Python 24 returns typed models: rows expose application fields through
`.data`, transaction IDs through `.id`, and status fields may be enums.

## Transaction evidence and required implementation

Live disposable-row probes on 2026-10-01 established:

- A transaction that reads a row, then stages an update after another writer
  changes it can commit. A read alone does not protect an earlier version.
- Staging an update to the row's `guard` field **before** reading it causes the
  transaction to fail with HTTP 409 if another writer changes it before commit.
- Both probe rows were removed after the tests.

Protect rows used in read-modify-write decisions before reading them. Preserve
the current HTTP 409 conflict behavior, deterministic IDs, unique ownership and
pending-billing constraints, and atomic quota/subscription/resource changes.
Do not replace transactions with independent row writes. Do not load all tenants
into a local SQLite database or use the Render filesystem as a persistence layer.

## Current readiness

The routes now use a structured repository interface. `TablesSession` implements
it with the native Python SDK, deterministic row IDs, transaction guards and
private row permissions. `APPWRITE_DATABASE_ID` selects TablesDB at startup.
The SQL adapter is retained for compatibility and local tests. User backfill uses
one transaction per user to stay within Appwrite's operation limits.

The opt-in `tests/test_tablesdb_live.py` passed against this Appwrite database.
It covers personal Pro plus Enterprise isolation, wrong-workspace rejection,
membership removal preserving personal resources and plan, and HTTP 409 on a
stale concurrent write. It uses injected disposable identities and removes test
records, so it does not prove real browser authentication or product upstream
execution. Those require deployment checks.

The Appwrite upload URL was corrected to POST to the file collection. The file
acceptance tests now use a transport boundary that checks the Appwrite paths and
exercises actual multipart bytes. The backend also serves the Accounts CSS/JS
aliases and landing route through an explicit public-file allowlist. The 66 local
workspace tests pass using SQLite plus mocked identity/storage. The product client
behavior test passes for all four products. The separate live TablesDB test above
adds real database isolation/conflict evidence, not successful deployment proof.

The product pages, required Accounts assets, and tests were included in commit
`27f0b0b` and deployed to `https://alaada-workspaces.onrender.com`. Live HTTP
checks confirm TablesDB and Storage configuration, public product pages, and
401 for unauthenticated workspace access. Secrets and backend source return 404.
Do not deploy the standalone unauthenticated `main.py` policy example as the
workspace service.

The backfill now retries an individual idempotent user transaction up to five
times on a conflict or temporary database failure. A regression test confirms
that retries preserve an existing Pro plan. All 67 local workspace tests pass.
Existing-user backfill and the signed signup webhook still require completion
and verification. Billing and product gateway configuration remain incomplete;
a healthy workspace service alone is not full product production acceptance.
