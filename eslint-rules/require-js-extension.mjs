/**
 * Minecraft's QuickJS ES module loader resolves relative imports literally, so `./foo` never finds
 * `foo.js` the way a bundler or Node would.
 */
export default {
    meta: {
        type: "problem",
        docs: {
            description: "Enforce .js extension on relative imports for Minecraft Bedrock runtime compatibility"
        },
        fixable: "code",
        schema: [],
        messages: {
            missingExtension: "Relative import '{{source}}' must end with '.js' for Minecraft Bedrock runtime compatibility."
        }
    },
    create(context) {
        function checkSource(sourceNode) {
            if (!sourceNode || typeof sourceNode.value !== "string") return;
            const val = sourceNode.value;
            if (val.startsWith("./") || val.startsWith("../")) {
                if (!val.endsWith(".js") && !val.endsWith(".json")) {
                    context.report({
                        node: sourceNode,
                        messageId: "missingExtension",
                        data: { source: val },
                        fix(fixer) {
                            return fixer.replaceText(sourceNode, `"${val}.js"`);
                        }
                    });
                }
            }
        }
        return {
            ImportDeclaration(node) {
                checkSource(node.source);
            },
            ExportNamedDeclaration(node) {
                if (node.source) checkSource(node.source);
            },
            ExportAllDeclaration(node) {
                if (node.source) checkSource(node.source);
            }
        };
    }
};
