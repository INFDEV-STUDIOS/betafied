import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    CLEAR_SENTINEL,
    UNDERWATER_SENTINEL
} from "../../packs/BP/scripts/world/underwaterOverlay.js";

const root = process.cwd();
const HUD_SCREEN_PATH = "packs/RP/ui/hud_screen.json";

function readHudScreen(): any {
    const raw = readFileSync(resolve(root, HUD_SCREEN_PATH), "utf-8");
    const withoutComments = raw
        .split(/\r?\n/)
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");

    return JSON.parse(withoutComments);
}

describe("Beta Water Screen Tint - resource pack contract", () => {
    const hud = readHudScreen();

    it("keys the tint gate off the title string the script sends", () => {
        // The title binding is global, so the tint reads it directly instead of riding a factory
        // child. That is what lets "titleraw @s clear" take the tint down in a single message.
        const tint = hud.underwater_tint;
        assert.equal(tint.type, "image");
        assert.equal(
            tint.bindings[0].binding_name,
            "#hud_title_text_string",
            "the tint must read the engine's global title binding"
        );
        assert.equal(tint.bindings[0].binding_name_override, "#tint_text");
        assert.equal(
            tint.bindings[1].source_property_name,
            `(#tint_text = '${UNDERWATER_SENTINEL}')`,
            "the tint must only draw for the sentinel the script sends"
        );
        assert.equal(tint.bindings[1].target_property_name, "#visible");
    });

    it("mounts the tint on the screen content panel, not the unsized root panel", () => {
        // root_panel declares no size in vanilla, so a "100%" image laid out as one of its children
        // resolves against nothing and falls back to the texture's native 32x32.
        const onContent = (hud.hud_content?.modifications ?? []).some((modification: any) =>
            modification.value.some((control: any) => "underwater_tint@hud.underwater_tint" in control)
        );
        assert.ok(onContent, "an unmounted tint would leave the sentinel with nothing to show");

        const onRoot = (hud.root_panel?.modifications ?? []).some((modification: any) =>
            modification.value.some((control: any) => "underwater_tint@hud.underwater_tint" in control)
        );
        assert.equal(onRoot, false, "root_panel has no size for a percentage to resolve against");

        assert.equal(
            hud.underwater_overlay,
            undefined,
            "the actionbar factory workaround is dead once the tint reads the title binding"
        );
        assert.equal(hud.underwater_overlay_factory, undefined);
    });

    it("leaves the engine actionbar element alone", () => {
        // Repainting hud_actionbar_text itself is what stretched the tint over every actionbar
        // message, so the pack must not touch it now that it no longer needs the channel.
        assert.equal(hud.hud_actionbar_text, undefined);
    });

    it("hides every pack sentinel from the player's screen", () => {
        // The armor icons share this channel, so both sentinels have to stay invisible.
        const condition = hud["hud_title_text/title_frame"].bindings[1].source_property_name;
        assert.ok(
            condition.includes(`'${UNDERWATER_SENTINEL}'`),
            "the tint sentinel must not be rendered as a title"
        );
        assert.ok(condition.includes("'_a'"), "the armor sentinel must stay hidden too");
    });

    it("zooms the tint to cover the screen instead of stretching it", () => {
        const tint = hud.underwater_tint;
        assert.equal(tint.texture, "textures/ui/underwater");
        assert.equal(tint.keep_ratio, true, "keep_ratio off would stretch the texture");
        assert.equal(tint.anchor_from, "center");
        assert.equal(tint.anchor_to, "center");

        // keep_ratio fits the draw inside the control and centers it, so the control has to oversize
        // the window for that uniform draw to still reach every edge. Anything at/under 100% would
        // letterbox and leave the screen uncovered.
        for (const edge of tint.size) {
            assert.equal(typeof edge, "string");
            assert.ok(Number(edge.replace("%", "")) > 100,
                "an oversized frame is what turns keep_ratio's fit into a cover");
        }
        assert.ok(tint.layer >= 100, "the tint must draw above the engine's own overlays");

        const texturePath = tint.texture.replace("textures/", "packs/RP/textures/") + ".png";
        assert.ok(existsSync(resolve(root, texturePath)), `missing texture ${texturePath}`);
    });

    it("clears the tint with a real, hidden title string rather than an empty one", () => {
        // An empty title stops drawing but leaves #hud_title_text_string holding the old sentinel,
        // which is what kept the tint on screen until some other title overwrote the channel.
        assert.notEqual(CLEAR_SENTINEL, "");
        assert.equal(CLEAR_SENTINEL.slice(0, 2), UNDERWATER_SENTINEL.slice(0, 2),
            "the clear sentinel must share the hidden prefix so the title frame never shows it");
        assert.notEqual(CLEAR_SENTINEL, UNDERWATER_SENTINEL,
            "the clear sentinel must not match the tint gate");
    });

    it("leaves the engine vignette enabled so damage and void still read", () => {
        assert.notEqual(
            hud.vignette_renderer?.ignored,
            true,
            "ignoring vignette_renderer disables the engine's own underwater, hurt and void overlays"
        );
    });
});
