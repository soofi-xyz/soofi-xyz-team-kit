# Run report template

Fill one report per partner exchange. Keep credential values, customer names and
raw PII out; use credential and key names, identifiers and hashes.

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
| Purpose | Source (Account, secret ARN) | Keys | Planned Connect credential |
| --- | --- | --- | --- |

## 3. Dev credentials
| Purpose | Source (QA, prod read-only, test partner) | Connect credential | `state` / keys set / `used_by` |
| --- | --- | --- | --- |

## 4. Sample
| Item | Why | Expected outcome | sha256 |
| --- | --- | --- | --- |

## 5. Configuration
- Flow: <name>@<version> (<reference, unchanged | new>)
- Partner configuration: <configuration_id>
- Activation / job request: <id>
- Subject pinning: <parameters pattern for the user field | n/a>
- Values that must match: <each pair checked, or the mismatch found>
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
| No credential values in outputs | | |
| Latency / duration | | |

Cleanup: <activations disabled, objects removed, servers deleted>

## 7. Hand-off
- Product contract: <route, configuration_id, payload, reply, error codes>
- Added to dev suite: <test file, runbook row>
- Defects handed to lapras: <id, execution ARN, sample>
- Production steps: <credentials, allowlisting, configuration, activation, approval>
```
