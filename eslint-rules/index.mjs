import noBetaApi from "./no-beta-api.mjs";
import noLiveReferenceCache from "./no-live-reference-cache.mjs";
import requireJsExtension from "./require-js-extension.mjs";

/**
 * Betafied's own lint rules. They live here rather than inline in `eslint.config.mjs` so the configs stay
 * readable and a rule can be read on its own — each one carries the reason it exists, because a rule
 * whose justification is not written down is a rule somebody deletes.
 */
export default {
    rules: {
        "no-beta-api": noBetaApi,
        "no-live-reference-cache": noLiveReferenceCache,
        "require-js-extension": requireJsExtension
    }
};
