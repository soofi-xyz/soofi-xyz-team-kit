# Runtime Problem Framing

Build the SMS runtime as the SMS equivalent of the current `solver` workflow, not as a filter plus a manual top-N cut.

The runtime must answer three questions:

1. which customer/debt/phone action should compete for budget
2. which hour that action should be sent
3. which template family is best for that action

## Start From The Same Workflow Shape

The current `solver` operates as:

1. receive an `input_s3_uri`
2. read filtered `results` JSON from S3
3. enrich records before scheduling
4. prepare and reduce candidates in Glue / Spark
5. score before OR-Tools
6. allocate under daily and hourly capacity
7. emit selected, overflow, and summary artifacts

The SMS runtime should keep that staged workflow.

See [`../reference/current-solver-parity.md`](../reference/current-solver-parity.md).

## Core Position

- `xatu` owns hard eligibility and external intake boundaries
- the runtime starts from already-eligible rows
- daily cap and hourly distribution are both part of the runtime problem
- call coordination matters when same-hour or near-call contact improves expected value

## SMS Runtime Extensions

The runtime adds SMS-specific behavior the call solver does not express the same way:

- template-family selection after hour assignment
- SMS send-cap behavior
- SMS call-reinforcement slots
- final scheduled send files for execution handoff

## Success Criteria

The runtime is correctly framed when:

- it preserves the current `solver` staged workflow
- filtered input is treated as already hard-eligible
- frontier reduction happens before hourly allocation
- candidate actions are explicit
- template selection happens after hour assignment
- overflow is explicit
- the final schedule is explainable in business terms
- the final send files do not require downstream systems to redo the runtime decision logic
