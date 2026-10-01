# Changelog

Notable changes in each Betafied release. Version numbers match the behavior and resource pack manifests.

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
- Conversions are issued as native `fill` commands, thousands of blocks per command, and only for a
  type that is genuinely present. A chunk that used to cost tens of thousands of script calls now
  costs a couple of dozen engine calls.
- Bands are sized to exactly the engine's fill ceiling, so no band top is ever paid for as slack.
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

- An addon cannot shorten the Overworld, so the sub-zero column is ballasted with stone and capped
  with bedrock instead. It costs about five native `fill` commands per chunk, folded into the scrub
  pass that already runs there — no new tick job and no per-column script work, which would be 16k
  calls and a watchdog kill.
- The bedrock cap is uneven: a deterministic per-chunk pattern stacks a few ragged layers on top of
  the base, so mining stops at a different height column to column the way Beta's floor did.
- The deepslate layer, deep dark, negative-Y caverns and aquifers all end up sealed beneath the cap,
  so the deepslate-to-stone conversions now only matter above the floor. The fine scrub pass no
  longer walks the sub-zero column, and breaking a block below Y=0 in the Overworld is vetoed as a
  guard against opening the void.

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
