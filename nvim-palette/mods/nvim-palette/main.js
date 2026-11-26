import { View, div } from "gpui-kit";
import { appHome, checking, readTextFile, theme, writeTextFile } from "herdr";

export default class NvimPalette extends View {
  render(cx) {
    if (checking()) return div().w(0).h(0);

    const t = theme();
    // Match Herdr's terminal renderer, which uses RGB even for RGBA overrides.
    const rgb = (color) => color?.slice(0, 7);
    const palette = JSON.stringify({
      fg: rgb(t.terminal_foreground),
      bg: rgb(t.background),
      cursor: rgb(t.cursor),
      ansi: Array.from({ length: 16 }, (_, i) => rgb(t["ansi" + i])),
    });
    if (palette !== this.palette) {
      this.palette = palette;
      if (!this.saving) {
        this.saving = true;
        cx.spawn(async () => {
          try {
            const path = appHome() + "/nvim-palette.json";
            let saved = await readTextFile(path);
            while (saved !== this.palette) {
              const next = this.palette;
              await writeTextFile(path, next, saved);
              saved = next;
            }
          } catch (error) {
            this.palette = undefined;
            console.error("nvim-palette: " + error);
          } finally {
            this.saving = false;
          }
        });
      }
    }
    return div().w(0).h(0);
  }
}
