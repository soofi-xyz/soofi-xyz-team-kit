# Infrastructure Discovery Contract

Before designing any CDK or writing any deploy code for a Linoone-built service, the agent MUST run a structured infrastructure-discovery pass against every target AWS account. The reuse-vs-provision discipline in `SKILL.md` is meaningless without an accurate inventory; this rule encodes how to gather it and what to do with the results.

## 1. When To Run Discovery

Always, before any of:
- Authoring or modifying CDK stacks
- Writing any `route53` / `acm` / `cloudfront` / `events.EventBus` construct
- Documenting "reuse decisions" in the architecture artifact
- Promising the user a domain name, a bus name, or a deployment timeline

Discovery is **not** optional, and "I assume X exists" is **not** a substitute. Read the actual account.

## 2. Required Discovery Pass

For every target account (dev, staging, prod), capture:

```bash
export AWS_PROFILE=<target> AWS_REGION=<service-region>

# Identity confirmation
aws sts get-caller-identity

# Domain & DNS
aws route53 list-hosted-zones --output table
aws acm list-certificates --region us-east-1   # CloudFront cert region
aws acm list-certificates --region <service-region>
aws apigatewayv2 get-domain-names
aws apigateway   get-domain-names

# Edge & CDN
aws cloudfront list-distributions

# Eventing
aws events list-event-buses
aws events list-rules --event-bus-name default | head -50

# CDK readiness
aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version
aws ssm get-parameters-by-path --path /cdk-bootstrap/

# Existing stacks (so we know what we're sharing the account with)
aws cloudformation list-stacks \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[*].[StackName,LastUpdatedTime]' --output table
```

If any of these fail with permission errors, **escalate to the user** before proceeding. Permission errors are not "skip and move on" — they're "I can't satisfy reuse-vs-provision discipline without this."

## 3. Decision Matrix After Discovery

The findings drive concrete v1-vs-defer choices:

### Custom domain decision tree

```
Is the target prod domain in the target account's Route 53?
├── Yes → Reuse the existing hosted zone. Add A/AAAA record for the resolver.
└── No
    ├── Is there a delegated subdomain pattern already in use?
    │   ├── Yes → Use the same pattern.
    │   │        - Request ACM cert via DNS validation
    │   │        - Output the validation CNAME for the user to add upstream
    │   │        - If user cannot add upstream, fall back to API Gateway default URL
    │   └── No  → Use API Gateway's default URL for v1.
    │            Custom domain becomes a v1.1 change once DNS delegation is sorted.
```

**Anti-pattern**: registering or transferring domains as part of a Linoone deploy. Domain ownership is an organizational concern, not a CDK concern.

**Important implementation detail**: when using the API Gateway default URL in dev, IssueFn must return that actual resolver endpoint in the `short_url` response (for example, `https://abc123.execute-api.us-east-2.amazonaws.com/<token>`). Do not return a placeholder custom domain unless DNS is actually delegated and routable.

### Engagement bus decision tree

```
Does an engagement bus already exist?
├── Yes → Reuse it. Linoone publishes to it; never create a parallel bus.
└── No
    ├── Is a separate "shared infrastructure" repo planned to own the bus?
    │   ├── Yes → Linoone creates a TEMPORARY bus and documents the planned migration.
    │   │        Architecture artifact MUST list "owned by Linoone today, transferable to <repo> on <date>".
    │   └── No  → Linoone creates the bus and owns it long-term.
    │            Document this as a non-temporary ownership decision.
```

**Anti-pattern**: silently creating a `linoone-events` or `short-url-events` bus when a shared engagement bus is the agreed company pattern. Per-service buses are explicitly forbidden by `SKILL.md`.

### CDK qualifier decision tree

```
Is /cdk-bootstrap/hnb659fds/version present?
├── Yes (default qualifier) → Use the default CDK bootstrap.
└── No
    ├── Is there a custom qualifier (e.g. /cdk-bootstrap/<custom>/version)?
    │   ├── Yes → Pass --context @aws-cdk/core:bootstrapQualifier=<custom> on every cdk command.
    │   │        Document the qualifier in the repo's README and justfile.
    │   └── No  → Account is not CDK-bootstrapped. Escalate.
```

This has been a real failure mode in past deployments — encoding it here so a future agent does not waste time debugging "missing bootstrap version" errors.

## 4. The Architecture Artifact

After discovery, the agent MUST produce or update an `INFRASTRUCTURE.md` (or equivalent section in the README) that lists:

| Section | Contents |
| --- | --- |
| Account & region | Account ID, profile name, region |
| Reuse decisions | Each shared resource with ARN/ID and rationale (Route 53 zone, ACM cert, CloudFront distribution, EventBridge bus, etc.) |
| New resources | Each newly provisioned resource with rationale ("no existing X found in account Y") |
| Domain story | Current dev domain, planned prod domain, fallback if domain delegation is delayed |
| Bus ownership | Who owns the engagement bus today and what the migration path is, if temporary |
| CDK qualifier | Default or custom; commands needed to deploy |

This artifact is the single source of truth for "where is this service running and what does it depend on." It is updated when discovery findings change.

## 5. Specific Findings Encoded From Past Builds

These are real lessons from past builds. They MUST be checked at every new discovery pass:

- Target accounts may have no Route 53 hosted zones present in the account itself.
- DNS may be delegated externally; subdomains for in-account services may require adding validation CNAMEs upstream.
- CDK bootstrap qualifiers may be default or custom. Always re-check with `aws ssm get-parameters-by-path --path /cdk-bootstrap/` before deploying.
- A shared engagement EventBridge bus may not exist yet. The first service to need it may provision it temporarily.
- Existing stacks may already occupy expected names; choose stack names that do not collide.

These findings are illustrative, not exhaustive. **Always run discovery fresh** — they may have changed.

## 6. Failure Modes To Surface

If discovery uncovers any of these, **stop and ask the user** rather than improvise:

| Finding | Why it blocks |
| --- | --- |
| No CDK bootstrap (default or custom) in target account | Cannot deploy at all |
| Required prod domain doesn't exist in any account I can see | Cannot route real traffic in prod |
| Existing CloudFront distribution serves the planned short domain with conflicting behaviors | May break legacy short-link URLs |
| Existing engagement bus exists with a different name or schema convention | Need user to confirm whether to align or coexist |
| Permission denied on any of the discovery commands | Reuse-vs-provision discipline cannot be satisfied with partial visibility |

## 7. Discovery Outputs Drive Agent Updates

When discovery surfaces a structural reality the agent didn't know about, **update the agent**. Examples that should produce an agent update:

- "Dev account has no hosted zones, dev domains follow a delegated-subdomain pattern" → encoded above
- "Engagement bus doesn't exist anywhere; the first service to need it provisions it" → encoded above
- "CDK bootstrap may use a non-default qualifier; always check before deploying" → encoded above

This rule should grow over time as we hit more environment realities. The goal is that a fresh agent, given only this rule, can replicate the discovery and decisions correctly.

## 8. Dev Integration Test Capture Pattern

For v1 dev testing, create a temporary SQS queue and EventBridge rule that captures `GraphFactProduced` events for `detail.fact_type = short_url.visited`, then delete both after the test. When granting EventBridge permission to send to the queue, `aws sqs set-queue-attributes` expects a JSON map of attributes:

```bash
aws sqs set-queue-attributes \
  --queue-url "$QUEUE_URL" \
  --attributes "{\"Policy\":\"$ESCAPED_POLICY_JSON\"}"
```

Do **not** use `--attributes Policy=<json>`; the AWS CLI parser treats the embedded JSON quotes as malformed attribute syntax. This was a real integration-test failure during the first `short-url-service` deploy.
