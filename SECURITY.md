# Security policy

## Reporting a vulnerability

Email **security@flashygroup.com** with a description, reproduction steps,
and the version or commit affected. Do not open a public issue for anything
you believe is exploitable — the issue tracker is for bugs whose disclosure
harms nobody.

You will get an acknowledgement within 72 hours and a status update at
least every 7 days until resolution. We ask for coordinated disclosure:
give us 90 days (or agree on a different window with us) before publishing.

## Scope

This repository contains the **open ledger rules** — the pure domain, the
storage ports, and the adapters. The FlashyOS network services that run
these rules against live books are a separate, private system; findings
about api.flashyos.com or any flashy property belong at the same address
but are handled by the platform team.

## What counts

Anything that lets a consumer of this package be deceived about a balance,
break append-only-ness, forge or collide an entry hash chain, bypass
idempotency, or execute code they didn't intend (including through the
build or publish pipeline). Denial-of-service against your own process by
feeding the library absurd inputs generally does not count — but tell us
anyway if it surprises you.

## Supported versions

The latest published minor. Older versions get fixes only when the finding
is severe and the upgrade path is breaking.
