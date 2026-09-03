---
name: TrackQA Design System
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#464553'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#777584'
  outline-variant: '#c8c4d5'
  surface-tint: '#544fc0'
  primary: '#1f108e'
  on-primary: '#ffffff'
  primary-container: '#3730a3'
  on-primary-container: '#a9a7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#4648d4'
  on-secondary: '#ffffff'
  secondary-container: '#6063ee'
  on-secondary-container: '#fffbff'
  tertiary: '#440077'
  on-tertiary: '#ffffff'
  tertiary-container: '#6300aa'
  on-tertiary-container: '#cd99ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3b35a7'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#f0dbff'
  tertiary-fixed-dim: '#ddb7ff'
  on-tertiary-fixed: '#2c0051'
  on-tertiary-fixed-variant: '#6900b3'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-xl:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  code-sm:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 48px
  container-max: 1280px
  gutter: 16px
---

## Brand & Style
The design system is built for a focused QA and issue management environment. The brand personality is efficient, reliable, and precise, prioritizing clarity over decoration. It adopts a **Corporate / Modern** aesthetic with a heavy leaning toward **Minimalism**. 

The UI should evoke a sense of calm under pressure through generous whitespace, high-contrast typography, and a "flat-plus" execution—where depth is used sparingly to indicate interactivity. The goal is to remove the cognitive load found in legacy project management tools, offering a "simpler than Jira" experience that feels as fast as a text editor but as robust as a database.

## Colors
The palette is rooted in a professional **Deep Indigo** primary, chosen for its association with stability and technical authority. 

- **Primary & Actions:** Use the primary indigo for main actions and brand moments.
- **Surfaces:** Utilize a tiered gray system (Surface-Neutral). Backgrounds should remain `#FFFFFF` or `#F8FAFC` to ensure the content remains the focal point.
- **Semantic Statuses:** These are functionally critical for QA workflows. Use semi-transparent background tints (10-15% opacity) with high-contrast text for badges to ensure readability without visual clutter.
- **Priorities:** Defined by a warm-to-cold spectrum to allow users to scan backlogs instantly.

## Typography
This design system utilizes **Inter** as the primary typeface due to its exceptional legibility in data-heavy SaaS interfaces. 

- **Readability:** Body text uses a slightly increased line height (1.5x) to ensure long bug descriptions remain scannable.
- **Technical Context:** **JetBrains Mono** is introduced for ticket IDs (e.g., TQA-101) and code snippets, providing a distinct visual "bracket" for technical data.
- **Visual Hierarchy:** Use `FontWeight: 600` for interactive elements and `700` for page titles. Labels should use `12px` uppercase styling for secondary metadata to distinguish from primary body content.

## Layout & Spacing
The layout relies on a **Fluid Grid** for the main content area with a fixed sidebar for navigation. 

- **Grid:** Use a 12-column grid system for complex dashboard layouts. On desktop, side margins are `24px`.
- **Rhythm:** Spacing follows a 4px baseline. Components should generally use `md (16px)` padding internally, while section spacing should use `xl (48px)`.
- **Responsive:** On tablet, gutters reduce to `16px`. On mobile, all cards become full-width with `16px` horizontal margins and vertical stacking.

## Elevation & Depth
This design system utilizes **Low-Contrast Outlines** combined with **Ambient Shadows**. 

- **Flat Surfaces:** Most containers (sidebars, secondary panels) are flat with a `1px` border in `#E2E8F0`.
- **Raised Elements:** Use a single level of elevation for interactive cards and modals. Shadows should be highly diffused: `box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)`.
- **Active State:** When an item is dragged or focused, use a subtle `2px` indigo ring rather than increasing shadow depth to maintain the minimalist aesthetic.

## Shapes
The shape language is friendly but professional. 

- **Standard Elements:** Buttons, inputs, and cards use the `rounded-md (0.5rem)` setting.
- **Status Badges:** Use `rounded-full` (pill shape) to differentiate statuses from clickable buttons.
- **Interactive Indicators:** Checkboxes and small icons should use `rounded (0.25rem)` to retain a sharper, more precise look.

## Components
- **Buttons:** Primary buttons use the indigo background with white text and a subtle bottom-heavy shadow. Secondary buttons use a white background with a `1px` gray border.
- **Status Badges:** Use a "Soft Tint" style. For example, the `FAILED` badge uses a light rose background (`#FFF1F2`) with `rose-700` text.
- **Input Fields:** Use a white background, `1px` border in `Slate-200`, and an Indigo `2px` focus ring. Placeholder text should be `Slate-400`.
- **Cards:** White background, `1px` border in `Slate-200`, and `rounded-lg` corners. Card headers should have a subtle bottom border to separate metadata from content.
- **Priority Icons:** Use a consistent geometric shape (e.g., a vertical bar or chevron) colored according to the Priority tokens to provide an immediate visual cue in list views.
- **Lists:** Issue lists should have a hover state that changes the background to `Slate-50` to indicate row-level interactivity.