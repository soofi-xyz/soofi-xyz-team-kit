# API description contract

Every Prism product that serves an API publishes one OpenAPI description, and Prism
Documentation shows it to readers. Build, Marketplace and Documentation check the same file
with the same rules.

## The file

- `requirements/swagger.yml` at the repository root of a SERVICE product whose root
  `marketplace.product.json` sets `base_path`. Configuration bundles and products without
  `base_path` have none.
- OpenAPI 3.0.x or 3.1.x, at most 1 MiB, with `info.title`, `info.version`, at least one path,
  and a server URL ending in `/<base_path>` (for example `https://{domain}/deploy`). Paths are
  relative to that server: on the shared domain `/deploy/run` is documented as `/run`.
- YAML anchors and aliases are refused. Generated YAML must be written without them.
- Documentation also requires valid OpenAPI with every internal `$ref` resolving.

A product that is not on the shared domain (Environment, which creates the shared domains)
still needs a server ending in `/<base_path>`: list its real address first and add
`https://{domain}/<base_path>` second, described as not served and present only for the check.

## Where it is enforced

| Stage | What happens | Policy |
| --- | --- | --- |
| Shared publish action (`prismteam-ai/build/actions/publish`) | Checks the archived spec before anything is built, with Build's own rules; shows an `API spec` row in the run summary | always fails on problems |
| Build service | Validates, packs the file at the same path in the artifact and records `api_spec` (`path`, `sha256`, `openapi_version`, `title`, `version`) in `build/build.manifest.json` | `API_SPEC_POLICY` on the CodeBuild project, `enforce` by default |
| Marketplace review | Checks the packed file and Build's record right after Comply, before the sandbox install, and records `review_details.api_spec_logs`; under `enforce` the store step checks again for `skip_review` publishes | `API_SPEC_POLICY` on the review function, `enforce` by default |
| Documentation | Marketplace sends the packed spec of each VALID SERVICE bundle to `POST /publications` and records `review_details.documentation_logs`; publication never fails the release | Documentation's own validation (`422 REJECTED`) |

`warn` is a temporary escape hatch for one environment while a product adds its file; the
publish action has no `warn` mode.

## Keeping the file true

A spec that drifts from the code is worse than none. Give every product a test that fails
when the documented routes differ from the routes the API serves (synthesized API Gateway
methods, the router's registered routes, or an exported route list), and when the server URL or
security requirement changes. Prefer generating the file from the request schemas the handlers
validate with (zod, Effect Schema), so request bodies cannot drift; then test that the committed
file equals the generator's output.

Request schemas should refuse what the parsers refuse. Check a few valid and invalid payloads
against both the schema and the real parser; they must agree. Cross-field rules JSON Schema
cannot express belong in the request description.
