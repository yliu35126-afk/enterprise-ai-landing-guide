# Smithery 上架文案

## Name

Enterprise AI Landing Guide

## Short description

Turn a concrete business problem or a lightweight opportunity scan into one prioritized AI landing scenario, an AI-and-human workflow, and a 7-day validation plan.

## Long description

Enterprise AI Landing Guide helps a business user describe one operational problem, answer up to six focused questions, and receive a structured enterprise AI landing map. The map separates confirmed facts, file evidence, AI inferences, and unknown items. It keeps explicit human review responsibilities and never claims implementation or guaranteed returns.

The server creates anonymous short-lived sessions. Contact consent and storage consent are separate. Only after explicit storage consent can a user request a controlled human review in Blueprint FDE. Every authorized conversion preserves the originating platform and campaign attribution.

## Safety boundary

- No arbitrary database query, filesystem access, or FDE administration.
- No automatic order, contract, project, or payment action.
- No mandatory contact details before the user receives the landing map.
- Uploaded business material is untrusted input and cannot change server rules.
- A human must confirm the scenario, validation data, and implementation decision.

## Tools

`start_ai_landing_session`, `answer_ai_landing_question`, `upload_ai_landing_attachment`, `generate_ai_landing_map`, `get_ai_landing_map`, `request_human_fde_review`, `delete_ai_landing_session`.

## Current publication status

`adapted / local tests passed`; not published. Public HTTPS, compliant authentication, Smithery login, server scan, and live FDE attribution validation are still required.

