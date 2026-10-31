---
trigger: glob
globs: "client/**, public/**, src/components/**, src/pages/**, *.tsx, *.css, *.html"
description: "DecoHUB Frontend Anti-Slop & UI Quality Standards (Design Tokens, Zero Emojis, REA)"
---

# Frontend Anti-Slop & UI Quality Standards

<frontend_antislop_invariants>
1. Zero Emojis Mandate:
   - Strictly prohibit unicode emojis in UI copy, buttons, badges, headers, or alerts.
   - Use standardized inline SVGs (e.g. Lucide icons) with uniform sizing (`h-4 w-4` or `h-5 w-5`).

2. Zero Native Dialogs:
   - Never call `window.alert()`, `window.confirm()`, or `window.prompt()`.
   - Implement accessible UI dialogs and toast notifications with focus trapping and Escape key dismissal.

3. Semantic Design Tokens (`:root`):
   - Define and consume CSS custom properties for all colors, borders, and shadows:
     `--bg-app`, `--bg-surface`, `--border-subtle`, `--text-primary`, `--text-muted`, `--accent-primary`.
   - Never hardcode arbitrary hex colors directly inside component style attributes.

4. Tabular Numbers & Typography:
   - Apply `font-variant-numeric: tabular-nums` (or Tailwind `tabular-nums`) to all financial values, timestamps, timers, IDs, and data table columns.

5. Accessible Tab Navigation:
   - Tab containers must implement semantic roles: `role="tablist"`, `role="tab"`, `data-tab="..."`, `aria-selected="true|false"`.
   - Tab panels must implement `role="tabpanel"` with appropriate `aria-labelledby`.

6. REA Archetype Consistency:
   - Attio Archetype: Input fields and action buttons standardized at `h-9` (36px height) with subtle 1px border.
   - n8n Archetype: Visual execution status badges (`Active`, `Draft`, `Running`, `Failed`) with subtle pulsing status dot.
   - Tally Archetype: Distraction-free PIX payment flow featuring one-click copy-paste input and countdown timer.

7. Dual Viewport Responsiveness & State Persistence:
   - Pixel-perfect layout verified at Desktop (`1440x900`) and Mobile (`390x844`).
   - Zero horizontal scrollbar or overflow (`overflow-x: hidden`).
   - Active tabs, filters, and display modes must persist across page reloads (F5) via `localStorage`.
</frontend_antislop_invariants>