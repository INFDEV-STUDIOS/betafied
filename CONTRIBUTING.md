# Contributing to Betafied

Thank you for your interest in contributing to **Betafied**!

Betafied is dedicated to recreating authentic **Minecraft Beta 1.7.3** gameplay and mechanics inside modern Minecraft Bedrock Edition (Script API 2.11.0-beta).

Before getting started, please take a few minutes to read through this guide to ensure your contributions align with the project's goals, standards, and architecture.

---

## Table of Contents

- [Core Philosophy: Accuracy Over "Improvement"](#core-philosophy-accuracy-over-improvement)
- [Prerequisites](#prerequisites)
- [Setting Up Your Development Environment](#setting-up-your-development-environment)
- [Available Commands & Workflow](#available-commands--workflow)
- [Codebase Architecture](#codebase-architecture)
- [Bedrock Script API Guidelines](#bedrock-script-api-guidelines)
- [Testing Standards](#testing-standards)
- [Reporting Issues](#reporting-issues)
- [Submitting Pull Requests](#submitting-pull-requests)
- [Getting Help & Community](#getting-help--community)

---

## Core Philosophy: Accuracy Over "Improvement"

The single most important principle in Betafied is **historical accuracy to Minecraft Beta 1.7.3**:

- **Parity is the target**: If Beta 1.7.3 had a quirk, bug, or limitation, we generally want to replicate it faithfully rather than "fixing" or modernizing it.
- **Resist modern conveniences**: A proposed change that makes mechanics smoother, easier, or more aligned with modern Minecraft (post-Beta 1.7.3) is usually out of scope.
- **Reference before guessing**: Always verify historical behavior against real Beta 1.7.3 gameplay or the archived Minecraft Wiki for the era. Consult [BETA_POLICY_GAPS.md](BETA_POLICY_GAPS.md) for known policy edge cases.

---

## Prerequisites

To build, test, and contribute to Betafied, ensure your machine has:

1. **Node.js 24 or newer**: Betafied uses Node's native TypeScript execution (`--experimental-strip-types`) for its offline test runner.
2. **[Regolith](https://bedrock-oss.github.io/regolith/)**: The add-on compiler and build tool. Ensure the `regolith` binary is installed and accessible on your `PATH`.
3. **Minecraft Bedrock Edition (1.26.51 or newer)**: Required for in-game testing of exported packs.
4. **Git**: For version control.

---

## Setting Up Your Development Environment

### 1. Clone the Repository

```bash
git clone https://github.com/retrofit-studios/betafied.git
cd betafied
```

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Install Regolith Filters

Betafied uses Regolith filters (such as `ts_transpiler` and `agents_md_strip`) to process TypeScript and package add-ons:

```bash
npm run install-filters
```

### 4. Configure Your Local Environment (`.env`)

Copy the template environment file:

```bash
cp .env.example .env
```

Open `.env` and specify the path to your Bedrock `com.mojang` directory so `regolith` can export development packs directly into your game:

- **Windows**: Leave empty or omit; Regolith automatically detects the Bedrock UWP folder.
- **macOS (Bedrock Launcher / sideloaded)**: Set to your Bedrock data path (e.g., `~/Library/Application Support/mcpelauncher` or custom path).
- **Linux (Bedrock Launcher)**: Specify the exact path to your `com.mojang` folder.

```env
COM_MOJANG="/path/to/com.mojang"
```

---

## Available Commands & Workflow

Betafied enforces an automated quality gate. Before committing or opening a PR, always run:

```bash
npm run check
```

This runs the typechecker, the linter, and the full offline test suite.

| Command | Purpose |
| --- | --- |
| `npm run check` | **Mandatory gate**: runs `typecheck`, `lint`, and `test` in sequence. |
| `npm test` | Runs the offline test suite using Node 24 native TypeScript runner and `@minecraft/server` mocks. |
| `npm run typecheck` | Validates TypeScript types across the codebase (`tsc --noEmit`). |
| `npm run lint` | Runs ESLint and Bedrock-specific lint rules across `packs/BP/scripts`. |
| `npx eslint packs/BP/scripts --fix` | Automatically fixes autofixable lint findings (like `.js` import extensions). |
| `npm run build` | Compiles behavior and resource packs into your local `development_*_packs` directory via Regolith. |
| `npm run watch` | Starts the Regolith watcher to continuously recompile on file save. |

---

## Codebase Architecture

```
betafied/
├── packs/
│   ├── BP/                     # Behavior Pack source
│   │   ├── manifest.json
│   │   ├── entities/           # Bedrock entity definitions & components
│   │   ├── biomes/             # Beta biome definitions
│   │   ├── loot_tables/        # Era-accurate loot and mob drop tables
│   │   └── scripts/            # TypeScript source code (compiled to JS by Regolith)
│   │       ├── main.ts         # Central entry point (load order is deliberate!)
│   │       ├── core/           # Event bus, tick scheduler, policies, error boundary
│   │       ├── player/         # Food & health, inventory stripping, welcome system
│   │       ├── combat/         # Armor reduction formula, rapid-fire bow
│   │       ├── interactions/   # Furnace minecart, boat collision, bonemeal, chests
│   │       ├── world/          # Chunk scrubber, bedrock floor, void fog, borders
│   │       └── mobs/           # Beta spawn rules, wander AI, nightmare ambushes
│   └── RP/                     # Resource Pack source
│       ├── manifest.json
│       ├── textures/           # Authentic Beta 1.7.3 textures
│       ├── sounds/             # Classic sounds (damage "oof", bow snap, etc.)
│       └── fogs/               # Early Beta atmospheric fog density definitions
├── tests/                      # Automated test suite
│   ├── mocks/                  # In-memory mock engine for @minecraft/server
│   ├── policy/                 # Unit tests for registries, permissions, and conversions
│   ├── smoke/                  # Manifest and entrypoint validation tests
│   └── integration/            # Subsystem integration tests
└── scripts/                    # Build, release, and generator automation
```

> **Note on `main.ts`**: `eventBus` executes registered handlers in descending priority order. Handler registration order in `main.ts` determines which subsystem gets the first chance to inspect or cancel an event.

---

## Bedrock Script API Guidelines

When writing or modifying scripts under `packs/BP/scripts/`:

1. **Mandatory `.js` Extensions**: QuickJS and the Bedrock runtime require explicit `.js` extensions on relative imports (e.g., `import { eventBus } from "../core/eventBus.js";`).
2. **Runtime Constraints**: Code runs inside QuickJS inside Bedrock. There are no browser globals (`window`, `document`) and no Node.js globals (`process`, `fs`).
3. **No Cross-Tick Object Persistence**: Never store live `Entity` or `Block` instances across ticks. References become invalid or stale across tick boundaries. Store dimension names and coordinates/entity IDs instead.
4. **Dimension-Aware Spatial Keys**: When indexing locations in maps or sets, always include the dimension name (e.g., `${dimension.id}:${x},${y},${z}`).
5. **Use Error Boundaries**: Wrap fallible engine interactions in `errorReporter.runCatching()` to prevent unhandled exceptions from tearing down tick runners.
6. **Prefer Native APIs over `runCommand`**: Use the native `@minecraft/server` API wherever possible. Avoid executing slash commands via `dimension.runCommand` for operations with native API equivalents.
7. **Performance & Slice Heavy Work**: Use generator-driven slicing (`system.runJob` or the internal `JobRunner`) for operations iterating over large volumes or inventories.

---

## Testing Standards

Betafied features an offline mock test suite located in `tests/`. This allows full verification of game logic and Script API handlers without having to boot a Minecraft client.

- **Run tests anytime**:
  ```bash
  npm test
  ```
- **Where to add tests**:
  - `tests/policy/`: For pure unit tests checking item conversions, allowlists, or data transforms.
  - `tests/integration/`: For multi-component or event-driven interaction tests.
  - `tests/smoke/`: For verifying manifests, registries, and entry points.
- **Never bypass `npm run check`**: Every pull request must pass the gate cleanly.

---

## Reporting Issues

If you notice a discrepancy where Betafied behaves differently from authentic Minecraft Beta 1.7.3, please open an issue:

1. Search [existing issues](https://github.com/retrofit-studios/betafied/issues) to ensure it hasn't been reported.
2. Provide a clear, descriptive title.
3. Include:
   - **Observed Behavior**: What happens in Betafied right now.
   - **Expected Beta 1.7.3 Behavior**: How it worked in Beta 1.7.3 (with citations to the Minecraft Wiki or gameplay clips if possible).
   - **Minecraft Bedrock Version**: The exact version you are testing on.
   - **Reproduction Steps**: Step-by-step instructions to reproduce the issue.

---

## Submitting Pull Requests

1. **Fork the repository** and create a feature branch off `main`:
   ```bash
   git checkout -b feature/my-beta-fix
   ```
2. **Make your changes** following the codebase style and Script API guidelines.
3. **Add or update tests** covering your new behavior.
4. **Run the mandatory gate**:
   ```bash
   npm run check
   ```
   Ensure typechecking, linting, and all tests pass with zero warnings or errors.
5. **Write clean commit messages**:
   - Describe the "why" behind the change.
   - Do NOT include automated agent trailers (e.g., `Co-Authored-By: ...`).
6. **Open your Pull Request** with a detailed explanation of the fix or feature and how it was verified against Beta 1.7.3.

---

## Getting Help & Community

Have questions about setting up, Bedrock Script API quirks, or Beta 1.7.3 mechanics?

- **Website**: [betafied.net](https://betafied.net)
- **Discord**: [Join our Discord community](https://discord.gg/BxD7jKs2Rb)
- **Issue Tracker**: [GitHub Issues](https://github.com/retrofit-studios/betafied/issues)
