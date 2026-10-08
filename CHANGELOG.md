# Changelog

Notable changes in each Betafied release. Version numbers match the behavior and resource pack manifests.

## 5.3.2 — 2026-10-07

5.3.2 is a fix-up release: items, food and bows unstack properly without duplication, the chest recipe
crafts the Beta chest across all plank varieties and overrides vanilla's recipe, and world boundary
lookups are guarded cleanly.

### Item normalization and unstacking

- **Custom food and bow unstacking.** Custom foods (`bh:` porkchop, bread, apple, cod, golden apple)
  and bows (`bh:bow`) are now evaluated during the inventory sweep. Stacked foods unstack to Beta limits
  (cookies up to 8, other foods down to 1), and stacked bows unstack into individual items while stripping
  modern enchantments.
- **Duplication prevention during unstacking.** `handleItemUnstacking` now respects maximum stack sizes
  when distributing overflow across empty slots and when dropping items into the world, dropping items
  in bounded stacks rather than a single oversized bundle.
- **Cake is unstackable.** Added `minecraft:cake` to `UNSTACKABLE_UTILITIES`.

### Chest crafting recipe

- **Overrides the vanilla recipe identifier.** The shaped recipe now uses `minecraft:chest` as its
  identifier with `["crafting_table", "beta_crafting"]` tags, preventing players from crafting modern
  vanilla chests on either table.
- **Universal plank support.** Recipe inputs and unlock criteria use the `minecraft:planks` tag instead of
  requiring oak planks exclusively, allowing all plank types to craft `bh:chest`.

### World and boundary guards

- **Out-of-bounds submersion guard.** `isHeadSubmerged` in `underwaterOverlay.ts` checks the dimension
  height range (`head.y < min || head.y >= max`) before calling `getBlock`, eliminating recurring
  `LocationOutOfWorldBoundariesError` exceptions when players are above the world or below the void, and
  lifting the screen tint cleanly when entering the void.
- **Bedrock floor preservation.** `chunkScrubber.ts` no longer clears bedrock above the floor ceiling,
  leaving intentional bedrock above Y=2 untouched during chunk scans.

## 5.3.1 — 2026-10-07

5.3.1 is a script-only fix-up: no blocks, items or recipes changed, and the world generates exactly
as 5.3 left it. The headline is the return of farmland trampling on the era's terms, which Bedrock
had banished to landings only; the rest is the same behaviour carried by less code.

### Farmland trampling

Bedrock tramples farmland only when something *lands* on it, so Beta's walking rule — the thing that
made farms need fences — was missing entirely, and jumping on a farm destroyed it, which the era never
did. `interactions/cropTrampling.ts` re-adds both halves:

- **Walking tramples again**, on Beta's own terms: the era's step cadence, its one-in-four roll, the
  sneak exemption, and the rider exemption — the mount tramples, the player on its back does not. The
  fence trick is total again because the walking rule honours it, exactly as 1.7.3 did.
- **A walked-off crop comes down with its soil and pays the era's drop.** 1.7.3's `BlockCrops` paid
  one wheat only when ripe and up to three rolls of seeds; unripe crops could drop nothing. Waiting
  for the engine's own block update would pop the crop with the modern loot table, so the walking
  rule breaks the crop itself and spawns the era's drops.
- **Bedrock's landing trample is undone, not prevented.** The engine converts the block inside its own
  tick with no script hook in front of it, so the module watches the columns a falling entity is
  heading into and puts the farmland — moisture and crop growth included — back from a snapshot, and
  clears the crop drops the break spawned so the restore cannot be farmed for free. The guard serves
  every game mode, because it is undoing an engine behaviour the era never had.
- **Placed dirt is the player's.** Dirt a player puts down on a watched tile is left alone; only the
  engine's own trample is restored.

Beta's mobs trample too, since `canTriggerWalking()` was true for every entity; if animal trampling
proves too punishing on a server, that sweep is the first constant to revisit — see
`BETA_POLICY_GAPS.md` §8, which also lists the in-game checks still owed.

### Same behaviour, less script

The two tool-bonus modules were the same tick loop written twice. They are now one `toolMining.ts`
module that runs both halves — the pickaxe's redstone-mining fatigue and the sword's leaf-and-wool
speed — through a shared pass, and `main.ts` loads a single module for them. The inventory sweep's
four near-identical slot loops collapsed into one implementation for both the 36-slot inventory and
the equipment slots, and the apple-drop check reads its 27-cell neighbourhood once per spawn instead
of three times. Net change to shipped script: 32 fewer lines and one fewer module, with the suite
still passing at 393 tests.

### Tooling (not in the pack)

`eslint-rules/` adds three Betafied-owned ESLint rules, the notable one being `no-beta-api`, which
warns when script calls a member the pinned `@minecraft/server` typings tag `@beta`, so a
dependence on pre-release surface is declared at lint time rather than discovered in game.

## 5.3 — 2026-10-06

5.3 is a fix-up release: the ores that were retuned after 5.2 landed on the pack's own generation
rules, a handful of quietly wrong behaviours are corrected, and the world border is gone. The
headline for survival play is that charcoal exists again — it had been unreachable since the log
rework.

### Charcoal and fuel

The log rework retyped every log a player holds into a custom `bh:` item, and vanilla's furnace
recipes — which take the vanilla log item as input — stopped matching anything. Charcoal was
therefore unobtainable, and nobody noticed, which is exactly the kind of failure this release is
for.

- Each Beta log now smelts into charcoal through its own furnace recipe, matching the input the
  player actually holds. Charcoal carries vanilla's `minecraft:coals` tag natively, so torches,
  campfires and the furnace itself accept it without further content.
- Logs are furnace fuel again. The custom log items carry the fuel component at Beta's 15-second
  burn, which tags alone never granted.
- The furnace minecart burns charcoal the way Beta's burned coal: the interaction filter and its
  script guard accept either item at the same 1600 ticks of fuel.

### Ore generation

- Vanilla's primary ore feature rules for coal, iron, gold, redstone, diamond and lapis keep their
  identifiers but now scatter the pack's own features, carrying Beta's per-chunk attempt counts,
  height bands and vein sizes into the stone family only. The fourteen modern split variants —
  upper, lower, buried, large, square and the mesa and mountains specials — are neutered behind a
  biome tag no biome carries, so nothing double-fires on top of Beta's counts. Whether an override
  by identifier actually pre-empts vanilla's rule still needs the in-game look recorded in
  `BETA_POLICY_GAPS.md`, and so do the pre-1.8 redstone, diamond and lapis vein figures.
- A ground drop of raw copper lands on cobblestone through the same rule the inventory sweep uses,
  instead of being special-cased into iron ore. Beta had no copper at all, and one owner now
  answers for both paths.

### Mob rendering

- The pack owns the vanilla mob render controllers rather than inheriting modern lighting from
  them: each controller re-declares its geometry, materials and textures, because an override
  replaces the definition wholesale and a dropped short name would silently vanish a layer. The
  bat is wired to its controller explicitly, which its client entity never declared.

### World and tooling

- The world border is removed. Radius 4000 was never Beta behaviour, so the module is deleted from
  the tree rather than left dormant, along with its enforcement of a circular playable area.
- Releases are published from the tracked changelog: `npm run release` reads the `## <version>`
  section for the version `package.json` declares and attaches the built pack assets, so a
  published release can no longer describe a build the tree does not contain.
- `scripts/regolith.sh` lets a one-off environment variable override `.env` instead of letting the
  file win, so `BETAFIED_SFTP_PASSWORD=... npm run push` behaves the way it reads.

## 5.2 — 2026-10-02

5.2 is the release where the pack stopped describing Beta and started showing it. The Overworld now
carries Beta's own sky, clouds, sun, block-break crack and pumpkin overlay, and every biome tints its
grass and foliage the way Beta's climate map did — the brown water and washed-out greens of a modern
Bedrock frame replaced by the warmer palette the era actually drew. Underneath the art is a quieter
change that touches most of the tree: the three tables that each claimed to know what Beta was — the
registry, the normalizer and the compatibility policy — have been collapsed onto one owner each, so
the rule a test asserts is now the rule the game runs.

### Sky and biome colour

Beta's environment is temperature-driven. `World.getSkyColor` samples the climate at the player and
hands it to `BiomeGenBase.getSkyColorByTemp`, and grass and foliage are drawn through the colormaps
modulated by the biome's own tint. New terrain now renders the same way.

- Beta's grass colormap ships as `textures/colormap/grass.png`, the era's own `grasscolor.png` rather
  than the modern one Bedrock loads. It is close to what Bedrock already had, so the swap is quiet on
  its own; where it matters is the biome tint multiplied over it.
- Every Overworld biome is emitted as a client biome with a derived `grass_appearance`,
  `foliage_appearance` and `sky_color`, so forest, plains, desert, taiga and swampland each read as
  themselves instead of collapsing onto one global green. The derivation lives in
  `scripts/derive-biome-colors.mjs`, which samples Beta's own climate and colormap math, and the 84
  `packs/RP/biomes/*.client_biome.json` files are generated from it — `npm run generate:client-biomes`
  and a smoke test keep the two from drifting apart.
- The sky colour is Beta's formula and not a constant. `betaColorizer.betaSkyColor` reproduces
  `Color.HSBtoRGB(0.62222224 - t * 0.05, 0.5 + t * 0.1, 1.0)` with the same per-step rounding Java
  used, so a warm biome is tinted and a cold one is not.
- Beta's environment art replaces the modern set: `environment/clouds.png` (the era's crisp layered
  cloud slab), `environment/sun.png`, the block-break crack drawn from ten `destroy_stage_*` tiles
  extracted from Beta's terrain atlas, and `misc/pumpkinblur.png`. Bedrock only understands a 4x2
  moon sheet, so the single Beta moon is repeated across all eight frames rather than shipping the
  phases the era never had. `tests/smoke/skyTextures.test.ts` pins each path and shape.

### One owner per fact

The failure this release is built to prevent is a rule written in one file, its behaviour living in
another, and a test in a third asserting the rule instead of the code path — green in CI while the
game did something else. The three parallel Beta tables are now one owner each.

- `compatibilityPolicy` is reduced to exactly its name: world-block replacement. Its duplicate entity
  allowlist, banned-drop set, ore table and item-conversion table are deleted, because each restated
  a table in `betaRegistry` or `normalizer` and had drifted from it — the entity list was missing
  `oak_boat` and the banned set held only `rotten_flesh`, so it agreed with the spawn handler on
  nothing but the common case.
- `betaRegistry` now owns the shared vocabulary the subsystems used to re-list: the passive, hostile
  and pigman entity sets; the sword and pickaxe tiers; the wood-species groups; and Beta's wool
  palette, which feeds the block allowlist, the sheep drop and the sword bonus from one place.
- Beta constants are one module. `betaConstants.ts` owns the dimension identifiers, the short
  `getDimension` keys and the vertical bounds, and `runtimeSmoke` now fails the build if a
  `getDimension` call is handed a `_ID` constant — the mistake that silently matched nothing.
- `equipmentSlots.ts` and `vectorMath.ts` collect the armor slot list and the boat/minecart vector
  helpers the two vehicle subsystems had each copied and let diverge.
- `FOOD_CONVERSIONS` moved into `normalizer` and `FOOD_ITEMS` membership is derived from it, so a food
  the sweep retypes can never be one the health module forgot to feed; it throws at load rather than
  dropping a conversion on the floor. `resolveDropId` collapses the drop path onto one function, so a
  ground item lands on the id the inventory stacks it into.
- `BETA_POLICY_GAPS.md` records the places where a declared rule and the shipped behaviour still
  disagree, with the evidence for each. None of them is new; they were invisible while a test
  asserted the declaration rather than the behaviour.

### World generation

- Emerald and copper ores are suppressed at generation. Beta had no emerald (1.3) and no copper
  (1.17), but both still generate on modern terrain, so `emerald_ore_feature`, `copper_ore_feature`
  and `dripstone_caves_copper_ore_feature` are shipped as inert stubs. The scrubber's guaranteed net
  changed with them: an emerald vein in already-generated ground is now repainted to stone rather
  than erased to air, which had been punching ore-shaped holes through the rock.
- Vines and glow lichen are stubbed the same way, following the fallen-tree pattern, and the old
  `vine_feature.json` stub — whose identifier did not match a real vanilla feature, so it suppressed
  nothing — is gone.
- The bedrock floor keeps its three-block cap but no longer flattens. The height distribution was
  retuned so the top layer is common instead of rare, which reads as a ragged floor rather than the
  wide plateaus the old math left.

### Other fixes

- Sheep drops match Beta again. The shearing table returned 2-4 wool where Beta's `1 + rand.nextInt(3)`
  is 1-3, and the punch path already used the correct range, so both now resolve from one pair of
  bounds a test pins. A killed sheep's wool also carries its colour now, via the
  `set_data_from_color_index` function the death table was missing.
- The zombie's feather drop is owned by its loot table alone; the script no longer spawns a second
  stack on top of it.
- The oak fence recipe overrides vanilla's own `minecraft:fence` identifier rather than adding a
  second `bh:` recipe, so a crafted fence is already the custom block and carries the `crafting_table`
  tag. Fence connectivity also reports an unloaded neighbour instead of swallowing the error and
  leaving a stale connection mask.
- Netherite and turtle helmets no longer score armor points. They are not authentic Beta gear, and
  the registry strips them; the armor table's suffix heuristic now stops at the vanilla namespace so
  the two systems agree.
- The sword's fast-break set drops the legacy ids (`web`, `leaves`, `wooden_stairs`, `wool`) that
  never resolve on this engine and takes its wool palette from the registry, which is the owner the
  shears and the animal AI already read.
- Slab, stair and log placement normalization is removed from the interaction guards. Every plank,
  log, stair, slab and fence a player can hold is retyped to its `bh:` equivalent on pickup, so the
  custom blocks carried no such post-placement repair to apply; the guard is now the single place
  that has to grow if a vanilla block ever becomes reachable again.
- Deploying a fresh server no longer leaves content logging off. `push.mjs` upserts the logging keys
  in `server.properties` instead of repairing only the literal `=false` form, which did nothing when
  the key was absent altogether — exactly what a new `server.properties` ships.

## 5.1 — 2026-10-01

5.1 is the cleanup that follows 5.0. It closes the gaps the terrain rewrite left open: the foliage
and flowers that were slipping past the scrubber, the sideways logs modern generation scatters as
"fallen trees," and the two chokepoints that made a fresh world worse than an old one — a spawn that
searched down into the new floor and found nothing, and logs that would not stack once picked up.

### World spawn

Beta dropped the player onto whatever terrain the seed produced, and so does this release now that
the custom spawn coordinator is gone. That module teleported a new player to a random point up to
1000 blocks out, lifted them to Y=130 and searched downward for solid, hazard-free ground. Once 5.0
laid the Overworld's bedrock floor at Y=0, that search ran off the bottom of its range over fresh
terrain, the open ocean and any chunk the engine had not loaded yet, so it returned nothing; after
fifteen failed attempts it fell back to a fixed `{0, 80, 0}`, which was often a fall or a drop into
water. Spawn is the engine's own again, and the module is deleted rather than left dormant.

### Fallen trees

Modern overworld generation scatters fallen trees — a log laid flat on the ground — through several
forests. Beta 1.7.3 logs only ever stood upright, so they have no Beta counterpart and are now
gone.

- The engine features that place them are shipped as inert no-ops, so new terrain no longer grows
  them. That is the fix for a fresh world. The five `fallen_*_tree_feature` ids and their five
  `optional_fallen_*` variants are all suppressed; the previous stub named `fallen_acacia_tree_feature`
  was a no-op against a feature that does not exist, which is why acacia was never the problem and
  the forests kept their logs.
- Terrain that already generated is cleaned by the scrubber. A permutation-filtered native fill
  matches a log on its side and clears it to air, while a vertical log — which the axis alone cannot
  tell apart from terrain — is left standing. Presence is probed per band first, so a chunk with only
  upright logs pays one scan and no write.

### Plants and flowers

Post-Beta plants were surviving a full scrub pass, and this release is why they no longer do.

- The scrubber kept two replacement tables: a bulk table reached by group-testing its types, and a
  fine table reached only through the fine pass's reverse-allowlist volume query. That query does not
  reliably hand these blocks back, so anything listed only in the fine table — the modern flowers,
  leaf litter, vines and the tall plants above — could sit through a complete sweep untouched. Both
  tables are now merged into the single probe list that drives the filtered native fill, which is the
  path that actually reaches them. On a type named in both tables the first entry wins, so nothing is
  filled twice.
- The full modern flower palette is enumerated — lilac, peony, rose bush, sunflower, cornflower,
  lily of the valley, azure bluet, oxeye daisy, allium, blue orchid, pitcher plant, torchflower and
  hanging roots — and the tall ones are masked in the resource pack so an unscrubbed chunk shows
  nothing rather than a see-through hole.

### Item drops

The log-drop stacking bug is fixed, and it was a coordination problem rather than a duplicate one.

- A chopped log's drop was left as `minecraft:oak_log` on the ground, while the inventory sweeper
  retyped the item to `bh:oak_log` only once it was picked up. The second log therefore found no
  stack to merge into — the first one was already the custom id — and a player collected a hotbar of
  singles. Drop rewrites now resolve through the same placer table the sweeper uses and spawn the
  item as its final `bh:` identifier, so the ground item and the inventory item are identical and the
  engine merges them natively.

## 5.0 — 2026-10-01

First, an apology for the wait. This release took much longer to reach you than we intended. Partway
through development the drive this project lives on failed, and progress was lost with it. Most of the
tree was recovered, but not all of it, and some files came back corrupted and had to be rebuilt from
the copies and the salvage that survived. That is where the delay went. Everything described below is
finished, tested, and in your hands now.

5.0 is the largest terrain release we have shipped. The chunk scrubber was rewritten from the ground
up, which means a chunk now costs a fraction of the work it used to, and the terrain a fresh world
generates is closer to Beta 1.7.3 than anything we have released before. It is also a broad bug-fix
release: chests place and pair correctly, the underwater tint finally covers the screen, and the
Nether, the biomes, the flowers and the world floor all land where they should. This is a milestone
we are proud of, and it came out of the worst development setback this project has had.

### Terrain performance

The chunk scrubber is where this release earns its name. It now asks the engine for what is actually
there instead of walking every block in script.

- A scrub pass asks the engine for the blocks in a chunk band that are *not* authentic Beta blocks,
  filtered by an inverse allowlist, so the script only ever sees the handful of blocks that need
  work instead of reading all 32,768 of them. Most chunks have almost nothing to report.
- The ~70 replacement types are located by group-testing the table: a probe answers "is any of these
  types in this band", so an empty range prunes its entire subtree in one native scan. Probing the
  entries one at a time was the single largest cost in the script tick, and nearly every one of those
  scans returned nothing.
- Conversions go through the native block API (`Dimension.fillBlocks`) rather than the `fill`
  command — no command parsing, no 32,768-block cap, and only for a type that is genuinely present.
  A chunk that used to cost tens of thousands of script calls now costs a couple of dozen engine
  calls.
- Bands are sized so one volume query stays at 32,768 blocks, which bounds a single native scan and
  gives the job a useful place to yield.
- A cleaned chunk is re-verified on a long timer rather than re-scanned continuously. The old
  cadence re-walked the same nine chunks around a standing player ten times a minute, forever, which
  is what the profiler showed dominating the server tick. The rescan still exists for terrain that
  arrives *after* the first visit — a late structure, another addon writing into a chunk — but it is
  no longer a background cost.
- A chunk whose band could not be read (unloaded mid-sweep) or whose fill the engine refused is left
  unmarked and retried, so a failed pass can never be mistaken for a clean one.
- The inventory sweep stopped reading all 36 slots of every player on every tick. The engine already
  announces inventory changes, so the sweep rides that signal with a slower equipment sweep and a
  full sweep behind it as safety nets. Between this and the scrubber, the tick budget came back.

### Terrain accuracy

The Overworld now surfaces only the biomes Beta 1.7.3 actually generated. Every Bedrock Overworld
biome is overridden with a Beta definition, so no modern biome palette survives into new terrain.

- Beta defined ten Overworld biomes, but only five ever generated: Forest, Plains, Desert, Taiga and
  Swampland. The Adventure Update's changelog records that Rain Forest, Seasonal Forest, Shrubland,
  Savanna, Tundra and Ice Desert "did not generate in previous versions", and Sky was unreachable.
  Snow therefore only ever appeared as Taiga, and the modern climate map hands out far more cold
  zones than Beta had biomes; only the taiga ids keep their snow, while the frozen peaks and ice
  plains that land in the same zones render as the temperate forest or plains their terrain
  resembles. The engine, not the pack, decides where those zones sit, so this changes how they look
  rather than how often they occur.
- Oceans, beaches and rivers were terrain features in Beta rather than biomes, so they get
  era-correct surfaces: seabeds are dirt and gravel instead of sand and clay, beaches are sand or
  gravel, and cave walls are plain stone.
- Post-Beta biomes fold onto the biome whose climate they resemble. Jungles and mushroom islands
  become Forest, savannas become Plains, terracotta badlands collapse to sand and sandstone, and
  the frozen highlands — ice mountains, frozen and jagged peaks, snowy slopes and groves — become
  Forest or Plains, so a cold zone is no longer another snowy spruce forest. The sea never froze in
  Beta, so frozen oceans and rivers render as ordinary water instead of an endless ice sheet.
- Biome tags are reset to the Beta set, so vanilla feature rules keyed to `bamboo`, `cherry_grove`,
  `bee_habitat`, `mesa`, `lush_caves` and friends no longer fire.
- Every biome is emitted at format version 1.26.0 and omits `minecraft:village_type`, which is what
  actually stops villages generating — below that version the engine falls back to legacy biome-id
  placement and the missing component does nothing.
- The table lives in `scripts/lib/betaBiomes.mjs`; `node scripts/generate-biomes.mjs` emits the JSON
  and a smoke test fails if the two ever drift apart.

### Flowers

Beta 1.7.3 grew exactly two flowers, the red poppy and the yellow dandelion. New terrain now does too.

- The Overworld flower scatters — overworld, plains, swamp and the flower-forest and meadow variants
  for when those tags return — are overridden to place the Beta flower feature instead of the
  modern `legacy:` pickers, so the scatters' density and spread are unchanged while their palette is.
- `minecraft:flower_feature` is a 50/50 pick between poppy and dandelion, and the red and yellow
  flower features that feed it place those blocks directly. All three only attach to grass, which is
  what keeps the scatter from salting flowers into deserts and beaches.
- The engine bakes the modern double-height flowers — lilac, peony, rose bush and sunflower — into
  its own `minecraft:double_plant_feature` aggregate, behind a feature pass the flower scatters
  never reach, so overriding the scatters alone still left lilacs growing. That aggregate is now
  shipped as an inert no-op, which is what actually stops them generating rather than relying on
  the scrubber to catch them afterwards.
- Every remaining post-Beta flower is still swept by the chunk scrubber, but with generation now
  producing only poppies and dandelions the scrub pass has nothing to undo.

### Structures

Beta 1.7.3 built exactly one structure, the dungeon. Villages are gone; the rest of the modern
structure roster cannot be removed at generation, which is a Bedrock engine limit, not an oversight.

- Emptied vanilla structure sets were tried and abandoned. The engine registers its structure sets
  before packs load and rejects any pack that redefines one (`Structure set 'minecraft:trial_chambers'
  has already been registered`), so an overridden set is silently ignored and removes nothing.
- Strongholds, mineshafts, temples, witch huts, ocean monuments, ruined portals, igloos, Nether
  fortresses and the like are placed by engine code that a behavior pack cannot reach. Only the
  tag-driven jigsaw structures (trail_ruins, abandoned_camp) are suppressed, because the Beta biomes
  omit the `has_structure_*` tags those filter on.
- Because generation cannot be blocked for those, the chunk scrubber is what erases them after the
  fact. It clears their post-Beta shell — Nether brick, Nether wart, crying obsidian, magma, stone
  bricks — but a ruined portal's obsidian frame, lava and gold blocks are all Beta-legal, so they
  are intentionally left standing rather than treated as structure debris.
- Dungeons stay: `minecraft:monster_room` is a feature rather than a structure, which is why Beta's
  one real structure survives the sweep.

### Nether

The Nether is now claimed the same way the Overworld is: one override per vanilla biome identifier,
rather than a single custom biome that asked the engine to replace the others.

- `minecraft:replace_biomes` is still experimental and rejects `minecraft:nether` outright, so the
  Nether failed to load at all. It is gone. Every Nether biome — `hell` (the original identifier),
  `soulsand_valley`, `crimson_forest`, `warped_forest` and `basalt_deltas` — is overridden directly
  with a netherrack-and-lava surface, scattered soul sand and gravel, and lava-shore gravel beaches,
  so the whole dimension reads as Beta's single Hell biome with no experiment required.
- Only the classic Ghast and Zombie Pigman spawn tags survive; the enderman, piglin and magma cube
  tags are dropped. The Nether contract test now asserts the five overrides instead of the old
  replacement rule.
- Magma is drawn by the engine rather than the biome, so it survived the override as the rim of every
  lava sea. It is now converted to gravel rather than erased, which is what stops the coastline from
  being punched full of holes.
- Beta's Nether held no ores, but vanilla still hangs quartz, gold and ancient debris off the
  `nether` biome tag this single Hell biome carries, so they dissolve back into netherrack.
- `npm run wipe-nether` purges already-generated Nether chunks from a live world's LevelDB, keyed by
  the dimension baked into each chunk key. It downloads, filters and uploads a stopped server's
  database with a backup copy, and refuses to run without `--yes` or `--dry-run`.

### Deep world

Beta's Overworld was 128 blocks tall, with a jagged bedrock floor at Y=0 and nothing beneath it.
The world now ends at Y=0 the same way.

- An addon cannot shorten the Overworld, so a rough bedrock floor is laid at Y=0 instead. Only the
  floor is written — the sub-zero column is left as native terrain, since survival players cannot
  break through bedrock and never see it. It is folded into the scrub pass that already runs there
  and goes through the native block API rather than the `fill` command — no new tick job and no
  per-column script work, which would be 16k calls and a watchdog kill.
- The floor is uneven at block resolution: a deterministic heightmap merged into horizontal runs, so
  mining stops at a different height column to column the way Beta's floor did.
- The deepslate layer, deep dark, negative-Y caverns and aquifers all stay below the floor, hidden
  behind the unbreakable bedrock cap. The fine scrub pass no longer walks the sub-zero column, and
  breaking a block below Y=0 in the Overworld is vetoed as a guard against opening the void.
- Bedrock left above the floor ceiling (Y=3) by a floor written under the old math is repaired back
  to air. The pass is gated on a native presence probe, so a chunk with nothing above the ceiling
  never pays for a write.
- The floor is sealed a chunk out from the player in every direction, nearest chunk first. A pass
  claims a chunk before sweeping it and releases the claim when the sweep finishes, so a sweep that
  spans ticks no longer has the next pass re-seal the same chunk while the rest of the ring starves.

### Chests

Chest placement is fixed, and it is one of the headline bug fixes in this release.

- `bh:chest` now carries a `cardinal_direction` state, so a placed chest's latch turns to face
  whoever placed it instead of always pointing the same way.
- Because the multi-block's axis is a block state rather than a hard-coded "east", two chests pair
  north-to-south as readily as east-to-west. Two chests placed beside a latch form a pair whose
  latch keeps facing the player who placed the second one; two chests placed end to end, with no
  latch on a long face, still pair on the readable side rather than silently staying single.
- Pairing moved off the same-tick placement event onto a one-tick delay, so the newly placed chest
  has a block entity before its contents are read. That timing is the root of chests that merged with
  the wrong contents, or refused to merge at all.
- If a pair cannot be assembled, both singles are restored with the exact latch they were placed
  with, and their stacks go back into the chests — or onto the ground at the block — rather than
  being lost. Merged stacks are still only ever moved, never copied.

### Underwater tint

The water overlay is fixed, and it is the second headline bug fix.

- The tint finally fills the whole screen. It used to draw as a small box: the image lived on a HUD
  panel that declares no size, so its "100%" resolved against nothing and fell back to the texture's
  native 32×32. It now hangs off the panel the screen itself sizes, and zooms to fill it — the frame
  oversizes the window and `keep_ratio` scales the texture uniformly — so the tint covers every edge
  without the stretch of `keep_ratio` off.
- Leaving the water no longer depends on another system overwriting the same channel by accident.
  `setTitle("")` stops the title drawing but leaves the old marker in the binding, so the tint only
  cleared when the armor readout happened to overwrite it. It now pushes a hidden marker of its own,
  which updates the binding without ever reaching the player's screen.
- The tint rides the title string rather than the actionbar, because the engine keeps the last
  actionbar in its factory binding after the fade. The head is checked every tick, so neither edge of
  a dive lags, and the tint ignores lava — Beta only tinted for water.

### Something in the fog

We are not going to explain this one. A new and very rare encounter now lives in the Overworld: a
figure that appears at the edge of your vision, off to one side, and is gone by the time you look
straight at it. It drops nothing, it is nobody's achievement, and you may not see it at all in your
first hours of play. It is there because it should be. There is an operator command for the
impatient, and a note in the code for anyone who goes looking.

### Other fixes

- Masked blocks. Post-Beta full blocks with no Beta counterpart — beacon, conduit, stonecutter,
  calibrated sculk sensor and friends — used to be hidden by the resource pack, which punched a
  see-through hole through the terrain until a script got around to them. They now render as the
  Beta block they will become, and the fine pass falls back to a real block instead of air when a
  bulk fill could not run, so a chunk that has not been scrubbed yet never shows a hole.
- The block atlas registers every Beta shortname the pack's own blocks use, which fixes a
  resolution collision where two entries borrowed the same vanilla texture path; pointing `magma` at
  the gravel texture is how gravel inherited the animated tone-map art sitting at that path.
- The swamp the engine actually uses (`swamp`) now gets Beta's translucent water, not just
  `swampland`, and the Nether's biomes share a dense hell fog instead of the overworld water fog.
- The skeleton's attack animation actually plays. The controller referenced an animation named
  `default`, which does not exist, so skeletons swung nothing.
- The wooden slab recipe no longer carries the `crafting_table` tag alongside `beta_crafting`, so it
  is offered only where Beta's crafting rules allow.
- The inventory screen regained the controller auto-place and coalesce bindings, and the chat screen
  now assigns input focus when it opens, so touch platforms no longer need a tap before typing.
- Deleted superseded files: the old single-file Nether biome overrides, the unused structure-set
  stubs and the dead `netherSpawnProtection`/`ruinedPortalScrubber` modules.

## 4.3 — 2026-09-28

### Chests

Chests are real Beta 1.7.3 chests again, and two side by side are one 54-slot chest.

- `bh:chest` is a full-cube block whose inventory lives on the block entity, so interacting with it
  opens 27 slots natively — no script and no container entity are involved. It is immovable by
  pistons, chopped with an axe, and drops itself.
- Placing two chests side by side assembles `bh:double_chest`, a two-block multi-block that holds 54
  slots, each half wearing the left or right face of a single chest.
- Bedrock gives every part of a multi-block its own block entity and offers no stable API to open one
  part's container from another, so the pair keeps exactly one half as the items' home and moves the
  stacks into whichever half a player opens, draining them back once the pair goes idle. Stacks are
  only ever moved, never copied, so an interrupted session — a crash, a broken chest, an explosion —
  cannot duplicate or double-drop them.
- A second player opening the other half is turned away with "This chest is in use" rather than shown
  an empty container; a second viewer of the same half simply joins it. Offline viewers are swept
  every 10 ticks so a dropped connection cannot park the pair's contents.
- Breaking the pair hands back two chests, and the crafting recipe now yields `bh:chest` itself. The
  chest minecart recipe consumes `bh:chest`, so a chest that survived the inventory sweep can still
  become a chest minecart.

### Other changes

- Stairs, slabs and logs are promoted from items to real blocks: oak and cobblestone stairs, wooden,
  cobblestone, sandstone and stone slabs, and oak, birch and spruce logs all ship as block JSON with
  a shared stair model. The structure-based placer and its `.mcstructure` files are gone.
- The chunk scrubber now removes any non-Beta vanilla block instead of only converting the ids it
  already knows, so modern blocks no longer survive in generated chunks. Bedrock's single
  `minecraft:planks` block is retyped to oak rather than scrubbed.
- Post-Beta natural spawners are suppressed with unreachable `the_void` biome filters, and the spawn
  contract test now covers the full suppression list.

## 4.2 — 2026-09-27

Every destructive policy — inventory removal, item and block conversion, entity drop rewriting,
spawn-time culling and radius cleanup — now runs behind a vanilla-only check, so only `minecraft:`
identifiers can be renamed or removed. Content from other addons is left exactly as its author
shipped it. The resource pack dropped a dead `blocks/` tree and 12 unreferenced music tracks, taking
the pack from 42.9 MB to 1.3 MB with no in-game change. Deploying became a single command that
builds, uploads over SFTP and reconciles each server world's pack versions and experiment flags.

## 4.1 — 2026-09-26

Biome overrides gained the `minecraft:tags` the 4.0 set was missing, restoring mob spawning, and
spawn rules now reference `minecraft:grass` rather than a non-existent block. Stair, log and slab
placement moved off the global interact listener onto per-item components, cobblestone stairs became
a real Beta block, and armor regained durability and damage typing. Block normalization became
heuristic, resolving any wood stairs to oak and stripped logs to Beta logs.

Also in this release:

- Fixed authentic Beta 1.7.3 apple drops from trees.
- Fixed instant inventory and equipment clearing when `builder_exempt` is removed.

## 4.0 — 2026-09-24

Engine rewrite for Beta 1.7.3 parity on Bedrock 1.26.51+: the event bus and tick scheduler replace
per-subsystem listeners, and the compatibility, normalizer and permission layers are consolidated
into the core runtime.
