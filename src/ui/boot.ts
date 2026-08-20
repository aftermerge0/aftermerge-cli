import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createElement } from "react";

import { AFTERMERGE_COLORS } from "@/lib/terminal-themes/aftermerge";
import { AppRuntime } from "@/runtime";
import { App } from "@/ui/app";
import { parseRoute } from "@/ui/route";

export { parseRoute, type ParsedRoute, type ViewId } from "@/ui/route";

export async function bootTui(argv: string[]): Promise<void> {
  const initialRoute = parseRoute(argv);
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    backgroundColor: AFTERMERGE_COLORS.bg,
    useMouse: false,
  });

  const root = createRoot(renderer);

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
      try {
        root.unmount();
        await AppRuntime.dispose();
      } finally {
        renderer.destroy();
        process.exit(0);
      }
    })();
  };

  renderer.keyInput.on("keypress", (key) => {
    if (key.ctrl && key.name === "c") {
      shutdown();
    }
  });

  root.render(createElement(App, { initialRoute, onQuit: shutdown }));
}
