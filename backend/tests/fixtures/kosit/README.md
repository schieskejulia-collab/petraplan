# Report-contract regression fixtures

The eight compressed KoSIT reports are byte-identical copies of the archived
17 November first run at commit `9e19da0101f16f6065e44b1a45a0390c9a7eaf92`.
`manifest.json` retains their uncompressed SHA-256 and source archive. Neither
the first-run expectations nor its results are changed by this correction.

`scenarios.xml.gz` is the unchanged scenario configuration from the official
KoSIT `validator-configuration-xrechnung` release `v2026-08-31` (XRechnung
3.0.2). The release is published under Apache-2.0. Source:
https://github.com/itplr-kosit/validator-configuration-xrechnung/releases/tag/v2026-08-31

These fixtures exercise report parsing and negative mutations without Java or
network access. They do not stand in for a fresh validator run, complete XML
business validation, deployment, or human release authority.
