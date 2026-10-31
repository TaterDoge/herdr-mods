// ctrl+h/j/k/l: move to the pane beside, or hand the key to nvim like a plain
// terminal would. herdr's own pane.go eats the key everywhere; this decides
// per pane, from the program running in it.

import { View, div } from "gpui-kit";
import { focused, hc, nextCommand, panes, run } from "herdr";

// Programs where ctrl+h/j/k/l is their own key: nvim maps it in normal and
// visual mode, and insert mode still needs ctrl+h as a backspace. The key goes
// in, the pane doesn't move.
const OWNS_KEY = new Set(["nvim", "vim", "gvim", "view"]);
const KEY = { left: "ctrl+h", right: "ctrl+l", up: "ctrl+k", down: "ctrl+j" };

export default class SplitsNav extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      for (;;) {
        const direction = await nextCommand();
        const key = KEY[direction];
        if (!key) continue;
        const f = focused();
        const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
        if (!pane?.terminal) continue; // a mod pane takes no keys
        if (OWNS_KEY.has(pane.program.key)) {
          // "machine/t7" works here too: hc keys takes the address as shown.
          await hc(["keys", pane.terminal, key]);
          continue;
        }
        run("pane.go", { direction });
      }
    });
  }

  render() {
    return div().w(0).h(0); // the floating holder draws nothing; it keeps this copy alive
  }
}