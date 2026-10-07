import { apiOf } from "./minecraftApi.mjs";

/**
 * Engine handles — `Entity`, `Block`, `Player`, `Dimension` — are views onto live objects, not copies.
 * An entity despawns, a chunk unloads, a player leaves, and the handle is left pointing at nothing, so a
 * container that outlives the tick it was written in becomes a source of errors that only appear after
 * minutes of play and never reproduce in a test. `AGENTS.md` states the invariant this enforces: store
 * primitive ids (`entity.id`, `dimension.id`, coordinates) and re-resolve, checking `.isValid()` at use.
 *
 * Only containers declared at module scope, or as fields of a class whose declaration itself lives at
 * module scope, are flagged — this codebase's registries are module-level singletons. A `Map` built and
 * dropped inside one function is a perfectly good way to work through a tick's entities, and flagging
 * those would bury the real case. `BlockPermutation` and `ItemStack` are deliberately not flagged: those
 * are immutable snapshots, and keeping them is correct.
 */
const LIVE_REFERENCE_TYPES = new Set(["Entity", "Player", "Block", "Dimension"]);

const CONTAINER_FACTORIES = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

/** The name a declaration is written under; a class field spells it `key`, a variable `id`. */
function nameOf(node) {
    const identifier = node.type === "VariableDeclarator" ? node.id : node.key;
    return identifier?.type === "Identifier" ? identifier.name : "container";
}

function annotationOf(node) {
    // A variable carries its annotation on the name; ESTree hangs a class field's on the field itself.
    if (node.type === "PropertyDefinition") return node.typeAnnotation?.typeAnnotation;
    return node.id?.typeAnnotation?.typeAnnotation;
}

/** Walks a type annotation for every `X` in `Map<_, X>`, `Set<X>`, `X[]` and `X | undefined`. */
function collectTypeNames(api, typeNode, out) {
    if (typeNode === undefined) return;
    switch (typeNode.type) {
        case "TSTypeReference":
            if (typeNode.typeName.type === "Identifier") {
                const name = api.minecraftTypeName(typeNode.typeName);
                if (name !== undefined && !CONTAINER_FACTORIES.has(typeNode.typeName.name)) out.add(name);
            }
            for (const argument of typeNode.typeArguments?.params ?? []) collectTypeNames(api, argument, out);
            break;
        case "TSArrayType":
            collectTypeNames(api, typeNode.elementType, out);
            break;
        case "TSUnionType":
        case "TSIntersectionType":
            for (const member of typeNode.types) collectTypeNames(api, member, out);
            break;
        case "TSTypeOperator":
            collectTypeNames(api, typeNode.typeAnnotation, out);
            break;
        case "TSParenthesizedType":
            collectTypeNames(api, typeNode.typeAnnotation, out);
            break;
        default:
            break;
    }
}

/**
 * Whether the declaration survives the tick that populated it: it has to reach `Program` without crossing
 * a function body on the way. A class field counts when the class itself is declared at module scope.
 */
function livesForTheProcess(node) {
    let current = node.parent;
    while (current != null) {
        if (current.type === "Program") return true;
        switch (current.type) {
            case "BlockStatement":
            case "FunctionDeclaration":
            case "FunctionExpression":
            case "ArrowFunctionExpression":
            case "MethodDefinition":
            case "StaticBlock":
                return false;
            default:
                break;
        }
        current = current.parent;
    }
    return false;
}

export default {
    meta: {
        type: "problem",
        docs: {
            description: "Disallow long-lived containers holding Entity, Player, Block or Dimension handles"
        },
        schema: [],
        messages: {
            staleReference:
                "'{{name}}' holds {{types}} handles in a container that outlives the tick: the entity or chunk behind a handle can be gone by the time it is read again. Store ids, dimensions and coordinates, and re-resolve with .isValid() at the point of use."
        }
    },
    create(context) {
        const api = apiOf(context);
        if (api === undefined) return {};

        function check(node) {
            if (!livesForTheProcess(node)) return;

            const names = new Set();
            collectTypeNames(api, annotationOf(node), names);

            // `new Map<string, Entity>()` says the same thing without an annotation. ESTree spells a
            // class field's initializer `value` and a variable's `init`.
            const init = node.init ?? node.value;
            for (const argument of init?.typeArguments?.params ?? init?.typeParameters?.params ?? []) {
                collectTypeNames(api, argument, names);
            }

            const live = [...names].filter((name) => LIVE_REFERENCE_TYPES.has(name));
            if (live.length === 0) return;

            context.report({
                node,
                messageId: "staleReference",
                data: { name: nameOf(node), types: live.join(", ") }
            });
        }

        return {
            VariableDeclarator: check,
            PropertyDefinition: check
        };
    }
};
