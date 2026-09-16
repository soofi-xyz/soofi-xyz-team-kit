# External Dependency Boundary Audit & Remediation Stories

This audit reviews existing workflows across the repository ecosystem against the canonical **External Dependency Boundary Rule** defined in `skills/apply-engineering-guidelines/rules/external-dependency-boundaries.md` and `skills/build-batch-workflows/rules/principle-throttling.md`.

---

## 1. Executive Summary & Audit Matrix

| Workflow / Component | Target System | Interaction Type | Current Pattern | Rule Compliance | Violation Severity | Remediation Story |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **DSA Document / Letter Handoff** | Interprose API / External Agency Portals | Outbound burst mutation | Inline batch dispatch in Step Function workers | ❌ Violates | **CRITICAL** | `REM-EXT-01` |
| **Mail Campaign Short-URL Issuance** | `short-url-service` / External Redirects | High-volume fan-out | Step Function Distributed Map without task tokens/throttling queue | ⚠️ Partial Risk | **MEDIUM** | `REM-EXT-02` |
| **Direct Communication Send (SMS/Email)** | External Delivery Gateways (LiveVox / Twilio / SendGrid) | Outbound burst notification | Unbuffered direct provider calls without adapter boundary | ❌ Violates | **HIGH** | `REM-EXT-03` |
| **Portal Real-Time Debt Verification** | Persist / Core Platform API | Interactive user lookup | Synchronous HTTP read with strict timeout and fallback | ✅ Compliant (Sync Exception) | **NONE** | N/A (Standard Sync Exception) |
| **Internal Batch Filter / Solver Handoff** | S3 / Internal Step Functions | Internal state machine handoff | EventBridge / Step Functions execution trigger | ✅ Compliant | **NONE** | N/A (Internal Low-Volume) |

---

## 2. Evaluation Scenarios

### Scenario A: DSA Correspondence to InterProse $\rightarrow$ Queued Boundary (Compliant Target)
- **Context:** Debt Settlement Agency letters and status updates dispatched to InterProse or agency portals.
- **Evaluation:** Outbound mutations with burst volume and external API rate limits.
- **Decision:** **Asynchronous (Queued)**.
- **Architectural Requirement:**
  - Enqueue requests to SQS with Step Functions `WAIT_FOR_TASK_TOKEN`.
  - Single/controlled-concurrency Lambda consumer with `p-throttle` matching InterProse API quotas.
  - Atomic idempotency key recorded in DynamoDB before HTTP POST.
  - Self-resolving DLQ with CloudWatch Alarm routing to PagerDuty.

### Scenario B: Interactive Portal Lookup $\rightarrow$ Synchronous Direct Call (Allowed Exception)
- **Context:** Consumer enters account number in the payment portal to look up balance.
- **Evaluation:** Real-time human user waiting on HTTP response.
- **Decision:** **Synchronous (Direct)**.
- **Architectural Requirement:**
  - Inline query directly to `persist` via dedicated reader (`readerTarget: "payment_portal"`).
  - Strict client timeout ($\le 5\text{s}$).
  - Documented fallback and graceful error display if backend is unavailable.

### Scenario C: Replaceable SMS/Email Gateway $\rightarrow$ Adapter Interface Behind Queue
- **Context:** Sending notification messages to consumers via third-party telecom/email providers.
- **Evaluation:** Vendor migration likelihood is high; third parties suffer frequent upstream rate-limits and outages.
- **Decision:** **Asynchronous (Queued) + Adapter Interface**.
- **Architectural Requirement:**
  - Messages queued to SQS with bounded concurrency.
  - Consumer implements `CommunicationProviderAdapter` interface (hiding vendor-specific SDK).
  - Delivery DLQ with replay runbook.

### Scenario D: Low-Volume Internal Microservice API $\rightarrow$ Direct Call Without Queue
- **Context:** Workflow resolving deployment status or parameter store values within the internal AWS VPC.
- **Evaluation:** Internal high-reliability, low-latency dependency with bounded volume.
- **Decision:** **Synchronous (Direct)** without queue overhead.
- **Architectural Requirement:**
  - Standard SDK retry budget and timeout.

---

## 3. Remediation Stories for Concrete Violations

### Remediation Story 1: Decouple DSA Interprose Dispatch Behind a Throttled Queue Boundary
- **Ticket ID:** `REM-EXT-01`
- **Component / Service:** `orchestrate-workflow` / DSA integration / `furret` operations
- **Violation:**
  - Direct inline calls to Interprose during DSA batch runs risk 429 throttling, socket timeouts, and cascading failures that fail parent Step Function executions.
  - Lack of atomic idempotency causes duplicate letters/dispatches on workflow retry.
- **Acceptance Criteria:**
  1. Introduce an SQS FIFO/Standard queue with Step Functions task token callback (`WAIT_FOR_TASK_TOKEN`) for InterProse document dispatch.
  2. Implement a rate-limited consumer Lambda with `p-throttle` respecting InterProse concurrency limits.
  3. Store atomic idempotency keys in DynamoDB (`hash(debt_id, dsa_id, document_type, date)`).
  4. Attach a dead-letter queue with a self-resolving CloudWatch Alarm connected to PagerDuty.
  5. Provide an SQS message move redrive script for DLQ drain.

### Remediation Story 2: Internal High-Fanout Hardening for Mail Campaign Short-URL Issuance
- **Ticket ID:** `REM-EXT-02`
- **Component / Service:** `mail-campaign`
- **Context & Risk (Internal High-Fanout Boundary):**
  - While `short-url-service` is an internal microservice, the Step Functions Distributed Map fans out unbounded parallel `POST /shorten` calls. During large campaigns (e.g. 100k records), this internal burst mimics an unthrottled DDoS on internal VPC endpoints, risking Lambda concurrency exhaustion and downstream database connection depletion.
- **Acceptance Criteria:**
  1. Add bounded concurrency (`maxConcurrency: 50`) on the Step Functions Distributed Map to prevent downstream connection exhaustion.
  2. Implement an adapter layer with retries and exponential backoff for short URL resolution.
  3. Wire execution failure alerting to PagerDuty per `observability-pagerduty-alerting`.

### Remediation Story 3: Introduce Provider-Agnostic Adapter & Queued Dispatch for Communication Activities
- **Ticket ID:** `REM-EXT-03`
- **Component / Service:** `chatot` / Communication runtime
- **Violation:**
  - Tightly coupled direct vendor calls expose communication workflows to vendor-specific outage cascades and make future carrier/provider migration difficult.
- **Acceptance Criteria:**
  1. Extract a TypeScript `CommunicationProviderAdapter` interface separating canonical message intents from vendor payload formats.
  2. Route all outbound sends through SQS with bounded consumer concurrency and atomic deduplication.
  3. Configure DLQ monitoring per `observability-dlq-alarms` and automated redrive procedures.
