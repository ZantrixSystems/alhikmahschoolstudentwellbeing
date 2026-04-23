# Structured Filtering Grammar

## Goal

Provide a consistent, URL-driven filtering syntax across list screens and backend APIs without exposing SQL injection risk.

## Style

The grammar is inspired by RSQL/FIQL.

- `;` means AND
- `,` means OR
- Parentheses group expressions

## Supported Operators

- `==` equals
- `!=` not equals
- `>=` greater than or equal
- `<=` less than or equal
- `>` greater than
- `<` less than
- `=in=` membership list
- `=out=` exclusion list
- `=isnull=` true or false

## Value Types

- strings
- booleans: `true`, `false`
- dates and timestamps in ISO-like format
- null checks through `=isnull=`

## Examples

- `status==open`
- `radarTeam==safeguarding;priority==high`
- `yearGroup==Y8,(radarTeam==sendco,radarTeam==pastoral)`
- `createdAt>=2026-01-01`
- `assignedTo=in=(me,user123)`
- `hasOpenConcern==true`

## Safety Rules

- Only allowlisted fields may be filtered
- Only allowlisted operators may be used
- Parsed expressions compile to parameterised SQL fragments
- No raw SQL assembly from user input

## UX Pattern

- URL query param `filter`
- active filter chips
- saved filters by area
- backend echoes parsed filter summary for diagnostics
