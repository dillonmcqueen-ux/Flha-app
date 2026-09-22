# Supervisor Dashboard: target design

This is the approved look for the real supervisor dashboard (`src/Dashboard.jsx`).
It was designed in Google Stitch (project "FORA Field Solutions", screen
"Forafield Supervisor Dashboard") and exported on 2026-09-22.

| File | What it is |
|---|---|
| `screenshot.png` | Full render of the mockup at 2560x2048. |
| `dashboard.html` | Stitch's exported HTML (Tailwind via CDN). A visual reference only, not production code. |
| `DESIGN.md` | The "Kinetic Precision" design system the mockup uses: color tokens, type scale, spacing, component rules. |

## Key traits

- Dark theme: near-black canvas, `#0F0F0F` cards, 1px `#282828` borders, `#FF6B00` orange accent.
- Space Grotesk for headings, labels and numbers; Inter for body copy; a monospace face for metadata.
- Left sidebar grouped into Safety, Operations and Workforce.
- Certification alert banner above a row of five KPI cards (sign-off status, compliance, open corrective actions, docs this week, fuel alerts).
- Site Activity (submissions by site with progress bars) next to a Recent Activity feed.

## Notes for implementation

- The numbers, names and sites in the mockup are sample data. Wire every card to the real data the current dashboard already loads.
- Stitch pulls Tailwind from a CDN. The app does not use Tailwind, so translate the styles into the app's own styling (`src/theme.js` if it exists) rather than copying the markup.
