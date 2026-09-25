# Run report template

Fill one report per partner exchange. Keep secret values, customer names and
raw PII out; use ARNs, identifiers and hashes.

```markdown
# <partner> <purpose> on Connect

## 1. Data
- Consumer and reply: <product>, <callback | task token | subscriber>
- Trigger: <schedule | drop zone | webhook | job | lookup | delivery>
- Transport and auth: <type>, <host/endpoint>, <auth profile>
- Objects: <format>, <observed field names>, size p50 <n> / max <n>, <n> per run
- Duplicate identity: <path+etag | partner id | transaction id>
- Classification: <configuration only | new flow | hand to lapras | not Connect>

## 2. Production credentials
| Purpose | Source secret ARN | Keys | Planned Connect copy |
| --- | --- | --- | --- |

## 3. Dev credentials
| Purpose | Source (QA, prod read-only, test partner) | Connect copy ARN | Tagged |
| --- | --- | --- | --- |

## 4. Sample
| Item | Why | Expected outcome | sha256 |
| --- | --- | --- | --- |

## 5. Configuration
- Flow: <name>@<version> (<reference, unchanged | new>)
- Partner configuration: <configuration_id>
- Activation / job request: <id>
- Schema validation: <command and result>
- Local proof: <command and result>

## 6. Dev run
| Check | Result | Evidence |
| --- | --- | --- |
| Job terminal status | | job id |
| Manifest valid | | |
| Checksums match | | |
| Reply signed | | |
| Rerun lands nothing | | |
| No secrets in outputs | | |
| Latency / duration | | |

Cleanup: <activations disabled, objects removed, servers deleted>

## 7. Hand-off
- Product contract: <route, configuration_id, payload, reply, error codes>
- Added to dev suite: <test file, runbook row>
- Defects handed to lapras: <id, execution ARN, sample>
- Production steps: <secrets, allowlisting, configuration, activation, approval>
```
