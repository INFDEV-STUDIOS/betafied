import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { system } from "@minecraft/server";
import { evaluateHopConditions, doHop } from "../../packs/BP/scripts/mobs/betaAnimalAI.js";

describe("Beta Animal AI - Authentic Beta Mobs", () => {
    it("detects obstacle ahead and triggers hop condition", () => {
        const fakeEntity = {
            id: "cow_1",
            typeId: "minecraft:cow",
            isValid: true,
            location: { x: 10.5, y: 64, z: 10.5 },
            getViewDirection() {
                return { x: 1, y: 0, z: 0 };
            }
        };

        const fakeDimension = {
            getBlock(loc: { x: number; y: number; z: number }) {
                // If checking current position, air
                if (loc.x === 10) {
                    return { isSolid: false, isLiquid: false, typeId: "minecraft:air" };
                }
                // If checking obstacle ahead (x = 11)
                return { isSolid: true, isLiquid: false, typeId: "minecraft:stone" };
            },
            getEntities() {
                return [];
            }
        };

        // Run multiple times to verify obstacle hop triggers with high probability
        let triggered = false;
        for (let i = 0; i < 10; i++) {
            if (evaluateHopConditions(fakeEntity as any, fakeDimension as any)) {
                triggered = true;
                break;
            }
        }

        assert.equal(triggered, true, "Facing a solid block obstacle should trigger hop evaluation");
    });

    it("triggers hop condition when in water", () => {
        const fakeEntity = {
            id: "pig_1",
            typeId: "minecraft:pig",
            isValid: true,
            location: { x: 5, y: 60, z: 5 },
            getViewDirection() {
                return { x: 0, y: 0, z: 1 };
            }
        };

        const waterDimension = {
            getBlock() {
                return { isSolid: false, isLiquid: true, typeId: "minecraft:water" };
            },
            getEntities() {
                return [];
            }
        };

        let triggered = false;
        for (let i = 0; i < 10; i++) {
            if (evaluateHopConditions(fakeEntity as any, waterDimension as any)) {
                triggered = true;
                break;
            }
        }

        assert.equal(triggered, true, "Being in water should trigger surface bob hop");
    });

    it("triggers hop condition when crowded by other passive mobs in a pen", () => {
        const fakeEntity = {
            id: "sheep_1",
            typeId: "minecraft:sheep",
            isValid: true,
            location: { x: 20, y: 64, z: 20 },
            getViewDirection() {
                return { x: 0, y: 0, z: 0 };
            }
        };

        const penDimension = {
            getBlock() {
                return { isSolid: false, isLiquid: false, typeId: "minecraft:air" };
            },
            getEntities() {
                return [
                    fakeEntity,
                    { id: "sheep_2", typeId: "minecraft:sheep", isValid: true },
                    { id: "cow_2", typeId: "minecraft:cow", isValid: true }
                ];
            }
        };

        let triggered = false;
        for (let i = 0; i < 10; i++) {
            if (evaluateHopConditions(fakeEntity as any, penDimension as any)) {
                triggered = true;
                break;
            }
        }

        assert.equal(triggered, true, "Crowded pen with other passive mobs should trigger hop condition");
    });

    it("applies upward and forward impulse when doHop is executed", () => {
        let appliedImpulse: { x: number; y: number; z: number } | null = null;

        const fakeMob = {
            id: "cow_test",
            typeId: "minecraft:cow",
            isValid: true,
            getVelocity() {
                return { x: 0, y: -0.078, z: 0 };
            },
            getViewDirection() {
                return { x: 0.8, y: 0, z: 0.6 };
            },
            applyImpulse(vec: { x: number; y: number; z: number }) {
                appliedImpulse = vec;
            }
        };

        doHop(fakeMob as any);

        // doHop runs first hop immediately or via runTimeout
        // Execute scheduled timeouts
        const timeouts = (system as any).scheduledTimeouts;
        if (timeouts && timeouts.length > 0) {
            const copy = [...timeouts];
            for (const t of copy) {
                t.callback();
            }
        }

        assert.ok(appliedImpulse !== null, "Impulse should be applied to mob");
        assert.ok((appliedImpulse as any).y > 0.35, "Vertical impulse should hop mob off the ground");
        assert.ok((appliedImpulse as any).x > 0, "Forward impulse should propel mob in view direction X");
        assert.ok((appliedImpulse as any).z > 0, "Forward impulse should propel mob in view direction Z");
    });

    it("skips mobs that are already in mid-air or falling", () => {
        let appliedImpulse = false;

        const fallingMob = {
            id: "cow_falling",
            typeId: "minecraft:cow",
            isValid: true,
            getVelocity() {
                return { x: 0, y: -0.5, z: 0 }; // Falling fast
            },
            getViewDirection() {
                return { x: 1, y: 0, z: 0 };
            },
            applyImpulse() {
                appliedImpulse = true;
            }
        };

        doHop(fallingMob as any);

        const timeouts = (system as any).scheduledTimeouts;
        if (timeouts && timeouts.length > 0) {
            for (const t of [...timeouts]) {
                t.callback();
            }
        }

        assert.equal(appliedImpulse, false, "Falling mob should not receive hop impulse");
    });
});
