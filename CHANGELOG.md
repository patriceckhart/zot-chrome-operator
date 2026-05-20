# Changelog

## 0.1.0

- Initial zot Chrome Operator implementation.
- Chrome side-panel UI adapted from the zot VS Code extension.
- Local `zot-chrome` CLI for `start`, `stop`, `status`, `logs`, and `ext`.
- Bridge runs `zot rpc --no-session` with a zot extension that registers `browser_action`.
- Browser operation support via content scripts and Chrome tab APIs.
