import ts from "typescript";

/**
 * Shared plumbing for the rules that answer questions about the Minecraft Script API.
 *
 * The facts these rules need — the stability moniker a member carries, which class a type name resolves
 * to — live in the pinned `@minecraft/server` typings, and the type checker is the only thing that knows
 * what a given `foo.bar` or `Entity` actually refers to (`Block.isSolid` and an unrelated
 * `Widget.isSolid` have to be told apart, and our own `BlockCache` is not the engine's `Block`). Reading
 * the answers off resolved symbols is therefore better than any list of names kept in sync by hand.
 *
 * Symbols are resolved through the parser's own `getSymbolAtLocation`, not the raw TypeScript checker:
 * lint nodes and TypeScript nodes are different trees, and only the parser services know how to cross.
 */

/** Declarations are only trusted when they come out of a Minecraft typings package, not our own API. */
const MINECRAFT_TYPINGS = /[\\/]@minecraft[\\/][^\\/]+[\\/]/;

function declaredInMinecraftTypings(symbol) {
    const declaration = symbol.declarations?.[0];
    return declaration !== undefined && MINECRAFT_TYPINGS.test(declaration.getSourceFile().fileName);
}

/**
 * Type-aware rules need the parser's program; a file outside the tsconfig project has none, and a rule
 * that throws over that would turn a missing program into a lint crash rather than a silent pass.
 */
export function apiOf(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode?.();
    const services = sourceCode?.parserServices ?? context.parserServices;
    if (services?.program === undefined || typeof services.getSymbolAtLocation !== "function") return undefined;

    const checker = services.program.getTypeChecker();

    // An import alias carries its own (empty) JSDoc, so the tags have to come off the target symbol.
    // `getAliasedSymbol` asserts on a non-alias, so the flag test is the guard, not a nicety.
    function resolveAlias(symbol) {
        if (symbol === undefined) return undefined;
        return symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    }

    function resolve(node) {
        return resolveAlias(services.getSymbolAtLocation(node));
    }

    function tagsOfSymbol(symbol) {
        if (symbol === undefined || !declaredInMinecraftTypings(symbol)) return undefined;

        const tags = symbol.getJsDocTags();
        return tags.length === 0 ? undefined : tags.map((tag) => tag.name);
    }

    return {
        /** The JSDoc tag names on whatever this node resolves to, or `undefined` when it resolves to nothing. */
        tagsOf(node) {
            return tagsOfSymbol(resolve(node));
        },

        /**
         * The same question for a destructuring key. `const { isSolid } = block` binds a *local* symbol at
         * that key, so asking for the symbol there answers about the binding, not about the member being
         * read; the member has to be looked up on the type of the pattern instead.
         */
        tagsOfPatternKey(keyNode) {
            if (keyNode.type !== "Identifier" || typeof services.getTypeAtLocation !== "function") {
                return undefined;
            }

            const pattern = keyNode.parent?.parent;
            if (pattern === undefined) return undefined;

            const type = services.getTypeAtLocation(pattern);
            return tagsOfSymbol(resolveAlias(type.getProperty?.(keyNode.name)));
        },

        /** The name of the Minecraft class or interface a type name points at, or `undefined`. */
        minecraftTypeName(node) {
            const symbol = resolve(node);
            if (symbol === undefined || !declaredInMinecraftTypings(symbol)) return undefined;
            return symbol.getName();
        }
    };
}

export function hasTag(tags, name) {
    return tags !== undefined && tags.includes(name);
}
