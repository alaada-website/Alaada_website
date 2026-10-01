# Personal and organisation workspace implementation

## Status and boundaries

`alaada_workspaces.py` is one monolithic service containing the Appwrite identity
adapter, database schema, HTTP API, permission checks and embedded HTML/CSS/JS.
`index.html` adds a Workspaces link to the signed-in badge. The existing Appwrite
Storage bucket is configured for per-file security. The workspace and Analyser
services have been deployed and verified against Appwrite; Sheets, Accounts,
Orbit execution and live billing still have outstanding production work.

This implements a new workspace resource service, not a completed migration of
the existing products. Do not describe the current website as fully isolated.
Orbit, Sheets, Accounts and Analyser now load the monolith's workspace client
instead of the organisation-only UMS guard. The product client verifies Appwrite
before initialisation, displays the workspace selector, reloads on switching and
never reads the previous unscoped browser storage. Orbit conversations/memory and
Sheets workbooks save to individually scoped server resources. Accounts backups
and Sheets local history use user/workspace-specific IndexedDB names. Analyser
has a report persistence hook after successful execution.

Orbit profile name and email are stored only in the scoped profile record. The
workspace client expires the two legacy site-wide `orbit_name` and `orbit_email`
cookies on each product page before its API calls, without reading their contents
or changing Appwrite session cookies. This removes a legacy cross-workspace copy;
it does not delete the saved profile or the old browser-storage migration source.

Local Accounts and Sheets backend repositories were located. Accounts CRUD now
has the authenticated gateway described below and requires both services to be
configured. Other legacy HTTP execution and collaboration sockets fail closed.
Orbit text chat and Web Analyser have the adapters described below. Orbit
voice/files/images and remote Sheets operations are not yet connected to
verified workspace-aware backends. Do not deploy these pages alone to the
old static hosting: they now require the workspace service. The homepage now
uses Appwrite consistently for sign-in and sign-out. Other UMS pages are unchanged;
the four core products require Appwrite rather than Supabase sessions.

## Run in staging

1. Use the existing Appwrite TablesDB database (`6abe5c8c00331e943f9e`) and
   private Storage bucket `Alaada_UMS` (`69cbf6750039400951c0`). Workspace tables
   use row security with no public permissions; the bucket enforces per-file
   security. Production workspace rows and file bytes stay in Appwrite.
2. Configure Render with `APPWRITE_DATABASE_ID`, `APPWRITE_STORAGE_BUCKET_ID`,
   `APPWRITE_PROJECT_ID`, `APPWRITE_ENDPOINT`, and `APPWRITE_API_KEY`. Give the
   server key only the TablesDB table/row and Storage file permissions needed by
   the service, and store it as a Render secret. Create or verify the private
   tables once with `python alaada_workspaces.py --provision-tablesdb`. Use the
   `tablesdb:<DATABASE_ID>` target in production; Render's filesystem and disk
   must not be used for application persistence.
3. If an older Render deployment has workspace data on a persistent disk, do not
   attach that disk to the new service. With the old service stopped for writes,
   export a one-time encrypted SQLite backup to an operator-controlled machine
   outside Render and verify its checksum. Run the migration from that machine
   with the backup as `--migrate-sqlite-from`, using
   `--db tablesdb:<DATABASE_ID>`, the Storage bucket ID, and API key in its
   environment. Review the table counts and
   verify sample file downloads from Appwrite before deleting the legacy Render
   disk. No application records or backups belong on Render's filesystem.
4. For local staging only, run `python alaada_workspaces.py --db /private/alaada/workspaces.sqlite3`.
4. Reverse proxy `/workspaces`, `/api/workspaces`, `/api/workspaces/*`, `/api/shared`
   `/api/appwrite/users-created` and `/api/billing/confirmed` to this service on the same HTTPS origin as the
   website. The homepage link requires this routing; static hosting alone is
   insufficient. Do not proxy unrelated existing `/api` routes here.
5. Register the staging hostname as an Appwrite Web platform, enable Google OAuth
   and its callback origin, and sign in. The service uses project
   `6972444700208a437da1` at `https://sfo.cloud.appwrite.io/v1`.
6. To register an existing authorised Enterprise team, an operator runs:
   `python alaada_workspaces.py --db /private/alaada/workspaces.sqlite3 --add-team TEAM_ID --name "Company name"`.
   This registers the team in this service only; it does not create or alter
   Appwrite membership. Run only for organisations with approved Enterprise access.

For local page previews, add `--web-root /path/to/Alaada_website`; only the five
specified product/landing HTML files are served, never database or secret files.
Assets remain the responsibility of the existing static host.

Personal provisioning is idempotent on the first authenticated workspace API
request. To provision before first use:

* Configure a dedicated Appwrite webhook for user creation events only, pointing
  to `/api/appwrite/users-created`. Set `APPWRITE_WEBHOOK_SECRET` and
  `APPWRITE_WEBHOOK_URL` to its secret and exact public URL. Verification uses
  Appwrite's documented HMAC-SHA1 of URL plus raw body, encoded with Base64.
  Replays are harmless: provisioning never resets an existing paid plan.
* Set `APPWRITE_USERS_READ_KEY` to an operator-only key restricted to `users.read`,
  then run `python alaada_workspaces.py --db /private/alaada/workspaces.sqlite3 --sync-users`.
  The cursor-paginated backfill persists IDs only, not emails, passwords or profile
  attributes. Retry safely after failures. Enable the webhook before the initial
  backfill to cover users created during the scan. Remove the key from the runtime
  after backfill; normal API requests never use it.

These provisioning paths are implemented and tested with synthetic responses.
The live Appwrite webhook and existing-user backfill have not been configured/run.

## Identity and authority

The browser obtains a short-lived Appwrite JWT from its session and sends it as
a bearer token. The server calls Appwrite `/account`, then paginates the current
user's teams and confirmed memberships on every request. It does not trust a
browser user ID, role, localStorage value, subscription or organisation claim.
Identity-service failures deny access. No server API key bypass is used on user
API requests; the separate operator backfill uses only `users.read`.

Appwrite team roles `owner`/`admin` map to organisation administrator, `editor`
maps to editor, and other confirmed members are readers. Personal ownership is
an independent Appwrite user ID; organisation membership cannot confer access.
An organisation administrator may read/manage that organisation's resources.
Resource IDs and workspace IDs are checked together on every operation.

Sharing targets one resource and an explicit Appwrite user ID; readers cannot
write and recipients cannot reshare. Folder shares do not recursively grant
access. The generic JSON payload is opaque and does not automatically retrieve
referenced files or children. Organisation shares additionally require current
organisation membership, including after removal. Personal shares are independent
of employment and remain until their personal owner revokes them.

Copy/move requires source ownership or organisation administration, destination
write permission, an explicit destination-ownership confirmation and matching
resource version. An ordinary organisation editor cannot export organisation
resources through this endpoint. Copies get new IDs and no inherited grants;
moves also delete the old resource and its grants in one transaction.

Workspace selection is tab-local. It is never persisted as a global default.
Writes capture an explicit workspace header and URL; mismatches fail. Selection
is locked while operations run, unsaved edits require discard confirmation, and
save asks the user to confirm the owning workspace. HTTP requests revalidate
permissions; 401/403 clear displayed private data. Returning to a visible tab
refreshes clean views. Revocation cannot retract content already downloaded by
a previously authorised user. There is no offline cache in the new service.

## Subscription and quotas

The shared-resource editor now supports recipients with explicit write grants.
Resource reads expose server-derived write/manage capabilities; these are UI hints,
not authorization supplied by the client. Every save rechecks the current grant
and version. Shared saves target the resource's owning workspace, explicitly name
that destination in the confirmation, and leave the active workspace unchanged.
Read-only grants keep the editor read-only. Write grants still cannot share,
transfer or list the owner's other resources. This is the workspace manager's
JSON editor; native shared-workbook editor integration remains outstanding.

The workspace manager now includes an in-app notification inbox. Sharing changes,
file uploads, transfers, company creation, completed Orbit replies, completed
analysis and personal subscription requests/confirmations create notifications in
the same transaction as their audit event. Personal events go to the personal
owner, including trusted billing confirmations. Organisation events go to the
acting user only. Listing and marking read require both current workspace access
and the exact recipient; administrators receive no implicit inbox access. Losing
organisation membership blocks that inbox while preserving the personal inbox.
The UI clears loaded notifications when workspace context changes. The API pages
50 events at a time with `next_before`; the initial manager view shows the latest
50. Notifications contain event identifiers, not resource contents. No external
email or push messages are sent by this implementation.

Private account notification preferences are available in the manager and through
`GET/PUT /api/account/preferences`. The endpoint always resolves the verified
Appwrite user's personal workspace; it accepts no target-user identifier. Writes
require that personal workspace context and an optimistic version. Users can
independently disable routine personal and organisation activity notices. Sharing,
ownership transfer and subscription notices remain enabled. Preferences are not
generic shareable resources, do not consume product quota, and survive plan or
membership changes. This controls the in-app inbox only; Appwrite identity,
password, MFA and email settings remain owned by Appwrite and are not changed here.

The workspace manager supports uploading and downloading files up to 512 KiB.
`POST /api/workspaces/{wid}/files` accepts a filename and base64 content; downloads
use `GET /api/workspaces/{wid}/files/{rid}/download`. Bytes are stored with their
size and SHA-256 digest in the existing resource transaction, and downloads
validate integrity before returning an attachment with an inert content type.
There are no public download URLs. Every download revalidates Appwrite identity
and the file's workspace or explicit resource grant. Sharing one file does not
grant workspace listing access. Existing confirmed copy/move operations carry
the bytes into the destination ownership scope without inheriting grants.
Organisation membership removal denies organisation downloads and leaves personal
files intact. Uploads consume one platform write; downloads do not consume writes.
Local-development SQLite databases and migration backups contain file bytes.
Production database rows reside in Appwrite TablesDB and file bytes reside in
Appwrite Storage; Render's filesystem is never used as a data store.
Large uploads and resumable transfers are not implemented by this initial
storage path.

Folders now have canonical membership links in the workspace database. The manager
can create folders, open their contents and place selected files/folders in a
folder or at the workspace root. Placement requires management permission and an
unchanged resource version, and rejects cross-workspace parents and hierarchy
cycles. It changes neither ownership nor grants. A folder grant applies to that
resource only; descendants require their own grants, and folder-content listing
requires workspace membership. Deleting a folder removes its membership links
and preserves its children at the root. Nonempty folders cannot be transferred:
move or copy each child with explicit ownership confirmation first, then transfer
the empty folder. These rules avoid silent bulk ownership or permission changes.

Personal Free, Pro and Elite subscriptions belong to the personal workspace.
An independent Enterprise subscription belongs to each provisioned organisation.
The sample policy limits monthly resource writes separately for every product:
Free 50, Pro 2,000, Elite 10,000, Enterprise 50,000. These are implementation
defaults, not approved commercial promises. Override with `ALAADA_LIMITS_JSON`
containing all four plan names and nonnegative integer limits before launch.
Platform resources use the same policy as the four core products.

Creation, update and copy/move into a workspace consume that workspace's product
quota atomically. Reads, sharing and subscription requests do not. Quotas do not
reset when a plan changes. Exceeding a downgraded limit blocks new writes but
preserves existing resources, access and ownership.

Upgrade, downgrade and cancellation create a pending billing request. Cancellation
requests Free. No request changes entitlements or charges a customer by itself.
There is one pending request per personal workspace. Identical retries reuse it.

The private `/api/billing/confirmed` adapter endpoint applies matching confirmed
requests atomically and deduplicates event IDs. Set a high-entropy
`ALAADA_BILLING_ADAPTER_SECRET`. An adapter signs the exact request bytes with
HMAC-SHA256 of `timestamp + '.' + raw_body` and sends `X-Alaada-Timestamp` and
`X-Alaada-Signature`. Timestamps expire after five minutes. JSON fields are
`event`, `request` (pending billing request ID), and `plan`.

A terminal failed payment may be resolved through `/api/billing/failed` with the
same signed fields plus `outcome: "failed"`. The outcome is covered by the body
signature and cannot be replayed to the confirmation endpoint. Failure preserves
the current subscription and resources, closes the pending request and permits a
new request. A late confirmation for that failed request is rejected. The adapter
must reconcile ambiguous provider outcomes before declaring terminal failure.

This signature protocol is NOT Dodo Payments' webhook protocol. A trusted billing
adapter must first verify the actual provider signature, account, customer,
product, payment status and effective date; only then may it call this endpoint.
That adapter is not a Dodo webhook integration. The connected `alaada.com` Chrome
profile shows the Alaada Dodo workspace in Live Mode with one ₹299/month Pro
subscription product, 0 active products, and no Elite product. Checkout, Dodo
signature verification, renewals, refunds and scheduled period-end cancellation
are still unimplemented. Keep live checkout disabled until the intended Pro
product is active, Elite terms and product are approved, and Dodo API/webhook
secrets are configured server-side. The UI labels requests as pending.

## Retention and employment changes

Removing an Appwrite team membership denies subsequent organisation requests,
including explicitly shared organisation resources. The workspace service never
deletes an Appwrite account or modifies personal subscriptions as a consequence.
Organisation-owned resources remain owned by the organisation and accessible to
remaining authorised administrators. They are retained indefinitely by this
initial service until a separately authorised retention policy is implemented.
There is no automatic purge, ownership transfer or account deletion job.
Personal data is retained independently. Legal hold, retention schedules and
organisation deletion need a separately approved implementation before launch.

Schema version 1 creates new tables only. It does not import or reassign existing
browser/legacy data. For local SQLite development, use SQLite's online backup API
before migrations. Production durability comes from Appwrite TablesDB and
Storage, never the deployment filesystem. Multi-host deployment uses the shared
Appwrite database; local SQLite remains single-host development only.

## Accounts backend gateway

The existing Accounts monolithic `app.py` now accepts a signed workspace gateway
contract while retaining its Appwrite verification and company membership checks.
Set `ALAADA_ACCOUNTS_UPSTREAM` on the workspace service to the fixed Accounts
origin (HTTPS, or HTTP loopback for development). Set
`ALAADA_ACCOUNTS_GATEWAY_SECRET` on that service and the matching
`ALAADA_WORKSPACE_GATEWAY_SECRET` on Accounts to a dedicated random secret of at
least 32 characters. Keep this secret on the servers. Set
`ALAADA_REQUIRE_WORKSPACE_GATEWAY=true` on Accounts; production enables the gate
automatically and fails closed without a secret. Development without the secret
or require flag retains the existing standalone backend behavior.

When the gateway secret or require flag is enabled, Accounts now enforces tenant
authentication and company security checks even in development. Demo-owner
substitution and permissive security-user compatibility behavior are disabled in
that mode. Integration tests deliberately enable demo seeding and disable the
standalone tenant-auth flag to verify they cannot weaken gateway authorization.

The browser sends fresh Appwrite JWTs through the workspace service. The service
checks membership, signs the exact method, target, body, token and workspace,
and requires a successful signed backend handshake before forwarding operations.
Accounts validates the assertion and the Appwrite identity. The gateway checks
membership again before returning data. Unsigned direct business API access is
rejected when the gate is enabled. Existing public health probes and OPTIONS are
exempt. Existing internal administration, docs and webhook callers must be audited
and integrated before production rollout; they are not broadly exempted.

New companies are bound to the active workspace in `accounts_bindings`.
Company lists use only those bindings, never the backend's global company list.
Company endpoints require a matching binding plus existing company permissions.
Legacy companies are not automatically claimed. Global backups, company imports,
restores and cross-product connectors require a separate authorised ownership
migration and are blocked by this gateway. The generic resource transfer UI does
not transfer native Accounts companies. No native company transfer is implemented.

Each mutating request reserves one Accounts write. A definite backend 4xx refunds
it; ambiguous failures retain the charge and are not automatically retried.
The remote company creation and local binding cannot be a single transaction:
an interrupted operation can leave an unbound company. Operators must reconcile
ownership from authenticated audit evidence before retrying or binding it. A
production reconciliation workflow and idempotent company creation remain needed.

Actual monolithic Accounts integration tests are in
`accounts-backend/tests/test_personal_workspace_gateway.py` in the delivery bundle.
Within the Accounts checkout, run these with `tests/test_appwrite_member_rbac.py`.
Set `ALAADA_WORKSPACE_SOURCE` to the workspace service source if it is not adjacent
to the packaged Accounts backend. Tests use disposable SQLite databases and mock
only the Appwrite boundary; they exercise real company, group and ledger routes.
They cover personal Pro plus Enterprise, company isolation, group isolation,
role downgrade, membership removal, personal subscription preservation, unsigned
access and signed-context tampering. They do not verify live Appwrite team changes.

## Orbit text execution

Configure `ALAADA_ORBIT_UPSTREAM` as the trusted origin of the stateless Orbit
monolith (`orbit-mono/main.py`, `/v1/prompt` contract), and set
`ALAADA_ORBIT_API_KEY` to a dedicated server-side key. Use HTTPS outside loopback.
`ALAADA_ORBIT_MODEL` is `simplex1` by default; `complex1` is also supported. Model
selection is server configuration, not a client-provided entitlement override.
Never use the older stateful Orbit service's globally listed sessions for this
adapter. No Orbit server was deployed or credentials created by this change.

The native page saves the user message first, then sends only its resource ID and
version to `/api/workspaces/{wid}/orbit/reply`. The service loads that conversation
and memory exclusively from the authorised workspace. It sends text to the
stateless backend with `privacy=true` and no external tools. Provider logs are not
returned. Access is rechecked after inference; a revoked membership or changed
conversation prevents saving or returning the reply. A successful reply increments
the conversation version and is saved before returning to the page. The browser
updates its version cache and disables editing/workspace switching during execution.

Each request reserves one Orbit write in addition to ordinary resource saves.
Failed or ambiguous provider requests retain the reservation and are never retried
automatically. This is the current shared usage policy; approved token, model and
feature entitlements still require product decisions. Context is bounded to 200
messages and 100,000 encoded characters. Attachments, images, streaming, voice and
tool execution remain blocked pending scoped adapters. A request already sent to
inference cannot be recalled by membership removal; its result is withheld and
not persisted if the post-execution access check fails.

The website suite covers cross-workspace conversation denial, memory isolation,
revocation during inference, version conflicts and client cache reconciliation.
A separate local contract check exercised the actual Orbit monolith's route,
authentication and request schema with inference and key lookup stubbed; no paid
provider call or live production request was made. Live inference and UI acceptance
testing with the configured deployment remain outstanding.

## Required product integration before production acceptance

The existing Sheets backend now includes an isolated signed calculation ingress
at `/workspace-gateway/formula`, with a signed `/workspace-gateway/health` check.
It requires `ALAADA_CALCULATION_GATEWAY_SECRET` of at least 32 characters and the
same HMAC envelope with audience `sheets-calculation`. It verifies the user and
workspace assertion, timestamp, exact method/target and body before invoking the
existing formula evaluator. Only formula, supplied cells/sheets and owner cell
reference are accepted; no persistent workspace or collaboration identifiers are
accepted. It limits requests to 1 MB, formulas to 10,000 characters and context to
50,000 cells. Existing Supabase route authorization is unchanged.

The browser's `/api/formula/eval` requests now route through
`/api/workspaces/{wid}/sheets/formula`. Configure `ALAADA_SHEETS_UPSTREAM` on the
workspace service and the same dedicated `ALAADA_CALCULATION_GATEWAY_SECRET` on
both services. The workspace service verifies current membership and a signed
health handshake before reserving one Sheets usage unit, then signs the exact
stateless calculation request. It rechecks membership before returning the result
and blocks switching while the request is in flight. Local browser calculations
remain unchanged. Failed/ambiguous requests retain their usage reservation; no
automatic retry occurs. Server responses are bounded to 1 MB.
Persistent collaboration and automation still need an explicit Appwrite identity
integration; the calculation gateway does not bypass their checks. The bundled
`sheets-backend/app.py` is an update for the existing Sheets checkout and still
requires that checkout's modules and dependencies. Its `tests/verify_gateway.py`
executes the actual gateway and request schema in ASGI with evaluation stubbed,
covering eight boundary checks; it is not a full backend deployment test.

The local Web Analyser monolith was found and now has a signed gateway boundary
(`analyser-backend/app.py` in the bundle). It requires
`ALAADA_WORKSPACE_GATEWAY_SECRET` of at least 32 characters. Direct analysis
fails closed by default. An explicit development-only standalone mode requires
both `ENVIRONMENT=development` and `ALAADA_REQUIRE_WORKSPACE_GATEWAY=false`, with
no gateway secret. Do not use that mode on a public service.

The gateway assertion uses the Accounts-style base64 JSON/HMAC-SHA256 envelope,
with audience `analyser`, signed user, workspace, timestamp, method, exact target
and body digest. Assertions expire after 15 seconds. Only signed `/analyze` and
`/workspace-gateway/health` operations are exposed; `/analyze_local` is denied.
Signed requests bypass the legacy IP quota because the workspace service must
reserve the owning workspace's quota before forwarding. Public root health and
OPTIONS do not execute analysis. The website now routes analysis through the
workspace gateway. Set `ALAADA_ANALYSER_UPSTREAM` on the workspace service to the
fixed HTTPS backend origin (HTTP loopback is allowed for local tests), and set
`ALAADA_ANALYSER_GATEWAY_SECRET` to the same dedicated secret configured on the
backend. The service verifies a signed handshake before reserving one Analyser
usage unit and forwarding analysis. It rechecks membership before returning or
persisting results; successful reports are stored in the owning workspace in the
same database transaction as their audit event. The page no longer performs a
second report save or incurs a duplicate storage charge. Responses larger than
1 MB are rejected. Failed/ambiguous execution keeps its usage reservation and is
not retried automatically. Live scanner/deployment verification remains required.
The native Analyser page now saves monitoring targets as individual scoped
`monitor` records, with a name, URL and preferred interval. Users can load, edit,
delete or run a saved target manually. Saved reports can be opened from the same
page after loading the workspace; reload to refresh newly generated report history.
Target deletion does not delete reports. Mutations retain optimistic version and
workspace permission checks, and the page prevents overlapping analysis runs.
The UI explicitly labels these configurations as manual: recurring monitoring
jobs remain unimplemented, so a preferred interval does not schedule execution.

All six scanner HTTP call sites now use a bounded public-web fetch function.
It rejects credentials, non-HTTP(S) schemes, non-web ports and DNS answers containing
private or special addresses, and connects directly to the checked numeric address.
Each redirect is separately validated (up to five redirects). HTTPS retains the
original hostname for certificate verification and SNI using Python's default TLS
context. Requests do not forward credentials or cookies and do not inherit proxy
environment settings. GET bodies are limited to 4 MiB; compressed responses are
rejected, so sites that ignore `Accept-Encoding: identity` cannot currently be
scanned. HEAD requests retain size headers without downloading bodies.

`analyser-backend/tests/verify_fetch.py` exercises the actual function against
deterministic socket, DNS, HTTP and TLS boundaries. Its 19 assertions cover private
destinations, mixed DNS answers, redirect validation, bounded size and TLS hostname
selection. No live scanner, provider or paid AI call is made by this check.
Python API references: https://docs.python.org/3/library/http.client.html and
https://docs.python.org/3/library/ssl.html#ssl.SSLContext.wrap_socket .

`analyser-backend/tests/verify_gateway.py` runs the actual two middleware functions
inside Flask with scanner/provider dependencies excluded. Install Flask and run
the script to exercise its 11 boundary assertions. This verifies authentication
gating only; it is not evidence of complete scanner integration or live analysis.

`analyser-backend/tests/verify_runtime.py` loads the full scanner monolith and
workspace service, runs their real routes and signed gateway contract, and verifies
personal/organisation report persistence, cross-workspace denial and membership
removal. HTTP content is a fixed HTML fixture, DNS network access is disabled, and
no AI key is loaded. This check passed locally. Install the backend requirements
plus the workspace service's FastAPI/httpx dependencies before running it. The
scanner now starts without an AI key (structured analysis remains available) and
supports `ALAADA_LEGACY_USAGE_FILE` for an isolated legacy development quota file.
The fixture uses a temporary quota file and database, preserving existing data.

* Route every product save/read/search/export through the workspace-authorised
  service or equivalent server-side checks in its own backend.
* The four supplied pages no longer read unscoped localStorage. Orbit's storage
  adapter splits conversations into separate records; Sheets snapshots are cloud
  records with scoped local versions. Complete an explicit ownership migration
  flow for old browser data; it is preserved and deliberately not auto-imported.
  Accounts' legacy backend company records still require authorised mapping.
* Apply product-specific validation, binary file storage authorisation, hierarchy
  checks, notification generation and account settings integration. File upload and
  download now support actual bytes, with canonical folder membership checks;
  larger object storage remains outstanding.
* Make AI execution, retrieval, memory, jobs, monitoring and tool calls carry an
  immutable authorised workspace context. Recheck membership at job execution and
  result retrieval, and debit verified usage in the same scope. The `/execute`
  endpoint currently fails closed with 503 and sends no external AI request.
* Connect real billing confirmation and approved plan/product entitlements,
  configure the implemented provisioning webhook/backfill, then run staging
  end-to-end tests.
* Audit existing organisation ownership, memberships and migration mappings before
  enabling the new selector inside legacy product editors.

## Tests

Run `python -m pytest tests/test_personal_workspaces.py -q`.
The suite requires Node.js for the product-client behavior test in addition to
Python, pytest, FastAPI and httpx. Tests exercise real HTTP routing and SQLite with a mocked Appwrite identity
boundary, not a live tenant or payment account. They cover personal Pro plus an
Enterprise seat, all resource kinds, removal, administrator isolation, direct-ID
access, sharing/revocation, concurrent quota enforcement, cancellation, billing
replay, version conflicts, native product records, transfer permissions, webhook
signatures and paginated backfill. The Node suite executes the actual client for
all four products and tests account changes, workspace context, membership removal,
separate Orbit conversations and blocking legacy outbound execution.
All four product gates were inspected in a real browser. An existing Appwrite
session successfully opened a personal workspace in Analyser and Sheets. A
synthetic Sheets cell was saved to the local workspace service (confirmed in its
SQLite record) and restored after a browser reload. No Appwrite account/team or
production product data was modified by that local smoke test. Paid-plan and
organisation scenarios remain mocked; real payments, organisation membership
changes and product execution adapters still require staging verification. Local
Accounts and Sheets backend sources were found; Accounts now has the gateway above.
The Sheets backend still needs an audited Appwrite integration with its existing
identity model. Orbit text execution has local contract coverage and Web Analyser
has gateway isolation coverage. Live Analyser execution and Orbit's other execution
features remain unverified.

The targeted Accounts regression run passed 20 tests. A broader mixed-module run
encountered an existing monolith/modular import-order collision during fixture
setup (`CompanyService.replace_memberships_with_owner` missing); therefore the
full Accounts suite is not certified by this work. The production docs test passed
when run in its own fresh process.

Appwrite identity references:
https://appwrite.io/docs/products/auth/jwt
https://appwrite.io/docs/references/cloud/server-rest/teams
https://appwrite.io/docs/apis/webhooks
https://appwrite.io/docs/references/cloud/server-rest/users

### Local browser verification (29 September 2026)

The manager was exercised in the Codex browser against the local SQLite preview
using an existing Appwrite session. Creating a synthetic personal folder and
reloading confirmed persistence; loading private account preferences succeeded.
Native browser prompts were unsupported in this browser, so the manager now uses
an accessible in-page input dialog. The active-workspace header remains visible
while scrolling. No production resources, billing or memberships were changed.
The workspace and schema suite passed 72 tests. This check does not establish the
personal-Pro-plus-Enterprise acceptance scenario, which still requires staging
configuration and real membership removal verification.

Generic resource edits preserve the native product key, including whether the
record has one. Shared editors may edit the authorised record's contents but
cannot inject, replace or remove its identity to impersonate another product
record during client loading. Rejected edits leave payload and version unchanged.

The manager's Share / revoke dialog loads the selected resource's current explicit
grants before accepting a recipient. The grant inventory requires management
permission; a shared editor cannot list other recipients. The dialog distinguishes
explicit grants from workspace role access, which is managed by membership.

The combined Pro/Enterprise lifecycle acceptance test now exercises native Orbit
conversation and memory records, Sheets workbooks, Accounts ledger records, and
Analyser reports and monitors. It checks role reduction, membership removal despite
an explicit grant, preservation of personal payload/version and Pro subscription,
and retention of organisation payloads for its administrator. This is local HTTP
and SQLite verification with a simulated Appwrite identity boundary; it does not
certify live Appwrite removal or upstream Accounts financial operations.

The repository includes a Render Blueprint for the monolithic API with no
persistent disk; its production startup rejects SQLite and non-Appwrite database
hosts. The live Render service still has a 10 GB disk attached at `/var/data`,
and its configured start command explicitly selects
`/var/data/workspaces.sqlite3`. The latest deployment of the SQLite rejection
guard failed with status 2; the public health endpoint's HTTP 200 is from the
previous successful deployment and does not prove Appwrite storage is active.
Render is missing `APPWRITE_DATABASE_URL` and `APPWRITE_API_KEY`; the Appwrite
project currently has TablesDB but no native PostgreSQL database. Do not store
production workspace rows or files on Render. Export and migrate any required
legacy data before removing the disk, then configure Appwrite credentials and
deploy the no-disk Blueprint. The Cloudflare reverse proxy also remains to be
configured.
