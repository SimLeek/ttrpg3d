// First real character-sheet-template mod -- MVP goal item 4
// (docs/ROADMAP.md). Proves the "pure content mod" path end to end:
// exports `characterSheetTemplate` (plain, side-effect-free data) AND
// `characterSheetLibrary` (plain, trusted functions a sheet's markdown
// can call by name), no register()/unregister() at all -- the
// standalone characters page reads/calls both directly via a dynamic
// import(), with no live WorldRoom/room context needed (see
// modLoader.ts's own doc on why register/unregister are optional on
// ModEntry).
//
// Round 4 real correction: this mod's own id used to be
// "default-character-sheet" -- "horribly long... instead of just
// 'default' or 'stdlib'." Renamed to "default" (this directory's own
// name doubles as the id, same convention every other mod already
// uses). The template's markdown used to show `str` via
// `{{default-character-sheet.modifier(str)}}` -- also real feedback:
// "str is already a variable in the sheet, there are not variables
// specific to mods... idk what 'modifier' is supposed to do if it's
// an actual function." A plain variable doesn't need a mod-qualified
// function call at all -- it's shown via the new, purely client-side
// `{str}` inline reference instead. `modifier()` itself stays (it's
// genuine computed logic -- a real D&D-style ability-score modifier,
// floor((score-10)/2) -- not fake), just clearly labeled now so it's
// obvious it's a COMPUTED value, not the only/default way to show a
// variable.
//
// `characterSheetTemplate` itself is only ever used as a CLONE
// SOURCE -- picking this template deep-copies these pages/variables
// into the character's own, separately editable `customSheet`; this
// mod is never consulted again for rendering after that. HP/MP
// defaults match CharacterRecord's own existing fixed defaults
// (store.ts's createCharacterInternal: hp/maxHp/mp/maxMp all 10) --
// this mod's variables are a separate, additive data path for now
// (CharacterRecord.variableValues), not yet wired to replace those
// fields in the live 3D game (a roadmap follow-up).

import type { CharacterSheetTemplate, CharacterSheetLibraryFunction } from "@ttrpg3d/shared";

export const characterSheetTemplate: CharacterSheetTemplate = {
  name: "Default Character Sheet",
  variables: [
    { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 },
    { id: "mp", label: "MP", type: "xOfY", default: 10, max: 10 },
    { id: "str", label: "Strength", type: "number", default: 10 },
  ],
  // Matches the colors the old hardcoded HP/MP billboard bars used
  // (#c0392b / #2980b9) -- bars are now configurable per-sheet
  // (docs/ROADMAP.md item 4 follow-up), but a freshly-cloned default
  // sheet should still look the same as it always did.
  bars: [
    { variableId: "hp", color: [0.753, 0.224, 0.169] },
    { variableId: "mp", color: [0.161, 0.502, 0.733] },
  ],
  pages: [
    {
      title: "Overview",
      markdown: "# Overview\n\nHP: {hp}\n\nMP: {mp}\n\nStrength: {str}\n\nStrength modifier (computed by the `default` mod's `modifier` function): {{default.modifier(str)}}",
      variableIds: ["hp", "mp", "str"],
    },
  ],
};

const modifier: CharacterSheetLibraryFunction = (args) => {
  const score = typeof args[0] === "number" ? args[0] : Number(args[0]) || 0;
  return Math.floor((score - 10) / 2);
};

export const characterSheetLibrary: Record<string, CharacterSheetLibraryFunction> = { modifier };
