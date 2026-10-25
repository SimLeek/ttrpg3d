# Character sheet import + token visuals — requirements

Two asks from the same request (2026-10-25), scoped together here since
both touch `characterSheet.ts`/the character-sheet system, but sized
very differently -- part 1 needs real decisions before any code gets
written; part 2 is concrete enough to build straight from this doc.

## Part 1: Import a document to generate a character sheet

### Context

`docs/ROADMAP.md` item 4 always named "mod-based sheet importers" as
part of the full character-sheet system, but it was explicitly pulled
out and parked in `docs/DEFERRED.md` on 2026-10-21: *"hold on mod based
importers for now until I get some test sheets to work with"* -- the
whole point being not to design the importer mod interface against a
guessed shape. The user has now supplied real test data: a public
**Lyrian Chronicles** character sheet (Google Sheets). This section
un-defers that item against the real thing instead of a guess.

### What's actually in the supplied sheet (read directly, not guessed)

Fetched via its own public XLSX export
(`.../export?format=xlsx`) and inspected with openpyxl. 18 tabs:

- **Core**: personal info (name/race/sub-race/gender/age/etc.), the
  combat block (HP, Mana, Initiative, Evasion, Dodge, Guard, Block,
  Save Bonus, Potency, Speed, RP, Light/Heavy Damage dice), 4 main
  stats (Focus/Power/Agility/Toughness) + 5 sub-stats (Fitness/
  Cunning/Reason/Awareness/Presence), a full skill list with
  stat/bonus/points, proficiencies, crafting skills, a class/tier/
  level table, a weapon/armor-location table, and the character-
  creation point-buy arrays.
- **Abilities** / **Breakthrough** / **Custom Abilities**: each row is
  ONE ability the character actually knows, picked via a Sheets
  dropdown (data validation) against a master list -- the hidden **All
  Abilities** tab, which is itself a live `IMPORTRANGE` pull from a
  SEPARATE master rulebook spreadsheet (~2500 rows). Picking a name
  auto-fills cost/keywords/range/requirement/description/benefits via
  lookup formulas in the other columns. **Breakthroughs**/**Classes**/
  **Races** are the same pattern (hidden, imported, reference-only).
- **Inventory** / **Mirane Locker**: item lists.
- **EXP & Transactions** / **Leveling Planner**: a running ledger and a
  level-up planning calculator.
- **Images** / **Backstory** / **Journals**: embedded character art, a
  freeform backstory, a freeform play journal.

The hidden lookup tabs (All Abilities/Breakthroughs/Classes/Races) are
the SYSTEM's own rulebook data, not this character's own data -- a
sheet only ever selects rows out of them. Pulling those in whole would
mean importing the entire Lyrian Chronicles rulebook, not one
character.

### v1 scope (confirmed, 2026-10-25)

- **Page 1, "Core"**: the front page -- the Core tab's own stat block,
  as character-sheet VARIABLES (`number`/`xOfY`) via a NEW "Lyrian
  Chronicles" character-sheet-template mod (same `characterSheetTemplate`
  shape the `default` mod already uses), rendered with `{variable}`
  inline refs on this page's own markdown.
- **Page 2, "Abilities"**: Abilities + Breakthrough + Custom Abilities
  MERGED into one page (not three) -- each tab's rows, one entry per
  known ability, verbatim.
- **Page 3, "Inventory"**: the Inventory tab's rows.
- **Skipped for v1**: Backstory, Journals, the sheet's OWN "Images"
  tab (confirmed: NOT reused as the new token-image feature in Part 2
  either -- those two stay unrelated), EXP & Transactions, Leveling
  Planner. The hidden lookup tabs (All Abilities/Breakthroughs/
  Classes/Races) stay hidden/un-imported, but ARE consulted while
  building the mod itself (see "Core's real formula graph" below).
- **"Roll initiative and everything else"**: revives the already-
  reserved-but-never-built `[[dice notation]]`-in-sheets syntax
  (`docs/ROADMAP.md` item 0's own note: *"The `[[notation+var]]`
  character-sheet variable reference specifically is NOT done... `[[...]]`
  today only evaluates plain dice notation, no variable
  interpolation"*). The Core page can show `[[1d20+{initiative}]]` as
  a clickable roll button (the same `button` display convention
  `{variable}`/`{{mod.fn()}}` inline references already use), posting
  to chat exactly like an ordinary dice roll today. Not special-cased
  to Initiative -- applies to any numeric variable a sheet wants a
  roll button for.

### Core's real formula graph (scanned directly, not guessed)

Per request: *"you're going to have to scan the whole sheet and find
the source cells of the equations and what the labels near them
are."* Did exactly that (every formula cell in Core, paired with its
nearest same-row text label) -- real findings, not estimates:

- **Top stat block is almost entirely formulas**, each with a clean
  adjacent label: `HP = 20+(10*Toughness)+HP Bonus`, `Mana =
  ROUNDDOWN(6+Power+Mana Adjustments, 0)`, `Evasion = 7+Agility+Evasion
  Bonus+SUMIF(armor-equipped rows' Evasion column)`, `Dodge =
  20+Agility+Dodge Bonus+SUMIF(...)`, `Guard =
  ROUNDDOWN(Toughness+Equipment Guard Value, 0)`, `Block =
  (Toughness*2)+SUMIF(...)`, `Initiative = Agility+Initiative
  Adjustment-SUMIF(...)`, `Save Bonus = Toughness+Bonus Save Value`,
  `Potency = 11+Focus`, `RP = IF(oldArmorCalc, 2+(Agility-Equipment
  Penalty), 2+Agility)-RP Adjustment`. The weapon/armor table
  (rows 36-42) feeds most of these via `SUMIF` against its own "Armor
  Equipped?" checkbox column -- a real equipment-bonus system, not
  decoration.
- **The 4 main stats and 5 sub-stats are ALSO formulas**, not flat
  numbers: each matches the character's own point-buy choice (`IFS`
  against the "Character Creation Array" table, rows 44-49) against a
  racial/class bonus column, PLUS a couple of per-stat adjustment
  cells (Agility/Toughness specifically have their own named
  adjustment cells, e.g. `Agility = ...+Main Stat Bonus-Equipment
  Penalty+Racial Ability Adjustment`).
- **Skills (rows 9-29) are a different 4-column layout**: skill NAME
  lives in column E, its governing stat in F, its total bonus (a
  formula: governing-substat-total + a flat per-skill bonus) in G,
  skill points spent in H. A naive "look left for a label" scan grabs
  the governing-stat name here, not the skill's own name -- the real
  scan needs to special-case this block's own column layout, not use
  one generic rule for the whole tab.
- **Class/tier (rows 15-20, column B) are themselves live
  `IMPORTRANGE`/`INDEX`/`MATCH` lookups into the hidden Classes tab**
  (itself importing from the separate master rulebook spreadsheet) --
  this is the concrete reason the hidden lookup tabs need to be
  consulted while building the mod (to know what a class's own tier
  bonus table looks like), even though they're never imported/exposed
  directly.

### Open question this raises

**Decided, 2026-10-25: live formula port.** HP/Evasion/Dodge/Guard/
Block/Initiative/Save Bonus/RP and the main+sub stats get ported as
real `characterSheetLibrary` functions mirroring the sheet's own
formulas (base/point-buy-chosen stats stay plain variables; derived
ones become `{{lyrian-chronicles.hp(toughness, hpBonus)}}`-style
calls) -- so raising Toughness later actually moves HP, same as the
real spreadsheet. This is a real reimplementation of a meaningful
slice of Lyrian Chronicles' own character-creation math (point-buy
arrays, racial/class bonus tables sourced from the hidden lookup tabs,
equipment-table `SUMIF`s), not a quick add -- see "Proposed build
order" below for how this gets sequenced into shippable pieces rather
than one all-or-nothing pass.

### Proposed build order (too large for one pass)

1. **Plumbing first, with trivial variables**: the new `ModEntry`
   importer capability, the client-side fetch-the-export-URL + upload
   flow, and the new upload endpoint (Part 2 also needs this same
   endpoint for token images, so it's shared groundwork) -- proven end
   to end with just the character's name/a couple of flat Core numbers,
   no formulas yet. This is what makes every later step testable
   against a REAL import, not a mocked one.
2. **Main + sub stats** (Focus/Power/Agility/Toughness, Fitness/
   Cunning/Reason/Awareness/Presence) -- the point-buy-array lookup
   plus racial/class bonus columns, since every other formula in Core
   depends on these being right first.
3. **Top stat block** (HP/Mana/Evasion/Dodge/Guard/Block/Initiative/
   Save Bonus/Potency/RP) -- depends on step 2, plus the equipment
   table's own `SUMIF`s (which need the weapon/armor rows imported
   too, even though Inventory itself is a separate page).
4. **Page 2 (Abilities+Breakthrough+Custom Abilities) and Page 3
   (Inventory)** -- straightforward row-to-markdown generation, no
   formula work, can happen in parallel with 2/3 once step 1 lands.
5. **`[[dice notation]]` variable interpolation + roll buttons** --
   the general mechanism (useful for every sheet, not just this mod),
   landing once there's a real Initiative value to roll against.

Skills (the 20-row list, each with its own governing-stat + bonus
formula) and the class/tier `IMPORTRANGE` lookups are real but
smaller, best slotted in after step 3 rather than blocking it.

### Architecture

Per the 2026-10-21 decision this un-defers: *"the import mechanism
itself was always meant to be a pluggable mod interface, not bespoke
native parsers per format."* Concretely:

- A NEW `ModEntry` capability (`modLoader.ts`), alongside the existing
  `characterSheetTemplate`/`characterSheetLibrary` -- something like
  `characterSheetImporter(rows): { variableValues, pages }`. ALL
  Lyrian-specific mapping logic (which Core cell is HP, how an
  Abilities row becomes page markdown) lives inside a NEW
  `mods/lyrian-chronicles/` mod. Core app code only knows "a mod can
  export an importer function" -- zero Lyrian-specific logic outside
  that mod, same separation `default`'s own template mod already
  models.
- This is genuinely new ground (no importer hook exists yet), not an
  existing extension point being reused.

### Open questions -- need your call before any of this gets built

1. **How does the sheet's data actually reach the server?** The
   server fetching an arbitrary URL a user pastes is a new, security-
   sensitive capability (SSRF-shaped) this codebase doesn't have
   anywhere today. Options: (a) the CLIENT fetches the export (an
   ordinary same-browser fetch, no server trust boundary) and uploads
   the result; (b) the user downloads the XLSX/CSV themselves and
   uploads that file directly; (c) the server fetches the URL, scoped
   tightly (e.g. only `docs.google.com` export URLs, nothing else).
2. **What raw shape does the importer mod actually receive** -- a
   parsed-to-JSON workbook (one array of rows per tab), or is the
   CSV/XLSX parsing itself also the mod's own job? Parsing XLSX needs a
   real library either way (no dependency on one exists in this repo
   yet); keeping that in core and handing mods clean rows is probably
   right, but confirm.
3. **Confirm the v1 scope above** -- which tabs become pages, which
   are skipped for now.
4. **Is "Lyrian Chronicles" its own installable mod**, same as any
   other mod a GM turns on for their game (consistent with the
   existing mod-management tab), or something else?

## Part 2: Character token visuals (current/piloted character only)

### Request, verbatim

*"The character tokens... we just want the current character box to,
rather than be a solid opaque box, be basically the glass box voxel we
had, but colored based on whatever color we chose, and have a billboard
displaying only the character token inside that box, and the token
should be circular so sphere pack the largest sphere that will fit in
the box in the center (diam=min w,h,d) and that would be the billboard
width and height. You should also be able to import images for that
token, onto the character sheet as a fixed non-removable variable
similar to width height and depth, which should then display on those
character face billboards."*

Scope, confirmed by "the CURRENT character box" -- only the character
you're actively piloting/focused on (`playerBodyMesh.ts`'s own body
mesh), not every remote/placed token in the world, for this pass.

### What's there today (read directly, not guessed)

- `playerBodyMesh.ts` builds a plain `CreateBox` + opaque
  `StandardMaterial` with a flat `diffuseColor` -- the "solid opaque
  box" the request means.
- The world's own GLASS voxel block (`voxelTypes.ts`'s `GLASS`,
  `textureFile: "glass.png"`, `transparencyMode: "cutout"`) renders via
  `cubeObjectMesh.ts`'s `buildCubeObjectMesh`, confirmed to be exactly
  a cube with one pixel of white along each face's own border and full
  alpha everywhere else -- i.e. visually, just a wireframe box. Real
  correction, 2026-10-25: rather than copy that texture, build the box
  as an ACTUAL wireframe with a real, settable line width -- Babylon's
  plain `material.wireframe = true` doesn't give that (native WebGL
  line width is capped at 1px in effectively every browser); the real
  mechanism, confirmed present in this repo's own installed
  `@babylonjs/core@6.49.0` (`Meshes/Builders/greasedLineBuilder`,
  `Meshes/GreasedLine/greasedLineMesh`), is `CreateGreasedLine` -- a
  thick-line mesh with a genuinely configurable `width`, unaffected by
  that native cap. The box becomes the 12 edges of a
  bodyWidth/Height/Depth cuboid, built as one greased-line mesh, with
  its line `color` set to the character's own token color.
- `characterSheet.ts`'s `RESERVED_BODY_SIZE_VARIABLES` is the EXACT
  existing precedent for "fixed, non-removable, every character has
  it" variables (bodyWidth/Height/Depth) -- a new `tokenImage` entry in
  that same array is the natural home for the new reserved variable,
  not a new mechanism.
- **No file-upload mechanism exists anywhere in this codebase yet**
  (grepped: no multipart/FormData/file-input handling on either side) --
  this needs real, new plumbing either way.

### Gherkin

```gherkin
Feature: Current character's box renders as a colored wireframe, with a circular token billboard inside

  Scenario: The piloted character's body box renders as a wireframe, not a solid box
    Given a session is piloting a character
    Then that character's own body box renders as its 12 edges only
      (a real wireframe, via a thick-line mesh with a genuinely
      settable width), not a solid filled box
    And the inside of the box is otherwise see-through -- there is no
      filled/opaque surface at all, only the edges

  Scenario: The wireframe is colored by the character's own chosen token color
    Given a session's character has token color set to a specific RGB
    Then the wireframe box's own line color matches that token color,
      not a fixed/default color

  Scenario: The wireframe's line width is configurable
    Given the wireframe box's own line width setting
    Then changing it visibly changes how thick the box's edges render,
      not capped at a single native-GL pixel width

  Scenario: A circular billboard sits inside the box, sized to the largest sphere that fits
    Given a character's body is bodyWidth=0.6, bodyHeight=1.8, bodyDepth=0.6
    Then the token billboard's diameter equals min(0.6, 1.8, 0.6) = 0.6
    And the billboard is centered inside the box, not offset to one side
    And the billboard's own width and height both equal that same
      diameter (a circle, not an ellipse)

  Scenario: Only the currently-piloted character gets this treatment, for now
    Given a session sees another player's remote character token, or a placed/other-character instance
    Then that OTHER token still renders with today's existing box/
      billboard appearance, unchanged by this feature

  Scenario: Importing an image sets the character's token image, a fixed/non-removable variable
    Given a session opens their character's sheet
    Then there is a "token image" field in the same reserved, non-
      removable tier as body width/height/depth -- not a page-specific,
      author-removable variable
    When they import/upload an image for it
    Then that image is now this character's tokenImage value

  Scenario: The imported token image renders on the circular face billboard
    Given a character has a tokenImage set
    When that character's box+billboard render in the 3D world
    Then the circular billboard shows that image, not blank/placeholder
      content

  Scenario: A character with no tokenImage set still renders sensibly
    Given a character has never set a tokenImage
    Then the circular billboard shows a flat fill of that character's
      own token color (same color the wireframe box uses), not a
      broken/blank texture
```

### Decided / defaulted

- **Image storage, confirmed 2026-10-25**: a new upload endpoint,
  writing to disk; the `tokenImage` variable holds a URL, not base64
  bytes -- keeps the Colyseus-synced character state small.
- **Fallback for no image set** (defaulted, not explicitly asked): the
  circular billboard shows a flat fill of the character's own token
  color, same color the wireframe box itself uses -- no separate
  placeholder asset needed, and it's never "broken/blank" since every
  character already has a token color today.
- **Size/format limits** (defaulted): PNG/JPG/WebP, a modest max
  dimension (e.g. 512x512) and file size (e.g. 2MB) enforced at
  upload, same spirit as any ordinary avatar-upload limit elsewhere on
  the web -- revisit if real use shows this is wrong.
