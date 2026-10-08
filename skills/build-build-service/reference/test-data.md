# Build test data and dependency fakes

Create tiny synthetic source projects in the target repository's test area. Use
its current manifest schema and approved construct versions; the matrix below is
a fixture recipe, not an existing uploaded archive or promised endpoint payload.
Do not commit generated ZIPs, cloud assemblies, credentials or signed URLs here.

| Fixture | Contents / variant | Required observation |
| --- | --- | --- |
| Minimal service | Valid SERVICE manifest, lockfile and one parameterized no-asset CDK stack | Job submits through API and produces a portable assembly with terminal status |
| Configuration bundle | Supported DATA manifest, configuration assets and custom-resource declarations referencing a shared provider; change one payload with unchanged service code | Portable assembly preserves payload digests and provider requirements, changes affected identity, contains no per-bundle Lambda and makes no target API calls |
| Runtime asset | Small approved Lambda construct using a synthetic constant response | Final staged assets satisfy minification/obfuscation policy and exclude source maps |
| Invalid archive | Separate traversal, oversized, malformed manifest, private-address source URL and command-hook cases | Reject before runner side effects; no source URL credentials in logs |
| Failing source | Failing fixed test or prohibited account/VPC lookup | Terminal failure explains the stage; no deployment, tenant credentials or usable artifact |
| Tampered result | Alter one template or asset after manifest hashes are computed | Independently recomputed digest fails verification |
| Delivery and expiry | Fake callback succeeds, times out then succeeds, or always fails; fake clock expires only owned artifacts | Retry behavior and build result remain distinct; cleanup respects retention |

Use two supported worker/options configurations and two authorized test callers.
Deny cross-caller reads. Keep the baseline artifact identity fixed while changing
one option at a time; reruns are validation within a feature, not new increments.

Fake source hosting, CodeBuild, S3 and callback delivery for local tests. In the
deployed test increment, use a controlled source host and actual isolated test
runner when validating synthesis/assets; keep external callbacks and consumers
mocked. A canned fake runner result proves orchestration only. Inspect API request,
Step Functions execution, runner logs, result manifest and artifact bytes together.
Never claim that Build artifact creation proves Marketplace publication or Deploy.
