# Runtime Validation Checklist

- [ ] TypeScript-only service and CDK code
- [ ] Four typed runtime operations only
- [ ] Cursor retains final synthesis and draft generation
- [ ] Connect/Persist dependency gate documented and enforced
- [ ] Required-source and freshness blocking rules tested
- [ ] Powertools Logger, Tracer, and Metrics initialized in each Lambda
- [ ] Active X-Ray tracing enabled
- [ ] 90-day log retention set explicitly
- [ ] Metrics registered in Lexicon and wired to the Main Dashboard
- [ ] CI covers formatting, linting, type-checking, and tests
- [ ] Operator setup docs explain AWS access, linking, relink, cleanup, and not-ready states
