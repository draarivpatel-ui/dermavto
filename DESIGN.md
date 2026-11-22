# DermaVTO design record

## Concept card

- **Idea.** A dermatology lab bench set in an editorial atelier. The tool is the page, and every number is shown where it is measured.
- **Macrostructure.** Workbench. The product is the first screen, and the sections that follow are the readings, the ranking and the requests behind it.
- **Motion verb.** Settle like paper. Page parts rise six to ten pixels and fade once on load. The divider moves instantly with the hand.
- **Signature moment.** The split divider, with raw skin on one side and either a chromophore map or a try on on the other.
- **Screenshot.** The studio at 1360 pixels wide with the divider near the middle.

## Audience, use and tone

Audience is hackathon judges and shoppers who want to match a shade. The one job is to read a skin tone and try a shade against it. Tone is editorial atelier, quiet and exact.

## Tokens

All values live in `tokens.css`. `styles.css` holds no colour literals and no font names.

| Token | Value | Role |
| :--- | :--- | :--- |
| `--color-paper` | `#FAF7F2` | page ground |
| `--color-surface` | `#F1ECE3` | cards and panels |
| `--color-ink` | `#181514` | text, rules, primary buttons |
| `--color-accent` | `#B84A39` | the sample, erythema, hover |
| `--color-sage` | `#2A6F62` | focus ring, melanin overlay, Top 3 proof |
| `--color-muted` | `#675F5A` | secondary text, 5.9 to 1 on paper and 5.3 to 1 on surface |

Contrast was computed from the tokens. Ink on paper is 17.0 to 1, accent on paper 4.8, sage on paper 5.5, and the error red on paper 7.1. Focus uses sage with a 3 pixel offset and is never animated.

## Type

- Display, Cormorant Garamond 600, always roman, never italic.
- Body, Plus Jakarta Sans 400 to 700.
- Numbers, JetBrains Mono with tabular figures for L*a*b*, ITA and DeltaE00.
- The three files are self hosted in `fonts/`.

## Rules kept

- No eyebrow or kicker labels above headings, no uppercase styling.
- No emoji. Icons are inline SVG with `aria-hidden="true"`.
- No em dash or en dash anywhere, enforced by a test.
- Radios are real radios inside labels, the divider is a real range input with a label, and every state of a button is styled, including busy, success and error.
- Reduced motion removes the entrance animation and the transitions.
- Layout checked at 320, 375, 414, 768 and 1024 pixels with no horizontal overflow.
- No fake browser chrome and no stock imagery. The skin specimen is drawn in code and labelled as such.

## The screening literacy lab

The workbench reuses the existing panel, hint, band-tag and mono-line parts, and the section keeps the band head pattern of title on the left and lead on the right. ABCDE letters sit in ink circles inside real fieldset legends, and every option is a real radio inside its label.

The fairness chart is one SVG computed in `fairness-lab.js` and assigned to `innerHTML`, so a redraw cannot drop event state. Sensitivity bars are ink for types I to IV and carmine accent for types V and VI, with Wilson 95% intervals as whiskers. The pooled I-II and V-VI sensitivities are sage rules and the gap reads off a bracket at the right. A lower panel plots observed positive share against mean score per bin beside a dashed diagonal. Type names are Plus Jakarta Sans and the numeric labels are JetBrains Mono, both enlarged at small widths.

Self test rows list the check name, a detail line in muted text and a pass or fail tag, all inside the existing tag styles.
