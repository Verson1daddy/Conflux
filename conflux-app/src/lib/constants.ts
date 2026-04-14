/**
 * The Enter key character for PTY stdin injection.
 * Windows ConPTY expects "\r" (carriage return), not "\n" (line feed).
 * xterm.js onData() already sends "\r" for Enter; this constant ensures
 * manually constructed injection strings are consistent.
 */
export const PTY_ENTER = "\r";
