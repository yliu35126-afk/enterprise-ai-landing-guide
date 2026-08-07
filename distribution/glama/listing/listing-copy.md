# Glama 上架文案

## Name

Enterprise AI Landing Guide

## Description

Generate a fact-bounded enterprise AI landing map from one business problem or a lightweight opportunity scan. The server returns one prioritized scenario, an explicit AI-and-human workflow, and a 7-day validation plan. It separates confirmed facts, evidence, inferences, and unknowns, and only writes to Blueprint FDE after explicit storage consent and a human-review request.

## Runtime

- Node.js 22
- MCP Streamable HTTP and optional stdio development transport
- 7 allow-listed tools
- No database query, arbitrary filesystem, or FDE admin tools
- Anonymous short-lived user sessions with separate contact consent

## Current publication status

`adapted / local tests passed`; not deployed to Glama. The repository connection, encrypted upstream secret, hosted handshake, platform test, visibility switch, and FDE attribution test remain pending.

