Continue Headroom toward v1.0 using the roadmap in CLAUDE.md.

1. Read CLAUDE.md. Find the first unticked item that is not blocked on a STOP.
2. Implement it with tests where the engine is involved. Run `npm test` and, for app changes, `scripts/build-app.sh --run`.
3. Commit with a plain message as Kugen Segaran (no AI credit, no co-author lines), push to origin, and tick the box in CLAUDE.md in the same commit.
4. Repeat until you hit something that needs Kugen. For each STOP, add it to a "Waiting on Kugen" section at the top of CLAUDE.md with the exact steps he must take, then keep going with items that don't depend on it.
5. Never ask for passwords, API secrets or payment details in chat. Tell Kugen which command to run in his own Terminal instead.
6. When nothing unblocked is left, give a short summary: what shipped, what is waiting on Kugen, anything you are unsure about.
