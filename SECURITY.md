# Security policy

## Reporting a vulnerability

Use the private GitHub Security Advisory form at [Report a vulnerability](https://github.com/draarivpatel-ui/dermavto/security/advisories/new). Do not open a public issue, pull request or discussion with exploit details.

Never include a live secret, API key, token, cookie, private key, victim hostname or proprietary payload in a report. Use synthetic values and redacted transcripts.

## Supported versions

| Version | Status |
| --- | --- |
| 1.x | Supported |

Security fixes are applied to the latest state of the default branch.

## Scope

This policy covers the colorimetric analysis engine, the fairness audit workbench, export and bookmark encoding, and the optional YouCam live client.

In scope:

- Cross-site scripting or DOM injection through rendered analysis, receipt, audit or workbench output.
- Formula injection or control-character smuggling through JSON, CSV or Markdown exports.
- Prototype pollution, runtime hijack keys or hostile input accepted by the engine, the share bookmark codec or the YouCam request builder.
- A network call outside `youcam-live.js`, or any path that stores, logs or transmits an API key beyond the live run the user started.

Out of scope:

- Optical approximation accuracy of colour indices, shade ranking or the screening literacy score. These are educational approximations, not medical judgements.
- Vulnerabilities in the YouCam API itself, or in downstream use of a key the user pasted voluntarily.
- Denial of service through intentionally extreme input that only affects the local browser tab.

## Coordinated disclosure

- Acknowledgment: within 3 business days.
- Initial assessment: within 14 calendar days.
- Fix or mitigation plan: within 90 calendar days for confirmed reports.
- Coordinated public disclosure: up to 90 days by default, adjusted by mutual agreement when exploitation or user risk requires a different date.

We support good-faith security research. If you follow this policy, we will not pursue legal action against you and we will credit your report if you would like.
