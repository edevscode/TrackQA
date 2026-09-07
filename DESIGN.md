---
name: TrackQA Design System
description: Precision Lab & Technical Workbench for QA verification and issue management
colors:
  primary: '#1e1b4b'
  primary-hover: '#312e81'
  primary-container: '#312e81'
  on-primary: '#ffffff'
  on-primary-container: '#c7d2fe'
  accent: '#4338ca'
  accent-muted: '#e0e7ff'
  surface: '#f8fafc'
  surface-dim: '#f1f5f9'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8fafc'
  surface-container: '#f1f5f9'
  surface-container-high: '#e2e8f0'
  surface-container-highest: '#cbd5e1'
  on-surface: '#0f172a'
  on-surface-variant: '#475569'
  inverse-surface: '#0f172a'
  inverse-on-surface: '#f8fafc'
  outline: '#94a3b8'
  outline-variant: '#e2e8f0'
  border-subtle: '#e2e8f0'
  border-strong: '#cbd5e1'
  error: '#dc2626'
  on-error: '#ffffff'
  error-container: '#fee2e2'
  on-error-container: '#991b1b'
  status-open: '#475569'
  status-open-bg: '#f1f5f9'
  status-progress: '#0284c7'
  status-progress-bg: '#e0f2fe'
  status-testing: '#6366f1'
  status-testing-bg: '#eef2ff'
  status-passed: '#059669'
  status-passed-bg: '#ecfdf5'
  status-failed: '#dc2626'
  status-failed-bg: '#fef2f2'
  status-done: '#334155'
  status-done-bg: '#f8fafc'
typography:
  headline-xl:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter, system-ui, sans-serif
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  code-sm:
    fontFamily: JetBrains Mono, monospace
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
  code-xs:
    fontFamily: JetBrains Mono, monospace
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 4px
  DEFAULT: 6px
  md: 8px
  lg: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  container-max: 1280px
  gutter: 16px
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    rounded: '{rounded.DEFAULT}'
    padding: '8px 16px'
  button-secondary:
    backgroundColor: '{colors.surface-container-lowest}'
    textColor: '{colors.on-surface}'
    rounded: '{rounded.DEFAULT}'
    padding: '8px 16px'
---

# Design System: TrackQA

## Overview

**Creative North Star: "Precision Lab & Technical Workbench"**

TrackQA is built for software quality assurance engineers, technical developers, and engineering leads who require absolute clarity, data density, and verifiable reproducibility. It discards the soft, generic aesthetic of AI-generated SaaS templates in favor of a crisp, utilitarian instrument designed for intense daily operation.

The interface prioritizes scan speed, high-contrast readability, and low visual fatigue during prolonged testing sessions. Rather than relying on fuzzy drop shadows, glowing purple halos, or endless nested cards, depth is communicated through disciplined 1px structural borders, clean surface planes, and purposeful monospace anchors for ticket identification.

**Key Characteristics:**
- **Crisp Structural Boundaries:** Sharp 1px neutral borders delineate sections cleanly without blurry, diffuse drop shadows.
- **Purposeful Monospace Anchors:** Ticket keys (`TQA-101`), environment versions, access codes, and timestamps use **JetBrains Mono** to create unmistakable visual brackets for technical data.
- **High Data Density Without Clutter:** Backlogs, issue cards, and detail panels favor compact tabular scanning and tight horizontal rhythm over cavernous whitespace.
- **Unambiguous Status Architecture:** Status indicators and QA verification outcomes (Passed / Failed) feature authoritative contrast and recognizable iconography, replacing generic pastel chip soup.

---

## Colors

The palette is anchored in authoritative deep slate and precision indigo (`#1E1B4B`), paired with pure functional neutrals and sharp semantic accents.

- **Canvas & Surfaces:** Crisp neutral field (`#F8FAFC`) with pure white work surfaces (`#FFFFFF`) and slate-50 interactive hovers (`#F1F5F9`).
- **Typography & High Contrast:** Primary text is set in high-contrast slate-900 (`#0F172A`), secondary metadata in slate-600 (`#475569`), and disabled/placeholder elements in slate-400 (`#94A3B8`). Never wash out functional text with pale grays on colored backgrounds.
- **Borders & Dividers:** Defined 1px borders in slate-200 (`#E2E8F0`) provide crisp structural containment. Active, selected, or focused borders step up to slate-400 or brand indigo (`#4338CA`).
- **Semantic Verification Signals:**
  - **OPEN:** Neutral slate badge (`#475569` text on `#F1F5F9` background, 1px border `#E2E8F0`).
  - **IN PROGRESS:** Focused sky/blue (`#0284C7` text on `#E0F2FE` background).
  - **FOR TESTING:** Workbench violet (`#6366F1` text on `#EEF2FF` background).
  - **PASSED:** Authoritative emerald (`#059669` text on `#ECFDF5` background).
  - **FAILED:** High-visibility alert crimson (`#DC2626` text on `#FEF2F2` background).
  - **DONE:** Quiet grounded slate (`#334155` text on `#F8FAFC` background).

---

## Typography

TrackQA pairs **Inter** for clean UI legibility with **JetBrains Mono** for technical data and identifiers.

- **Scale Ratio:** Fixed, high-contrast scale from `12px` (label/mono) up to `32px` (display hero).
- **Prohibited Sizes:** No functional text under `12px`. Off-ramp sizes like `10px`, `11px`, or arbitrary `28px` must be replaced with the standard scale tokens (`label-md: 12px`, `code-xs: 12px`, `headline-lg: 24px`, `headline-xl: 32px`).
- **Monospace Application:** Ticket IDs (`TQA-42`), hash commits, build numbers, device OS versions, and kbd shortcuts are set strictly in `JetBrains Mono` (`code-sm: 13px` / `code-xs: 12px`).
- **Headings & Body:** Headings use semi-bold (`font-weight: 600`) or bold (`700`) with tight tracking (`-0.01em` to `-0.02em`). Body copy maintains `14px` (`body-md`) and `16px` (`body-lg`) at `1.5` line height for effortless scanning.

---

## Layout

The application employs a disciplined **Fixed Workbench Grid** with an anchored left rail (280px desktop) and fluid data-dense main canvas.

- **Baseline Spacing:** Built on a 4px baseline grid (`xs: 4px`, `sm: 8px`, `md: 16px`, `lg: 24px`, `xl: 32px`).
- **Tabular Priority:** Lists and backlogs default to dense table layouts with sticky headers, explicit column widths, and hover highlights.
- **Gutter & Margins:** Desktop canvas gutters are `24px` (`px-lg py-lg`); tablet and mobile gutter steps down to `16px` (`px-md`).
- **Responsive Stacking:** On mobile (`< 768px`), tabular backlogs collapse into scannable stacked cards without losing ticket ID hierarchy or verification status.

---

## Elevation & Depth

TrackQA is a **Flat-Plus Workbench**: depth is communicated through tonal contrast and crisp 1px structural outlines rather than heavy drop shadows.

- **No Diffuse Shadows Paired with Hairlines:** Eliminates the classic AI tell of a thin border accompanied by a 10px blurred drop shadow. Surfaces are either cleanly bounded by `1px solid #E2E8F0` or tonally elevated.
- **Interactive States:** Lift and interactivity are indicated by subtle surface shifts (`hover:bg-slate-50`) or crisp focus rings (`focus:ring-2 focus:ring-indigo-600/20`), never dramatic card scale transforms.
- **Modals & Overlays:** Floating dialogs and popovers use a single ambient elevation (`box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.08), 0 4px 6px -4px rgba(15, 23, 42, 0.04)`) with a crisp `1px` outer border.

---

## Shapes

- **Controls & Buttons:** Rounded with a disciplined `6px` radius (`rounded-md`).
- **Containers & Panels:** Bounded with an `8px` or `12px` radius (`rounded-lg`).
- **Status Badges & Chips:** Compact pill shape (`rounded-full`) with `12px` typography, used strictly for status tags, roles, and count indicators to clearly distinguish them from actionable buttons.
- **Extreme Roundings Banned:** No 20px+ rounded corners on cards, containers, or input fields.

---

## Components

### Buttons
- **Primary:** Solid deep indigo (`#1E1B4B`), white text, `6px` radius, hover state (`#312E81`). No gradient backgrounds or glowing drop shadows.
- **Secondary / Ghost:** White surface, `1px solid #E2E8F0`, slate-700 text, hover state (`#F1F5F9`).
- **Danger / Fail:** Crimson text or background (`#DC2626`) for destructive or failing QA sign-off actions.

### Ticket & Issue Rows
- **Layout:** High-density row with monospace ticket key (`font-mono text-code-sm font-semibold`), clear title, status badge, priority icon, and assignee avatar.
- **Hover:** Clean transition to `#F8FAFC` row background with immediate cursor pointer affordance.

### Verification Verdicts
- **QA Sign-Off Cards:** Prominent two-state action (Pass / Fail) with mandatory failure justification, repro environment specs, and attachment dropzones.

### Form Inputs
- **Base:** White background, `1px solid #CBD5E1`, `6px` radius, `14px` body text.
- **Focus:** Crisp `2px` ring in `#4338CA` with zero layout shift.

---

## Do's and Don'ts

### Do's
- **DO** use `JetBrains Mono` for all ticket numbers, access codes, and environment specifications.
- **DO** keep data rows and tables dense and easily scannable with keyboard navigation support.
- **DO** ensure all text complies with WCAG AA 4.5:1 contrast requirements.
- **DO** use exact scale tokens (`label-md: 12px`, `code-sm: 13px`, `body-md: 14px`).
- **DO** structure repro steps and QA verification results as first-class, verifiable fields.

### Don'ts (AI Slop Anti-Patterns to Eliminate)
- **DON'T** stack floating icon containers directly above section headers (e.g. the icon-in-a-box above `Create New Project`).
- **DON'T** use purple-to-blue gradient fills, glow effects, or background radial halos.
- **DON'T** combine hairline borders with wide, blurry drop shadows on cards.
- **DON'T** nest cards inside cards inside cards (Cardocalypse). Flatten containers with whitespace and 1px dividers.
- **DON'T** use 4 identical formulaic metric cards with an icon top-right and oversized number below.
- **DON'T** use off-ramp font sizes (`10px`, `11px`, `28px`).
- **DON'T** write generic SaaS marketing filler ("frictionless", "supercharge", "empower"). Be direct and technical.