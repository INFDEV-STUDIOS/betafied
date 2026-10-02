/**
 * Beta 1.7.3 World Constants
 *
 * The dimension identifiers and the world's vertical bounds are facts more than one subsystem has to
 * agree on: the scrubber seals a floor the build-height veto also guards, the Nether ice rule and the
 * End exclusion both test a dimension by name, and the furnace minecart enumerates the dimensions it
 * will run in. Keeping them here is what stops a second literal `"minecraft:overworld"` from being the
 * one the other module forgets to update.
 */

// `Dimension.id` is the `minecraft:`-prefixed identifier, and every rule that tests a dimension
// compares against these. Bedrock's Nether is `minecraft:nether` — Java's `minecraft:the_nether` is
// not the same string and matches nothing here.
// `world.getDimension` is documented against the short keys ("overworld", "nether", "the_end"), so
// the lookup keys are kept alongside the identifiers rather than reusing them.
export const OVERWORLD_ID = "minecraft:overworld";
export const NETHER_ID = "minecraft:nether";
export const END_ID = "minecraft:the_end";
export const OVERWORLD_KEY = "overworld";
export const NETHER_KEY = "nether";
export const END_KEY = "the_end";

/** Beta 1.7.3's world ended at bedrock on Y=0. */
export const BETA_FLOOR_Y = 0;

/** Beta 1.7.3's build ceiling. */
export const BETA_HEIGHT_LIMIT = 128;
