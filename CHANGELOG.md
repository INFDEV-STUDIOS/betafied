# Changelog

Notable changes in each Betafied release. Version numbers match the behavior and resource pack manifests.

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
