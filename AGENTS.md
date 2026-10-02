# Architecture rules

- Scope the CRM visual system through the `crm-ui-active` body marker so Radix portals inherit CRM styling without changing `/admin`.
- Keep tenant branding derived from `--primary-h` and `--primary-s`; semantic status colors remain independent from tenant branding.
- Keep action controls derived from the tenant's separate action color; sidebar identity and charts remain derived from the tenant primary color.