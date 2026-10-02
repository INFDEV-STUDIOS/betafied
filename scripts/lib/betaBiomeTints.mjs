/**
 * Canonical Beta 1.7.3 grass and foliage tints, and the resource-pack client biome definitions that
 * carry them.
 *
 * Beta never stored a tint per biome: the client computed it from the block's climate through a
 * 256x256 colormap (`ColorizerGrass` / `ColorizerFoliage`). To recover one colour per biome,
 * `scripts/derive-biome-colors.mjs` walks Beta's whole (temperature, rainfall) plane, classifies
 * each point with Beta's own `BiomeGenBase.getBiome`, samples the colorizer and averages the points
 * that land in each biome. Each value below is therefore the colour a player saw on an average
 * grass block of that biome, not a swatch picked at a single climate point.
 *
 * Source colormaps: b1.7.3 `misc/grasscolor.png` (25237 bytes) and `misc/foliagecolor.png` (17693
 * bytes), both 256x256 RGBA. They are Mojang assets, so they are not committed; re-run the
 * derivation if the source is ever replaced. The five land profiles are the five biomes that
 * generated in Beta — every terrain profile (ocean, river, beach, gravel shore, cave) falls back to
 * the climate-plane average, since Beta gave those no tint of their own.
 */
import { biomeIdentifier } from "./betaBiomes.mjs";

export const CLIENT_BIOME_FORMAT_VERSION = "1.26.0";

/** The average Beta grass and foliage colour over the whole climate plane, used by terrain profiles. */
export const BETA_NEUTRAL_TINT = Object.freeze({ betaBiome: null, grass: "#89BA6F", foliage: "#6CA84B", sky: "#7BA5FF" });

/**
 * Profile name -> the Beta biome that profile stands for, with its derived tints.
 *
 * `sky` is the mean of `BiomeGenBase.getSkyColorByTemp` over the same climate-plane points, so it
 * shares the grass/foliage methodology: Beta's sky shifted with the temperature under the player
 * rather than being one constant, and these are the values a biome's own climate produced.
 */
export const BETA_PROFILE_TINTS = Object.freeze({
    forest: Object.freeze({ betaBiome: "forest", grass: "#79C153", foliage: "#58B029", sky: "#79A7FF" }),
    plains: Object.freeze({ betaBiome: "plains", grass: "#97BE4B", foliage: "#7DAD1E", sky: "#77A9FF" }),
    desert: Object.freeze({ betaBiome: "desert", grass: "#B1B953", foliage: "#9EA728", sky: "#77A9FF" }),
    taiga: Object.freeze({ betaBiome: "taiga", grass: "#86B978", foliage: "#68A756", sky: "#7CA4FF" }),
    swampland: Object.freeze({ betaBiome: "swampland", grass: "#78BF60", foliage: "#56AE38", sky: "#7AA6FF" })
});

export function resolveBiomeTint(profileName) {
    return BETA_PROFILE_TINTS[profileName] ?? BETA_NEUTRAL_TINT;
}

/**
 * A fixed `#rrggbb` rather than a `{ color_map: ... }` reference: a colour map would sample the
 * colormap again with the biome's *Bedrock* temperature and downfall, which are on a different scale
 * than Beta's climate plane. Pinning the derived colour keeps the render deterministic.
 */
export function buildClientBiome(shortId, profileName) {
    const tint = resolveBiomeTint(profileName);

    return {
        format_version: CLIENT_BIOME_FORMAT_VERSION,
        "minecraft:client_biome": {
            description: { identifier: biomeIdentifier(shortId) },
            components: {
                "minecraft:grass_appearance": { color: tint.grass },
                "minecraft:foliage_appearance": { color: tint.foliage },
                // Beta's sky varied with the climate temperature, which the biome table already
                // hands Bedrock; pinning the derived literals keeps the render off Bedrock's own
                // sky blend, which runs on a different temperature scale.
                "minecraft:sky_color": { sky_color: tint.sky }
            }
        }
    };
}
