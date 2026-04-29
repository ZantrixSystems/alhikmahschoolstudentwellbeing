# 2026-04-29 Path-Based Browser Routing

## Context

The SPA previously kept page state in browser session storage, so navigating into a
student profile or settings area did not create a meaningful URL. Staff could not reliably
bookmark or share a specific app screen, and refreshing a deep screen depended on transient
client-side state.

## Changes

- Replaced session-storage route restoration with path/query parsing from the browser URL.
- Added canonical routes for dashboard, student directory, student profiles, meetings, and
  settings tabs.
- Changed route updates to use the History API so navigation updates the address bar and
  works with browser back/forward controls.
- Kept student and meeting list search/filter state in query parameters.
- Updated the Worker to serve the SPA shell for non-API browser deep links while keeping
  `/api/*` and `/health` separate.
- Added Worker tests for deep-link SPA fallback and non-SPA exclusions.

## Notes

Student profile URLs currently use the internal student ID already used by the frontend and
API. A future student-code URL layer would need an explicit Worker lookup and collision rules
before exposing profile routes as `/students/:studentCode`.
