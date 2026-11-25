# Source cookbooks

One recipe per **vendor platform**, not per county: a recipe serves every county on that
platform. Read the matching recipe before probing a source, and update it when a run teaches
something new (dated, with the county and the measurement).

| Vendor | Recognize it by | Recipe |
|---|---|---|
| Schneider Geospatial qPublic | `qpublic.schneidercorp.com/Application.aspx?AppID=…` | [`qpublic.md`](./qpublic.md) |

Each recipe states: URL patterns and how to find the county's IDs, identifier format,
access (egress, challenge, session rule), readiness condition, record inventory, measured
throughput, CLI support, and known pitfalls. General rules live in
[`../source-access.md`](../source-access.md).

Add a recipe when a second county on the same vendor is likely (Accela Citizen Access,
Cloudpermit, iWorQ, OpenGov, SagesGov, Tyler EnerGov are the next candidates).
