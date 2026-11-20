# Nourish design system ("Warm Kitchen", 0.1.17)

Nourish should feel like a calm, warm kitchen at night: food first, numbers you can read at a glance,
and nothing that shouts. The design is original. Ideas came from Apple's Human Interface Guidelines
(text styles, 44-point touch targets, layouts that adapt to every size) and from what good food and
nutrition apps have in common: cards as the main unit, big photos, oversized numbers with quiet
labels, and short flows. No other app's images, icons, fonts, text or code are used.

Where it lives:
- `styles.css`: the components, plus the 0.1.17 layer at the end (tokens A–L).
- `theme.js`: every colour, worked out from a background and an accent.
- `index.html`: the icons (drawn for Nourish, inline SVG).

## Colour

Dark is the default (**Ember**). Every theme is built by `theme.js`, which checks text contrast with
the WCAG formula:
- Main text at least 7:1.
- Secondary text at least 4.5:1.

| Token | Ember (dark, default) | Paper (light) | Used for |
|---|---|---|---|
| `--bg` | #0C0B0A | #F5EFE6 | the page |
| `--surface` | #161412 | #FFFCF7 | cards, sheets |
| `--surface-2` | #1F1C19 | #F3ECE1 | rows inside cards, inputs |
| `--surface-3` | #2A2622 | #E7DECF | tracks, pressed states |
| `--text` | #F6EFE6 | #1F1913 | main text |
| `--text-2` | #C4B8AB | #54493E | secondary text |
| `--text-3` | #938879 | #736759 | labels, hints (4.5:1 or better) |
| `--accent` | Saffron #F4A13D | Saffron (deep #C9711B for text) | buttons, today, progress |

Fixed meanings:
- Protein is green, carbs gold and fat coral, everywhere.
- Each meal has its own colours: breakfast is sunrise orange, lunch herb green, dinner dusk violet and snacks rose. A meal without a photo shows these colours with its icon.

Other themes:
- Midnight, Forest, Plum and True black (OLED) are dark.
- Paper and Cloud are light.
- Auto follows the phone.
- There are 6 accents, plus custom colours. "Increase contrast" makes quiet text darker and edges firmer.

## Type

All fonts are bundled (SIL Open Font License, see `FONTS.md`). Nothing is loaded from Google Fonts or
a CDN.

- Default pairing "Editorial": Fraunces (warm serif) for headings, Figtree for text.
- Numbers always use Figtree's even, same-width digits.
- Other pairings: Modern (Inter), Classic (Source Serif 4 + Source Sans 3), Rounded (Nunito), Minimal (Manrope).

| Token | Size | Use |
|---|---|---|
| `--fs-hero` | 2.5rem | screen names (Today, Plan…) |
| `--fs-title-1` | 2.05rem | a recipe's name |
| `--fs-title-2` | 1.5rem | sheet titles, big numbers |
| `--fs-title-3` | 1.2rem | section and card titles |
| `--fs-headline` | 1.06rem | dish names in lists |
| `--fs-body` | 1rem | text (16 px; follows the Text size setting) |
| `--fs-footnote` | 0.87rem | notes |
| `--fs-caption` | 0.78rem | the smallest text anywhere |
| `--fs-label` | 0.72rem | UPPERCASE labels, tracked wide |

## Space, shape, depth, motion

- **Space:** a 4-point scale (`--s-1` 4 px … `--s-10` 40 px). The Spacing setting (Compact / Roomy) rescales it.
- **Corners:** `--r` 16, `--r-lg` 20, `--r-xl` 24 (cards), `--r-2xl` 30 (sheets), `--r-photo` 18. The Corners setting (Soft / Square) rescales them all.
- **Depth:** three themed shadows (`--e-1` rows, `--e-2` cards, `--e-3` floating things). On a computer, a card lifts 2 px on hover.
- **Motion:**
  - Screens and cards rise in, staggered 50 ms.
  - Photos fade in.
  - Sheets slide up on a phone and scale in on a computer.
  - Rings and bars fill smoothly.
  - Buttons and tabs shrink a little when pressed.
  - Everything stops with Reduce motion (the phone's setting or Nourish's own).

## Components

- **Food art.** A recipe's own photo, taken from its web page (schema.org `image`), loaded with no referrer. If a recipe has no photo, or its photo won't load, the tile shows the meal's colours with its icon. Settings → Appearance → Recipe photos turns photos off, and then nothing is downloaded.
- **Meal card.** Food art, the meal label, the dish name in the heading font, and chips for time, calories and portion. A round "eaten" button sits beside it.
- **Up next.** Today's next meal to eat, shown as a big card with its photo across the top.
- **Summary ring.** Calories eaten against the target, with protein, carbs and fat bars.
- **Recipe sheet.**
  - A photo hero that fades into the page (or the meal's colours).
  - The name, chips, and a nutrition panel with one oversized number.
  - Ingredients you can tick off, and numbered steps.
  - "Make it tastier": near-zero-calorie boosts with an Add button.
  - A thumbs up or down for the recipe.
- **Buttons.**
  - Primary: solid accent, 52 px tall.
  - Secondary: quiet surface.
  - Small: pill shaped.
  - Icon buttons are 44 px circles, so every touch target is at least 44 points.
- **Lists.** Inset, grouped cards with hairline dividers (Settings, Grocery, Plan days).
- **Inputs.** 52 px tall and never below 16 px text, because iOS zooms into smaller text. The accent ring shows on focus.
- **Tab bar.** A floating glass dock on a phone. On a computer (1000 px and wider) it becomes a sidebar with the Nourish name, and Settings sits at the bottom.

## Layout

- **Phone:** one column, 20 px side margins, and safe areas respected.
- **Computer (1000 px and wider):**
  - The sidebar, and pages up to 1120 px wide (1240 px at 1400 px and wider).
  - Today shows the day's numbers beside its meals.
  - Plan shows its days side by side.
  - Grocery shows aisles in two columns.
  - Settings and Chat stay at a readable 760 px.
  - Sheets open as centred cards.
