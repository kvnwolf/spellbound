import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    ".agents",
    ".claude/skills",
    // Prose docs (CONTEXT.md, ADRs, agent docs) keep their authored line
    // breaks; the formatter would join glossary entries into single lines.
    "**/*.md",
  ],
});
