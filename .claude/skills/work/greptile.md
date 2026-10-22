# Greptile on GitHub — the calls `/work` makes while shipping

Greptile posts its inline findings as review threads and one summary comment (author `greptile-apps`) that it edits in place. Replace `OWNER`, `REPO`, `N` (PR number) and the thread ids as needed.

## Read open threads and the summary

```bash
gh api graphql -f query='
{
  repository(owner: "OWNER", name: "REPO") {
    pullRequest(number: N) {
      headRefOid
      reviewThreads(first: 50) {
        nodes {
          id isResolved isOutdated path line
          comments(first: 10) { nodes { author { login } body } }
        }
      }
    }
  }
}'
```

Threads with `isResolved: false` are the open findings. `isOutdated: true` means a later push already changed those lines; check the newer code covers the point before resolving.

```bash
gh pr view N --json comments -q '.comments[] | select(.author.login=="greptile-apps") | .body'
```

The summary body carries `Confidence Score: X/5` and a footer `Last reviewed commit: [...](https://github.com/OWNER/REPO/commit/<full sha>)`. That SHA is the freshness gate.

## Reply on a thread, then resolve it

```bash
gh api graphql -f query='
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: "PRRT_...",
    body: "@greptileai Fixed in <sha>: <what changed and why>."
  }) { comment { id } }
}'

gh api graphql -f query='
mutation {
  resolveReviewThread(input: { threadId: "PRRT_..." }) { thread { isResolved } }
}'
```

## Request a fresh review

```bash
gh pr comment N --body "@greptileai please re-review — pushed <sha> addressing <what>."
```

The `Re-trigger Greptile` link in the summary footer redirects to `app.greptile.com/login`; it needs the user's own session, so the comment is the only trigger available to the agent.
