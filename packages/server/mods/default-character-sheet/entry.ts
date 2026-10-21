// First real character-sheet-template mod -- MVP goal item 4
// (docs/ROADMAP.md), slice 1. Proves the "pure content mod" path end
// to end: exports ONLY `characterSheetTemplate` (plain, side-effect-
// free data), no register()/unregister() at all -- the standalone
// characters page reads this directly via a dynamic import(), with no
// live WorldRoom/room context needed (see modLoader.ts's own doc on
// why register/unregister are optional on ModEntry).
//
// HP/MP defaults match CharacterRecord's own existing fixed defaults
// (store.ts's createCharacterInternal: hp/maxHp/mp/maxMp all 10) --
// this mod's variables are a separate, additive data path for now
// (CharacterRecord.variableValues), not yet wired to replace those
// fields in the live 3D game (that migration is a roadmap follow-up,
// not this slice).

import type { CharacterSheetTemplate } from "@ttrpg3d/shared";

export const characterSheetTemplate: CharacterSheetTemplate = {
  name: "Default Character Sheet",
  variables: [
    { id: "hp", label: "HP", type: "xOfY", default: 10, max: 10 },
    { id: "mp", label: "MP", type: "xOfY", default: 10, max: 10 },
  ],
  pages: [
    {
      title: "Overview",
      markdown: "# Overview\n\nA minimal starter sheet -- just hit points and magic points.",
      variableIds: ["hp", "mp"],
    },
  ],
};
