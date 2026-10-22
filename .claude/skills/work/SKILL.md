---
name: work
description: Drive a goal through the whole task lifecycle — branch, grilling, spec, tickets, implementer subagents over the ticket graph, code review, guided manual checks, then PR, Greptile, merge and post-merge checks on production. Resumes from wherever the repo and GitHub say the work stands.
disable-model-invocation: true
---

Drive `$ARGUMENTS` (a goal, a spec issue number, or nothing to resume the current branch) from an idea to squash-merged, cleaned up and checked on production. Talk to the user in their language; everything written to the repo and to GitHub is English.

Two steps are **hand steps** only the user can fire: `/to-spec` and `/to-tickets`. At each one, name the skill to run and end the turn. When the user has run it in this conversation, pick the lifecycle back up from the next step on your own; `/work` again is only needed in a fresh session, and then step 1 finds where the work stands.

Project facts come from the repo, never from this file: the gate and its commands from `CLAUDE.md` / `AGENTS.md`, the issue tracker's conventions (labels, sub-issues, blocking edges, the frontier, closing a ticket, work found along the way) from `docs/agents/issue-tracker.md`, the branch convention from existing branch names.

## 1. Locate the step

Read the current branch, `git status --porcelain`, `git log <default>..HEAD --oneline`, the branch's PR (`gh pr view --json number,state`), and the tracker: open issues labelled `spec`, and for the spec in play its sub-issues with their state, labels and open blockers. The **spec in play** is the one `$ARGUMENTS` names, else the one a PR body or a closed ticket's `Done in … on <branch>` comment ties to this branch, else the only open spec; several candidates: ask which.

Take the first row that holds:

| Work state                                                                 | Go to |
| -------------------------------------------------------------------------- | ----- |
| On the default branch, the spec's PR merged, `ready-for-human` sub-issues open | ship, step 8 |
| On the default branch                                                      | 2     |
| The branch has an open PR                                                  | ship, step 5 |
| Commits ahead of the default branch, no spec in play, no goal given        | ship, step 1 |
| No spec for this goal                                                      | 3     |
| Spec, no sub-issues                                                        | 4     |
| Glossary or ADR changes uncommitted                                        | 5     |
| Any sub-issue open and `ready-for-agent`                                   | 6     |
| Only `ready-for-human` sub-issues open, or none                            | 7     |

"ship, step N" means: read [ship.md](ship.md) and start at its step N.

## 2. Branch

Name it the way this repo names branches (`git branch -a`, `CLAUDE.md`); no convention visible: `feat/<kebab-slug-of-the-goal>`. `git switch -c <branch>` from the default branch. Done when `git branch --show-current` prints it. Continue to 3.

## 3. Grilling

Invoke `mattpocock-skills:grilling` and `mattpocock-skills:domain-modeling` with the goal (that pair is `/grill-with-docs`, which the model cannot invoke by name). Done when the frontier of questions is empty and the user has confirmed shared understanding. Then say: run `/to-spec`. Hand step.

## 4. Tickets

`/to-spec` applies `ready-for-agent` to the spec on its own; swap it for `spec` (`gh issue edit <spec> --remove-label ready-for-agent --add-label spec`). Then say: run `/to-tickets #<spec>`. Hand step.

When the tickets exist, check the wiring against the tracker doc: every ticket is a sub-issue of the spec, labelled `ready-for-agent`, with each `## Blocked by` entry present as a native `blocked_by` edge. Wire what is missing. Continue to 5.

## 5. Commit

The grilling may have changed `CONTEXT.md` or ADRs. One `docs:` commit covering them; nothing changed: skip. Done when `git status --porcelain` is empty. Continue to 6.

## 6. Implement the ticket graph

The tickets are a **task graph**, not a list: each declares what blocks it. The **frontier** is the tracker doc's: open `ready-for-agent` sub-issues with no open blocker. Communication with subagents is sparse and by **context pointers** (spec and ticket numbers, `CLAUDE.md`, notes, commits), never by restating them.

Show the frontier with the model chosen per ticket and ask once (AskUserQuestion) before the first dispatch. Then run the loop until no sub-issue is open and `ready-for-agent`:

1. **Explore once, if the tickets need it.** Unfamiliar library or external API: one exploration subagent saves markdown notes in a directory outside the repo that every later subagent is pointed at, so implementers implement.
2. **Model per ticket.** `sonnet` when the ticket is mechanical: one module, no new dependency, prior art in the repo to copy. `opus` otherwise: a new integration, a schema, work that crosses modules.
3. **Dispatch** one implementer subagent per frontier ticket, in the background, each in its own worktree and branch (Agent tool: `model`, `name` = ticket number, `isolation: worktree`). A worktree is born from the default branch with no `node_modules` and no gitignored files, so the prompt opens with three setup steps: `git reset --hard <feature branch>` on the worktree branch, install dependencies, confirm the gitignored env file is present (list it in a root `.worktreeinclude` so the harness copies it; otherwise point at the main checkout's copy). Then the pointers (`gh issue view <spec>`, `gh issue view <ticket>`) plus the working rules: test-first at the spec's seams (`mattpocock-skills:tdd`), typecheck and single test files while working, the full test suite at the end, only the ticket's affected evals (_Running them_ in `docs/agents/evals.md` defines them) run once, a failing eval run again on its own and never the suite, runtime verification of what a person can see the way the project documents it (its verification doc, `CLAUDE.md` / `AGENTS.md`), with its dev server and browser tab stopped and closed afterwards, commit to its branch, no push, no edits to any issue, anything found outside the ticket reported rather than fixed, report what was verified and how, with the evidence (commands and their output, URLs and the text read there) and the list of affected evals it ran and why. When its sandbox refuses a command containing `eval`, it stops, commits and reports which evals to run, and never works around the sandbox.
4. **Merge** each finished worktree branch into the feature branch: `git cherry-pick` of its commits keeps history linear; a merger subagent when it is not trivial; `mattpocock-skills:resolving-merge-conflicts` on conflict. New dependencies in the lockfile mean an install in the main checkout before the gate.
5. **Verify from evidence, not from the report.** Run the gate on HEAD; read the merged diff against every acceptance box of the ticket and against the list of affected evals the implementer reported, and send a list too narrow for the diff back. When the implementer could not run them, run the affected evals yourself, against its worktree. A red gate or a box without evidence: send the gap back to that subagent (SendMessage) and verify again.
6. **Close the ticket** the way the tracker doc says: tick its boxes, close it with the commit. Work a subagent reported outside its ticket becomes an issue per the doc's _Work found along the way_. Recompute the frontier; a newly unblocked ticket dispatches immediately, so the graph runs at maximum concurrency.

A ticket box that needs a deploy (health on a deployed URL, a build log) is verified on the branch's preview deployment: push the branch when the user agrees, wait for the deployment in the background, read it through the project's authenticated path (`vercel curl` behind deployment protection). Production is checked after the merge, in ship's step 8.

Done when no sub-issue is open and `ready-for-agent`, the gate is green on the feature branch, and every implementer worktree and its branch are removed (`git worktree remove`, `git branch -D`). Continue to 7.

## 7. Review

Invoke `mattpocock-skills:code-review` against the default branch. Apply every finding in one implementer subagent, verify the gate, commit. Done when `git status --porcelain` is empty. Continue to 8.

## 8. Guided manual checks

Walk the user through testing the work by hand, **one step per turn**. Never list the whole plan up front.

Before the first step, get the app ready where the user will test it: start the dev servers the steps need, the way the project documents it, unless they are already running, and open the first step's page in the Claude desktop app's built-in browser (`preview_start` with `url`), so every browser step happens there. Stop those servers and close their tabs when the checks are done.

Each turn gives exactly one step: what to do (one command per block, or one action in the app, phone or dashboard) and what the user should see if it works. End the turn and wait.

- The user says it works: give the next step.
- It does not: investigate from evidence (logs, the database, the vendor's API), fix it (an implementer subagent for code, verified by the gate and committed), and give the same step again. Iterate until it works; never skip ahead.

Order the steps from safe and repeatable (local and development) to irreversible (real resources, production). Before any irreversible step, say plainly what cannot be undone. Steps that only make sense on production become post-merge checks (tracker doc: `ready-for-human` sub-issues of the spec), which ship's step 8 runs after the merge is deployed; stop before them.

Done when every pre-merge step has worked and `git status --porcelain` is empty. Continue to 9.

## 9. Ship

Before asking, run the whole suite once on the feature branch's HEAD yourself, the way _Running them_ in `docs/agents/evals.md` says for a push (when to skip it, what to rerun, what counts as green). A failure that repeats is fixed inside the spec before asking; evals that passed on rerun go in the PR's test plan.

Ask the user (AskUserQuestion) whether to ship: push, open the PR and take it through Greptile to a merge. On yes, read [ship.md](ship.md) and start at its step 1.
