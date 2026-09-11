# FORA Brand Reference

The marketing voice and visual attitude for FORA (Field Operations Record
Automation). This sits alongside `website/design.md` (the locked site design
system) — `design.md` governs pixels and code on `website/`, this file
governs tone, positioning, and the edgier assets (merch, decks, social) that
don't live in the site build.

## Tagline

**NO SUITS. NO BS. JUST RESULTS.**

This is the official tagline. Use it as-is, no rewording. It can run
standalone or under the FORA wordmark.

## Positioning

FORA is field documentation software built by someone who's spent 15 years
running heavy equipment, not by a software company guessing what a jobsite
needs. It replaces the binder, the clipboard, and the generic template
builder with something that actually understands field work.

The enemy isn't "paper" — it's people who've never worn steel toes selling
software to people who have. Every competitor in this space (SafetyCulture,
SiteDocs, GoCanvas, etc.) is built by people who've never set foot on a
site. FORA is built by one.

## Voice

Casual, blunt, direct. Talk the way you'd talk to Rob or Jordana, not the
way a SaaS landing page talks. Short sentences. No corporate padding. No
"leverage," "synergy," "streamline your workflow," or similar jargon.

Swearing is allowed and expected in the right spot — used deliberately for
emphasis, not sprinkled in for shock value. If a sentence hits harder
without the word, drop the word.

**No em dashes, anywhere.** Use periods, commas, or just start a new
sentence.

No reassuring language ("don't worry," "it'll be fine," "trust me"). State
things plainly and let the plainness do the work.

### Cringe list — never use these

- "This can't be done"
- "I love AI slop"
- "Speak to a real designer"
- "What is the point?"
- "You're doing the perfect job"
- Any generic SaaS filler: "unlock," "empower," "seamless," "best-in-class,"
  "game-changer," "revolutionize"

### What good FORA copy sounds like

- "No suits. No bs. Just results."
- "Your inspections don't need a template. They need to actually get read."
- "Built by someone who's run a loader for 15 years, not a product manager
  who's read about one."

### What bad FORA copy sounds like

- "FORA empowers field teams to seamlessly digitize their safety workflows."
- "We're excited to announce our best-in-class inspection platform."

## Visual system

### Primary brand (website, product, anything customer-facing day to day)

This is locked in `website/design.md` — don't fork it here. Summary:

- Near-black ground (`oklch(9% 0 0)`) with FORA orange accent (`#F97316`)
- Display type: Space Grotesk, weight 700
- Body type: Inter, weight 400/500/600
- Orange stays the core brand color across the site, product, and most
  external materials (pitch decks, pricing docs).

### Attitude layer (merch, stickers, social, one-off edgy pieces)

The black-and-white stencil/grunge aesthetic (skull mascot, torn brush
lettering, heavy equipment linework) is a secondary treatment, not a
replacement for the primary system. Use it where a harder, louder mark
earns its place and orange-on-black would feel too polished:

- Stickers, patches, swag
- Social posts that want to stand out from typical B2B SaaS content
- One-off "attitude" pieces where the brand needs to punch, not explain

Style notes from the reference sheet:
- High-contrast black and white, hand-stenciled/spray-paint texture
- Distressed, torn-edge brush lettering for "FORA" and the tagline
- Heavy equipment (excavator) rendered in bold linework, not photoreal
- Skeleton-in-hardhat mascot (unnamed for now) — construction worker who's
  seen it all and doesn't sugarcoat anything. Sunglasses, hard hat, folded
  arms energy.
- Badge/patch layout conventions: circular patch, shield/crest patch,
  torn-banner patch, horizontal bar patch — useful shapes for stickers and
  merch

Don't blend the two systems on the same piece (no orange skull, no
grunge-textured pricing page). Pick one per deliverable based on where it's
going.

## Mascot

The skeleton foreman is a real brand asset, not just a reference vibe.
Rules until it's formally named:
- Always in a hard hat
- Black and white only, stencil/high-contrast style, matches the reference
  sheet
- Reserved for the attitude layer (merch, stickers, social) — not the
  website or product UI
- Attitude: unbothered, blunt, has seen every excuse in the book and isn't
  buying it

## Where this applies

- Website copy (`website/*.html`) — voice and cringe-list rules apply on
  top of the locked visual system in `design.md`
- Sales decks and pitches (`prospect-pitch-builder`)
- Social/ad content and merch
- Internal reference for keeping any Claude session (or anyone else
  writing FORA copy) consistent on tone

## Open items

- Mascot name — not yet decided
- No approved production-ready mascot artwork exists yet in the repo; the
  reference sheet is inspiration/direction, not a final asset to ship
