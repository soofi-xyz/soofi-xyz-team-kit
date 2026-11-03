# Step secrets and readable buckets

Two install-level facts decide whether a flow can run at all: which secrets its
steps may send, and which buckets its runs may read. Both are install
parameters of the System stack. Record them as install prerequisites in the
configuration bundle, so Deploy sets them before the flow is installed. Do not
patch them by hand after a run fails.

## Give a step a secret value

Never put a secret value where System or a product keeps it:

- invocation input;
- flow binding `parameters`;
- template literals;
- a parameters file staged in S3 for each run.

Each of these copies the value into execution state and history, a bucket, or a
log.

Use `Secrets` on a shared-domain api step (`"Invoke": "api"`, no `Product` or
`Binding`, method POST, PUT or PATCH). System's product-call function reads the
secret when it sends the request and puts the value into the body at the dotted
path:

```json
"StartRun": {
  "Type": "Product",
  "Invoke": "api",
  "Request": { "Method": "POST", "Path": "/transform/runs" },
  "Parameters": { "contractVersion": 2, "run_id.$": "$.input.runId" },
  "Secrets": {
    "parameters.postbackAuth": {
      "SecretArn": "arn:aws:secretsmanager:us-east-2:111122223333:secret:voapps-postback-basic-AbCdEf",
      "JsonKey": "basic"
    }
  },
  "Next": "WaitForRun"
}
```

- **What the run keeps:** only the ARN appears in the template, the run's state,
  history and logs. A value the product echoes back is replaced with
  `[REDACTED]`.
- **Install prerequisite:** the ARN must be listed in the install's
  `StepSecretArns` parameter, as a comma-separated list of full ARNs including
  the six-character suffix. A template naming an unlisted ARN is refused at save
  (`TEMPLATE_INVALID`). A secret removed from the list later fails the step as
  `Product.NotConfigured`. A secret encrypted with a customer-managed KMS key
  also needs that key policy to let System's product-call role decrypt.
- **Steps that cannot carry `Secrets`:** workflow steps (`"Invoke": "workflow"`),
  function steps and signed api steps (`Product` or `Binding`), because
  Step Functions builds those requests itself. Start the product through its
  shared-domain API instead, for example `POST /transform/runs` rather than the
  Transform state machine.
- **Paths:** a secret path may not replace a value that `Parameters` sets.
- **Verify on the deployment:**
  1. Check that the System stack has the `StepSecretArns` parameter;
     prismteam-ai/system#89 adds it. An older System refuses `Secrets` as an
     unknown field.
  2. Run the flow once and confirm that the execution history shows the ARN and
     no value.
  3. Confirm that a template naming an unlisted ARN is refused at save.

## Readable buckets

A run can read objects (`Batch` `ItemsFile`, `ReadObject`) only in System's
own batch bucket and the buckets the install lists in `ReadableBuckets`
(Marketplace install parameter; a live deploy's `readableBuckets` in
`cdk/config.ts`). Any other read is denied by S3 when the run reaches the step.

- **List every bucket the flow reads:**
  - literal `Uri` and `PrefixUri` values;
  - the bucket behind every runtime `Uri.$` and `PrefixUri.$`, such as the
    Transform data bucket a batch reads Transform's output from.

  Put the list in the bundle's install prerequisites. Deploy, through Skarmory,
  updates the System stack's `ReadableBuckets` binding before installing the
  flow.
- **Read the save `warnings`:** with prismteam-ai/system#89, `PUT /templates`
  and `PUT /flows` answer `warnings` when a step reads a bucket outside the
  list, or reads a bucket named only at run time while the list is empty. The
  save still succeeds. Treat any warning as a failed install check.
- **Runtime reads are not checked:** a bucket named at run time while the list
  is not empty cannot be checked at save. Name it in the prerequisites anyway,
  and prove it with a run that reaches the read.
