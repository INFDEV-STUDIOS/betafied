import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventBus } from "../../packs/BP/scripts/core/eventBus.js";

describe("Central EventBus Architecture", () => {
    it("registers and dispatches event handlers with priority ordering", () => {
        const order: number[] = [];

        const unsub2 = eventBus.onPlayerInteractWithBlock(() => {
            order.push(2);
        }, 10); // Priority 10

        const unsub1 = eventBus.onPlayerInteractWithBlock(() => {
            order.push(1);
        }, 20); // Priority 20 (runs earlier)

        const unsub3 = eventBus.onPlayerInteractWithBlock(() => {
            order.push(3);
        }, 0); // Priority 0 (runs last)

        // Dispatch synthetic event
        eventBus.dispatch("playerInteractWithBlock", {
            cancel: false
        });

        assert.deepEqual(order, [1, 2, 3], "Handlers must execute in descending priority order");

        // Test unsubscription
        unsub1();
        unsub2();
        unsub3();

        order.length = 0;
        eventBus.dispatch("playerInteractWithBlock", { cancel: false });
        assert.deepEqual(order, [], "Unsubscribed handlers must not run");
    });

    it("routes container access events to their subscribers", () => {
        let opened = 0;
        let closed = 0;

        const unsubOpen = eventBus.onBlockContainerOpened(() => {
            opened++;
        });
        const unsubClose = eventBus.onBlockContainerClosed(() => {
            closed++;
        });

        eventBus.dispatch("blockContainerOpened", {});
        eventBus.dispatch("blockContainerClosed", {});

        assert.equal(opened, 1, "blockContainerOpened handlers must receive the open event");
        assert.equal(closed, 1, "blockContainerClosed handlers must receive the close event");

        unsubOpen();
        unsubClose();
    });

    it("isolates errors so a throwing handler does not crash sibling handlers", () => {
        let siblingRan = false;

        const unsubFail = eventBus.onEntitySpawn(() => {
            throw new Error("Simulated handler crash");
        });

        const unsubSuccess = eventBus.onEntitySpawn(() => {
            siblingRan = true;
        });

        assert.doesNotThrow(() => {
            eventBus.dispatch("entitySpawn", { entity: { typeId: "minecraft:zombie" } });
        });

        assert.ok(siblingRan, "Sibling handler must execute despite prior handler failure");

        unsubFail();
        unsubSuccess();
    });

    it("supports beforeEvents short-circuiting when event is cancelled", () => {
        let secondHandlerRan = false;

        const unsubCanceller = eventBus.onPlayerInteractWithBlock((e: any) => {
            e.cancel = true;
        }, 100);

        const unsubSecondary = eventBus.onPlayerInteractWithBlock(() => {
            secondHandlerRan = true;
        }, 10);

        const eventObj = { cancel: false };
        eventBus.dispatch("playerInteractWithBlock", eventObj);

        assert.equal(eventObj.cancel, true);
        assert.equal(secondHandlerRan, false, "Cancelled beforeEvent must short-circuit lower priority handlers");

        unsubCanceller();
        unsubSecondary();
    });
});
