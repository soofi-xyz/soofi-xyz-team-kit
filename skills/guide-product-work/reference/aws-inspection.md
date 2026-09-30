# Give a concise AWS inspection handoff

Use this for every implementation iteration. Discover the actual target from
the repository, deployment outputs and returned execution metadata. Reuse the
selected AWS profile; verify account and region. Name those in the handoff.
Obtain resource-specific console links from actual resources/outputs and retain
an exact resource-name navigation fallback. Never invent an execution ARN.

Give one copyable product invocation, its configuration/fixture and expected
result. After the person runs it, resolve the returned request/job/execution ID
to the actual resources. Use no more than three numbered AWS steps:

1. **Open the run:** AWS console → Step Functions → the named state machine →
   Executions → the returned execution. Supply the direct link when available.
2. **Inspect the change:** select the named state in Graph or Table view. Compare
   its Input and Output with the expected value; for a failure, inspect its cause
   and retry history. Name the state and value, not just “check the workflow”.
3. **Match the logs:** follow that task's CloudWatch log link or open the named
   log group in CloudWatch Logs Insights. Set the run's short time window and
   filter on the verified correlation field/request ID. Supply the exact query
   using the real log schema; name the event/value to compare.

Step Functions exposes state input/output and task log links; Express execution
history depends on configured CloudWatch logging. If history is unavailable,
identify the logging/access gap rather than substituting a fabricated trace.
See [AWS execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html).

Use the execution surface that actually exists. For a synchronous API with no
state machine, say so and use its request-correlated service/Lambda logs and
returned result. Do not provision a workflow just for this lesson. For Glue,
open the named job → Runs → the returned run ID, then its Output/Error log links;
compare the job result and output artifact. See [Glue run details](https://docs.aws.amazon.com/glue/latest/dg/view-job-runs.html)
and [CloudWatch Logs Insights](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/AnalyzingLogData.html).

Adapt the three steps to the product guide. Keep queue/trigger inspection
read-only; inspecting an asynchronous outcome must not consume a production
message or retry a real external action. Missing permissions or telemetry is a
pending inspection checkpoint, not permission to grant broad access.

End with a specific request, for example: “Reply with the execution ID, the
Transform state's output amount, and whether the Persist log shows a duplicate
write.” Request one or two sentences and redacted identifiers, not raw log dumps.
If the run failed unexpectedly, diagnose this iteration with the person before
continuing. A green workflow alone does not prove the expected business result.
