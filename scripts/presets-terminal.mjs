// OpenChamber 2.8.0 terminalTheme.ts inks. The Bun sheet verifies this
// mapping against convertThemeToXterm; Node can audit it without upstream.
// ANSI black is the muted backplate itself, not independent printable ink.
export function terminalInks({ surface, syntax: { base }, status }) {
  return [
    ['foreground white', base.foreground ?? surface.foreground],
    ['red brightRed', status.error],
    ['green brightGreen', status.success],
    ['yellow brightYellow', status.warning],
    ['blue brightBlue', base.function],
    ['magenta brightMagenta', base.keyword],
    ['cyan brightCyan', base.type],
    ['brightWhite', surface.elevatedForeground ?? surface.foreground],
    ['brightBlack', base.comment, 4],
  ].flatMap(([names, ink, floor = 4.5]) =>
    names.split(' ').map((name) => ({ name, ink, floor })));
}
