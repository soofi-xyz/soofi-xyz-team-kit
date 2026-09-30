# System compatibility entrypoint

The historical Product service is now represented by **System** in the current
product catalog. Use [the System contract](../../build-system-product/reference/PRD.md)
and Zygarde for the reusable framework, Celebi for outcome configuration.

Do not implement the old full Product service by default. The current scope is
TypeScript/CDK under `/system`: definitions, schemas, flow templates, template-backed
flows, waterfalls and invocations. Reports, SMS/email, blobs, widgets, short links,
partner ordering and marketplace packaging are excluded from this version.

[Historical requirements](legacy/PRD.md) are preserved only for an explicitly
requested migration or historical comparison. They are not current requirements.
