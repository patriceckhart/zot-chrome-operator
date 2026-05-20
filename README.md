# zot-chrome-operator

Chrome extension + local bridge for chatting with zot from a Chrome side panel and letting [zot](https://www.zot.sh) operate browser tabs through a `browser_action` tool.

## Install

Install directly as a zot extension:

```bash
zot ext install https://github.com/patriceckhart/zot-chrome-operator
```

This does not require any changes to zot. The installed zot extension runs a small setup script that creates a global `zot-chrome` shim at:

```text
~/.local/bin/zot-chrome
```

Make sure `~/.local/bin` is on your `PATH`. For example, add this to your shell profile if needed:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

After installation, `zot-chrome` should be available from any directory:

```bash
zot-chrome status
```

## Load the Chrome extension

Print the unpacked Chrome extension path:

```bash
zot-chrome ext
```

The first run installs npm dependencies and builds the unpacked extension if needed. Then open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the printed `dist` directory.

## Run the bridge

```bash
zot-chrome start
zot-chrome status
zot-chrome logs
zot-chrome stop
```

`zot-chrome start` ensures the Chrome extension is built, then starts the local bridge in the background. The bridge starts `zot rpc --no-session` with the bundled zot extension. The Chrome side panel connects to `ws://localhost:9224` and executes browser actions requested by zot.

Optional environment:

```bash
ZOT_PROVIDER=anthropic ZOT_MODEL=claude-sonnet-4-5 zot-chrome start
PORT=9225 zot-chrome start
```

## Commands

```bash
zot-chrome start    # start the bridge server in the background
zot-chrome stop     # stop the bridge server
zot-chrome status   # check bridge state
zot-chrome logs     # tail bridge logs
zot-chrome ext      # print/build the unpacked Chrome extension path
```

## Browser capabilities

The registered zot tool can:

- list, create, switch, and close tabs
- inspect page context
- navigate
- click
- type into native and rich editors
- select options
- scroll
- extract page text
- wait

No chat session is persisted; the bridge uses zot `--no-session`.

## License

MIT
