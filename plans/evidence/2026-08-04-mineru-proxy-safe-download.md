# MinerU proxy-safe ZIP download evidence

Date: 2026-08-04

## User-visible behavior

- The user's system proxy remains enabled for Codex, LLM providers, search, and all ordinary HTTP traffic.
- MinerU first downloads its official result ZIP through the normal application route.
- After two short normal-route failures, only the official MinerU CDN ZIP request switches to a native direct route.
- The direct route resolves current public CDN addresses, keeps the official hostname for TLS certificate verification, rejects private/fake addresses, caps the response size, and checks the ZIP signature.
- If both routes fail, PDF ingest pauses. It does not use built-in PDF extraction, render pages, or call the vision model.
- HTTP 401, 403, 404, or 410 refreshes the completed MinerU task's ZIP address once without re-uploading the PDF.

## Reproduced network cause

- Windows system proxy remained enabled at `127.0.0.1:7897`.
- System DNS returned `198.18.0.114` for `cdn-mineru.openxlab.org.cn`; this is a proxy fake-IP range, not a public CDN address.
- Both the normal request and an explicit `127.0.0.1:7897` proxy request failed before HTTP with curl exit 35 / TLS handshake failure.
- AliDNS returned public CDN addresses including `183.240.235.18`, `120.233.206.21`, and `120.233.206.130`.
- Hostname-preserving direct requests to all three addresses returned HTTP 206, `application/zip`, and the requested 1,024 bytes.

## Program-level verification

- The Rust native downloader was called against the complete existing MinerU ZIP while the system proxy remained enabled before and after the test.
- The live test downloaded and validated the ZIP successfully in 2.32 seconds.
- Four native safety tests passed: official-host restriction, fake/private-IP rejection, public DNS filtering, and ZIP-signature validation.
- TypeScript type checking passed.
- The complete mock suite passed: 127 files and 1,800 tests.
- Frontend tests cover normal-route failure followed by direct success, both routes failing, HTTP 4xx not being bypassed, and expired-address refresh without a second PDF upload.

## Security boundary

- The native command accepts only HTTPS `.zip` URLs whose host is exactly `cdn-mineru.openxlab.org.cn`.
- It does not disable certificate validation and does not change Windows proxy settings.
- Public DNS responses in private, loopback, link-local, documentation, carrier-grade NAT, multicast, or `198.18.0.0/15` benchmark/fake-IP ranges are rejected.

## Rollback

- Revert the Git commit associated with this evidence file.
- Restore the standalone executable backup created immediately before deployment from `D:/llmwiki-deps/app/` if an executable rollback is needed.
