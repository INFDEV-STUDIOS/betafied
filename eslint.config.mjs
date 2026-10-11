import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import minecraftLinting from "eslint-plugin-minecraft-linting";
import betafiedBedrockPlugin from "./eslint-rules/index.mjs";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "packs/data/**", "build/**", ".regolith/**", "scripts/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["packs/BP/scripts/**/*.ts"],
    plugins: {
      "minecraft-linting": minecraftLinting,
      betafied: betafiedBedrockPlugin,
    },
    rules: {
      "minecraft-linting/avoid-unnecessary-command": "error",
      "betafied/require-js-extension": "error",
      // Pre-release surface is allowed here, but only knowingly: the rule keeps it from arriving
      // unannounced, because a @beta member looks like any other and disappears with the module id.
      "betafied/no-beta-api": "warn",
      // Stale engine handles are a bug class the runtime cannot report and a test cannot see, so this
      // one fails the build rather than leaving a warning nobody reads.
      "betafied/no-live-reference-cache": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "no-restricted-globals": [
        "error",
        {
          name: "setTimeout",
          message: "Use system.runTimeout() from @minecraft/server instead of setTimeout in Minecraft Bedrock.",
        },
        {
          name: "setInterval",
          message: "Use system.runInterval() from @minecraft/server instead of setInterval in Minecraft Bedrock.",
        },
        {
          name: "clearTimeout",
          message: "Use system.clearRun() from @minecraft/server instead of clearTimeout in Minecraft Bedrock.",
        },
        {
          name: "clearInterval",
          message: "Use system.clearRun() from @minecraft/server instead of clearInterval in Minecraft Bedrock.",
        },
        {
          name: "window",
          message: "Browser globals do not exist in Minecraft Bedrock QuickJS runtime.",
        },
        {
          name: "document",
          message: "Browser globals do not exist in Minecraft Bedrock QuickJS runtime.",
        },
        {
          name: "fetch",
          message: "fetch does not exist in Minecraft Bedrock QuickJS runtime.",
        },
        {
          name: "process",
          message: "Node.js process does not exist in Minecraft Bedrock QuickJS runtime.",
        },
        {
          name: "Buffer",
          message: "Node.js Buffer does not exist in Minecraft Bedrock QuickJS runtime.",
        },
      ],
    },
  },
);
