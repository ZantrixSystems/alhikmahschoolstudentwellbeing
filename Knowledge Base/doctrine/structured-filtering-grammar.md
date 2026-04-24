# Structured Filtering Grammar

## Goal

Provide URL-driven filtering across list screens and backend APIs without exposing SQL injection risk.

## UX Layers

- Friendly filter builder is the default for common staff workflows.
- Advanced structured input is hidden until the user switches to Advanced mode.
- Active filter chips remain visible in both modes.

The friendly builder writes the same structured filter string used by the backend.

## Style

The grammar is inspired by RSQL/FIQL.

- `;` means AND
- `,` means OR
- Parentheses group expressions

## Supported Operators

- `==` equals
- `!=` not equals
- `~=` contains text
- `>=` greater than or equal
- `<=` less than or equal
- `>` greater than
- `<` less than
- `=in=` membership list
- `=out=` exclusion list
- `=isnull=` true or false

## Student Filter Fields

- `name`
- `yearGroup`
- `year`
- `class`
- `status`
- `radar`
- `radarTeam`
- `lead`
- `latestActivity`
- `openFollowUp`
- `hasOpenConcern`

## Examples

- `radar==safeguarding`
- `status==open`
- `name~=ahmed`
- `yearGroup==Y8`
- `latestActivity>=2026-01-01`
- `radar=in=(safeguarding,pastoral)`

## Safety Rules

- Only allowlisted fields may be filtered.
- Only allowlisted operators may be used.
- Parsed expressions compile to parameterised SQL fragments.
- User input never becomes raw SQL identifiers or clauses.
