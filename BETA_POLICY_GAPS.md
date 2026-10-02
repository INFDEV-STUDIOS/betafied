# Beta policy gaps

Open decisions found while collapsing the three parallel Beta truth tables (`betaRegistry.ts`,
`normalizer.ts`, `compatibilityPolicy.ts`) into one owner each. Each item below is a place where a
declared rule and the shipped behaviour disagree. None of them is a bug in the collapse itself —
they are pre-existing, and they were previously invisible because a test asserted the declared table
rather than the code path that runs.

Deciding an item means picking one of:

- **Implement** — make the code do what the rule says (a gameplay change, needs an in-game look).
- **Drop the rule** — accept the current behaviour and delete the claim.
- **Keep written down** — leave it here as a known, intentional difference.

## 1. Inventory conversions that were declared but never implemented

`compatibilityPolicy.ITEM_CONVERSIONS` was deleted: it had no production consumer, and
`normalizeItem` — the function the inventory sweep actually calls — does not implement many of its
entries. Today these ids are **deleted on pickup** rather than converted, because they fall through
every heuristic in `normalizer.normalizeItem` to `{ action: "remove" }`:

| Item | Declared target | Current behaviour |
| --- | --- | --- |
| `minecraft:mud`, `minecraft:muddy_mangrove_roots` | `minecraft:dirt` | removed |
| `minecraft:suspicious_sand` | `minecraft:sand` | removed |
| `minecraft:suspicious_gravel` | `minecraft:gravel` | removed |
| `minecraft:bamboo_block` | `minecraft:oak_log` | removed |
| `minecraft:crafting_table` | `bh:crafting_table` | removed |
| the 18 post-Beta flowers (`cornflower`, `allium`, `lilac`, `sunflower`, …) | `minecraft:poppy` | removed |
| `minecraft:white_dye`, `black_dye`, `blue_dye`, `brown_dye` | `bone_meal`, `ink_sac`, `lapis_lazuli`, `cocoa_beans` | removed |
| `minecraft:packed_ice`, `minecraft:blue_ice` | `minecraft:ice` | removed |
| the 17 `*_terracotta` variants | `minecraft:clay` | removed |

The terracotta and brick cases are the ones to think about hardest, because world terrain *does*
repaint them: `BLOCK_BULK_REPLACEMENTS` maps every terracotta to sandstone. So a mined terracotta
block currently becomes sandstone on the ground, which is consistent — but the matching item id
silently vanishes if it arrives any other way.

## 2. `stone_bricks` has two contradictory stances

`normalizer.test.ts` asserts `normalizeBlock("minecraft:stone_bricks")` is **removed** (Beta 1.7.3
had no stone bricks), while the deleted table claimed `stone_bricks → minecraft:stone`. The collapse
kept the removal, since the scrubber's job is to erase blocks the era never had. Worth confirming
that deleting a player's stone bricks is the intent rather than converting them to stone.

## 3. `raw_copper` resolves differently on the ground and in the inventory

- `normalizeEntityDrop("minecraft:raw_copper")` → `minecraft:iron_ore` (the ore-block stance)
- `normalizeItem("minecraft:raw_copper")` → `minecraft:cobblestone` (the item stance)

`resolveDropId` takes the first path, so a copper pickup becomes an iron ore block. The second path
only matters if a raw copper stack reaches an inventory some other way. Pick one target if the split
is not deliberate.

## 4. Resolved: vanilla fences are moved onto `bh:fence`

`BETA_BLOCK_IDS` lists `minecraft:oak_fence` as authentic, so `normalizeItem` still answers `keep`
for it — but that layer answers "may this id exist in the world", which is true and separately
pinned by a test. A **held** item never reaches that answer alone: `inventoryManager` consults the
placer table first, which now retypes every `*_fence` and `*_fence_gate` onto `bh:fence`, and
`recipes/oak_fence.json` overrides vanilla's `minecraft:fence` recipe id so a crafted fence is already
the custom block. `tests/policy/inventoryManager.test.ts` pins the retyping.

Still open: the **chunk scrubber** keeps world-placed vanilla fences, because `normalizeBlock` treats
`minecraft:oak_fence` as authentic terrain. A fence generated into the world therefore still cannot
connect to a `bh:fence` line, which is the only remaining way two fence families can coexist. Decide
whether the scrubber should convert them.

## 6. Fence connectivity stays in script, deliberately

Swapping `bh:fence` onto the declarative `minecraft:connection` trait was investigated and rejected on
three points, all from the official block reference:

- The trait "requires Bedrock Edition 1.21.130 or higher, and currently requires that the 'Upcoming
  Creator Features' experimental toggle is set on". A world without that experiment would lose fence
  connectivity outright, where the script works anywhere. The pack's manifest enables no experimental
  toggles by policy.
- The trait exposes four booleans (`minecraft:connection_north` and friends), not the single 4-bit
  `bh:connections` mask the block and its Molang `bone_visibility` are built around. That makes the
  switch a rewrite that also has to drop the custom state.
- `minecraft:connection_rule.accepts_connections_from` offers only `all`, `none` and `only_fences`,
  and `only_fences` is documented as "all Vanilla fences excluding NetherBrick". A custom `bh:fence`
  is not a vanilla fence, so the rule cannot express fence-to-fence connectivity.

So the script remains the owner. Its known weakness is that it recomputes only on player place and
break, meaning a fence whose neighbour changes some other way — a command, a structure, generation —
keeps a stale connection mask.

## 5. Loot-table vocabulary (partly resolved)

The vanilla behavior pack under `reference-docs/…/VanillaBehaviorPack` settles the item-id question
this note previously left open: Bedrock's raw and cooked fish are `minecraft:fish` / `minecraft:cooked_fish`,
and a coloured wool is `minecraft:wool` with `minecraft:set_data_from_color_index`. `minecraft:cod` is
the *entity* identifier, never an item.

Resolved here:

- `normalizer.FOOD_CONVERSIONS` now also maps `minecraft:fish` / `minecraft:cooked_fish`, and
  `betaRegistry.BETA_ITEM_IDS` registers them, so a caught fish lands on `bh:cod` / `bh:cooked_cod`
  instead of being swept. The `cod` / `salmon` spellings stay as harmless aliases.
- `loot_tables/entities/sheep.json` gained the `minecraft:set_data_from_color_index` function it was
  missing, so the death drop resolves the sheep's colour the way the shear table already did.
- The zombie feather drop was removed from `entitySpawnHandler`; `loot_tables/entities/zombie.json` is
  now the single owner of that drop.
- `swordMining.SWORD_FAST_BLOCKS` dropped the legacy ids (`web`, `leaves`, `leaves2`, `wooden_stairs`,
  `wool`) that never resolve on this engine, and takes its palette from `betaRegistry.WOOL_BY_COLOR`.

Still open, and genuinely engine-dependent: the pack's own fishing tables sit at
`loot_tables/fishing.json` and `loot_tables/fishing/*.json`, not at the vanilla
`loot_tables/gameplay/fishing/*.json` path the fishing hook reads, so nothing loads them until an
override is placed on the vanilla path. Confirm in-game which tables the hook uses, then either move
these onto the vanilla path or delete them.

## 7. Ore generation (partly resolved — needs an in-game look)

Beta 1.7.3 had no emerald (arrived in 1.3) and no copper (1.17), but both still generate on modern
terrain. Two mechanisms now cover that, deliberately at different layers:

- **Generation:** `features/emerald_ore_feature.json`, `copper_ore_feature.json` and
  `dripstone_caves_copper_ore_feature.json` are inert `ore_feature` stubs, following the same
  override-by-identifier pattern as the vine, glow-lichen and fallen-tree stubs. This keeps the ores
  out of *new* chunks instead of generating and then erasing them.
- **Scrubber (the guaranteed net):** `BLOCK_BULK_REPLACEMENTS` maps `emerald_ore` and
  `deepslate_emerald_ore` to `minecraft:stone`. The old table sent `emerald_ore` through
  `normalizeBlock`, which had no entry for it and defaulted to `remove` — every emerald vein in
  already-generated ground was being scrubbed to **air**, punching ore-shaped holes in terrain.

Still engine-dependent: whether a behavior pack's ore-feature stub actually pre-empts vanilla's
ore feature rule has to be confirmed in-game, the same caveat the vine/lichen stubs carry. If it does
not, the scrubber mapping above is what keeps the world correct. Retuning *where* the surviving Beta
ores generate (their Y-ranges and vein counts still match modern, not Beta) would mean overriding the
vanilla ore feature *rules*, which nothing here does yet.

## Why this file exists

The failure mode these items share is the one worth guarding against: a rule was written down in one
file, the behaviour lived in another, and a test in a third asserted the rule rather than the
behaviour. Every case above was green in CI while the game did something else.
