import { apiOf, hasTag } from "./minecraftApi.mjs";

/**
 * The generated API docs hide pre-release surface inside a `=minecraft-bedrock-experimental` moniker, and
 * the typings carry the same fact as a `@beta` JSDoc tag on the member. That tag is what this rule reads,
 * so a member is flagged by what the pinned typings say about it rather than by a name list maintained
 * here by hand.
 *
 * Why it is worth linting: a `@beta` member exists only while the manifest asks for the beta module id.
 * The code around it looks exactly like stable code, so the failure is silent and late — the call is
 * simply absent, or behaves unlike the docs, once the module id is pinned to a stable version or the
 * engine moves on. Beta API is allowed in this project; what is not allowed is *not knowing* you just
 * committed to a pre-release guarantee. The warnings are the inventory of that commitment.
 */
function nameOf(node) {
    if (node.type === "Identifier") return node.name;
    return node.property?.name ?? "member";
}

export default {
    meta: {
        type: "problem",
        docs: {
            description: "Flag pre-release (@beta) Minecraft Script API surface"
        },
        schema: [],
        messages: {
            betaApi:
                "'{{name}}' is pre-release (@beta) Script API: it exists only while the manifest pins the beta module id and carries no stability guarantee. Prefer a stable member that does the same job, or comment why this one is needed."
        }
    },
    create(context) {
        const api = apiOf(context);
        if (api === undefined) return {};

        function report(node, tags) {
            if (node === undefined || node.type !== "Identifier") return;
            if (!hasTag(tags, "beta")) return;

            context.report({ node, messageId: "betaApi", data: { name: nameOf(node) } });
        }

        function check(node) {
            report(node, api.tagsOf(node));
        }

        return {
            // ESTree spells `block.isSolid` a MemberExpression; typescript-eslint inherited that name.
            MemberExpression(node) {
                if (!node.computed) check(node.property);
            },
            // `const { isSolid } = block` reaches the same member without a property access.
            Property(node) {
                if (node.parent?.type === "ObjectPattern") report(node.key, api.tagsOfPatternKey(node.key));
                else check(node.key);
            },
            TSTypeReference(node) {
                check(node.typeName);
            },
            ImportSpecifier(node) {
                check(node.imported);
            }
        };
    }
};
