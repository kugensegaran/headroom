Build and run the MCP Meter Mac app, then fix anything that breaks.

1. Run `npm test`. If anything fails, fix the engine first.
2. Run `cd mac && swift build 2>&1 | tail -50`. Fix every compile error and warning in `mac/Sources`, rebuilding until clean. Keep fixes minimal and in the existing style.
3. Run `scripts/build-app.sh --run` to assemble and open `build/MCP Meter.app`.
4. Confirm the menu bar item appears and the popover shows data from `http://127.0.0.1:7777/api/summary`. If the engine is not reachable, check `node` is found and the engine files were copied into the app bundle.
5. Report what you changed and anything still wrong, in a short list.
