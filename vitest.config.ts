import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Agent worktrees are full checkouts of the repo nested inside it.
  test: {
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
