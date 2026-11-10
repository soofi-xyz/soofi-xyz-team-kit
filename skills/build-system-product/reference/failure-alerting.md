# System failure alerting

When System breaks, record it in Persist, show it in reports and tell the people
who can fix it. It works for every flow System runs, with no per-repository setup.
The target repository's README sections "Alert contacts" and "Issues to Persist"
hold the exact contract. Read them, `src/alerts/` and `src/issue/` before changing
this behavior, and keep this file's rules.

## Record failures in Persist

- Turn it on with the install parameter `IssuesToPersist`, default `Disabled`.
  Install the Model `system` extension in Persist first: Persist refuses its labels
  until then, and every write waits in the dead-letter queue.
- To turn it off, set `Disabled` explicitly. Removing the key keeps the installed
  value.
- Open a `FAILED_RUN` issue when a run ends `FAILED`, `TIMED_OUT` or `ABORTED`, and
  an `ALARM` issue when one of this stack's alarms enters `ALARM`. Drop alarms of
  sibling stacks whose names extend this one.
- Keep two alarms per flow, `SystemFlow/<stack>/<flow>/failed-run` and
  `.../timed-out-run`, on the `System/Flows` metrics `RunsFailed` and
  `RunsTimedOut`. Count an aborted run as failed.
- Write flow alarms on `PUT /flows/{name}`, not in the stack template. Reconcile
  them on each install with `Custom::FlowAlarms`.
- Resolve a failed run when a later run of the same flow succeeds, and an alarm
  issue when the alarm enters `OK`.
- Expect an alarm already firing when the writer is switched on to write nothing
  until it clears and fires again. The writer sees transitions only.
- Store the error name only. Never store a run's input, output or cause, or an
  alarm's reason.

## Show failures from Persist

Reports and Console read `system_issue` records from Persist through a
`persist-gremlin` report source. Never read CloudWatch from a report or a Console
page: CloudWatch is only where an alarm first fires. Bronzor configures the report
and Vivillon configures the page.

## Decide who is told

One flow failure sends one message to each person. A flow's own alarms record an
issue and send nothing; the failed run itself sends the message.

| Failure | Texted |
| --- | --- |
| Configuration fault | Registered contributors of the binding's `repository`, else the flow's, else the base product's |
| Fault in the product | Registered contributors of the base product's repository |
| No identifiable step, or a failure inside a `Batch` | Registered contributors of the flow's `repository` |
| Upstream workflow failure | Registered contributors of the `upstream` entry's repository, else the flow's |
| Trigger event naming a flow | Registered contributors of the flow's repository |
| Stack alarm with no flow, or trigger event naming no flow | Registered contributors of `SYSTEM_REPOSITORY` |
| Nobody matched, or the GitHub lookup failed or ran out of time | Every registered number, so no failure is silent |
| Failing binding, or every binding of the flow, is `mock-*` | Nobody |

- A contributor is anyone who authored, committed, opened or merged in that
  repository, bots excluded, whose login has a row from
  `PUT /failure-text/registrations/{login}`.
- Add the flow's `alerts.contacts` or the `AlertContacts` parameter to that list,
  and text a number found in both once.
- Send email and Google Chat only to configured contacts. Keep Chat webhook URLs
  in Secrets Manager under `system/alerts/chat/`.
- Never return contacts from `GET /flows/{name}`; return counts only.

## Keep messages safe and few

- Start every message with `Prism Team Alerts:` and end every SMS with
  `Reply STOP to opt out.`. The toll-free registration's message samples show both.
- Include only the flow, kind, time, step, repository and an error code. Never
  include a cause, an alarm reason or a person's details, in the message or in logs.
- Send at most one message per flow and repository, or per stack alarm, in
  15 minutes. Dedupe by execution, status and redrive count, so a redrive that
  fails again sends one more.
- Claim each firing and target with a conditional write before sending, holding
  only a hash of the target. Fix the recipients on the first attempt so a retry
  reaches only those still unsent.
- Bound retries into `AlertNotifierDlq` with an alarm, and keep the notifier from
  paging itself. Do not redrive that queue without the owner: old failures send late.

## Make SMS deliverable

SMS is an AWS account setup, not only code. Check each item before saying texts work.

- Treat an accepted publish as unproven. In the SMS region, read SNS
  `NumberOfNotificationsDelivered`, `NumberOfNotificationsFailed` and
  `SMSSuccessRate`.
- Check the account's monthly SMS spend limit (new accounts have $1), and whether
  the account is in the SNS SMS sandbox, where only verified numbers receive texts.
  Raising the limit and leaving the sandbox go through AWS Support.
- Answer every AWS Support question on the case. An unanswered question stalls it.
- Prepare these before submitting a US toll-free registration: a public privacy
  policy with an SMS section, public SMS terms, a public opt-in form with a required
  unchecked consent box and its screenshot, HELP and STOP keyword replies, and
  message samples that match what System sends.
- Edit a denied registration through a new version. A new version loses earlier
  field values such as company and contact details, so copy every field from the
  previous version and re-put it before submitting.

## Avoid the mistakes production found

- Give a Lambda entry point the event alone and put injected services on a separate
  function. Lambda always passes its context second, so `handler(event, injected)`
  crashed on every event while every test passed mocks in that position. Test the
  real exported `handler` with a Lambda-context-shaped second argument, and compare
  the environment variables it reads with the synthesized function
  (prismteam-ai/system#101).
- Add an explicit CloudWatch `SNS:Publish` Allow to an alarm topic that uses
  `enforceSSL`. Its Deny-only policy replaces the default policy, so alarm actions
  fail silently (prismteam-ai/system#92).
- Acknowledge a trigger's `409 IDEMPOTENCY_CONFLICT` as a duplicate only when the
  run its key names is `RUNNING`, `PENDING_REDRIVE` or `SUCCEEDED`. Otherwise several
  watchers of one file fill the trigger DLQ (prismteam-ai/system#92).
- Prove a new sender with a real alert before removing the old one, so a broken
  install does not leave nobody alerted.

## Verify and report honestly

- Build alert logic with mock tests, then run the real handler path.
- Do not claim a Persist write from a stage that has no Persist or Model.
- Prove a write with a real failed run: the issue opens in Persist and resolves
  on a later success.
- Report each level separately: tests passed, installed, message accepted by SNS,
  message delivered to a phone.

Celebi owns each flow's `repository`, `upstream` and `alerts.contacts`.
