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
// Real correction (round 2): "the mod is not supposed to be _just_ a
// template, but also libraries allowing different stuff in the
// character sheet, like functions that act on different variables,
// that you could then set to be called in MD or RST." `modifier`
// below (a real D&D-style ability-score modifier, floor((score-10)/2))
// is the proof case -- the template's own markdown calls it inline
// via `{{default-character-sheet.modifier(str)}}`.
//
// `characterSheetTemplate` itself is now only ever used as a CLONE
// SOURCE (round 2) -- picking this template deep-copies these pages/
// variables into the character's own, separately editable
// `customSheet`; this mod is never consulted again for rendering
// after that. HP/MP defaults match CharacterRecord's own existing
// fixed defaults (store.ts's createCharacterInternal: hp/maxHp/mp/
// maxMp all 10) -- this mod's variables are a separate, additive data
// path for now (CharacterRecord.variableValues), not yet wired to
// replace those fields in the live 3D game (a roadmap follow-up).

import type { CharacterSheetTemplate, CharacterSheetLibraryFunction } from "@ttrpg3d/shared";

export const characterSheetTemplate: CharacterSheetTemplate = {
  name: "Default Character Sheet",
  variables: [
    { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 },
    { id: "mp", label: "MP", type: "xOfY", default: 10, max: 10 },
    { id: "str", label: "Strength", type: "number", default: 10 },
  ],
  pages: [
    {
      title: "Overview",
      markdown:
        "# Overview\n\nA minimal starter sheet -- hit points, magic points, and one ability score.\n\nStrength modifier: {{default-character-sheet.modifier(str)}}",
      variableIds: ["hp", "mp", "str"],
    },
  ],
};

const modifier: CharacterSheetLibraryFunction = (args) => {
  const score = typeof args[0] === "number" ? args[0] : Number(args[0]) || 0;
  return Math.floor((score - 10) / 2);
};

export const characterSheetLibrary: Record<string, CharacterSheetLibraryFunction> = { modifier };
