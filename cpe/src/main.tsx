import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/instrument-sans/wdth.css";
import "./fonts.css";
import "@fontsource/gochi-hand";
import "./tokens.css";
import "./styles.css";
import { App } from "./App.tsx";
import { PlayerProvider } from "./player.tsx";
import { StateProvider } from "./state.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StateProvider>
      <PlayerProvider>
        <App />
      </PlayerProvider>
    </StateProvider>
  </StrictMode>,
);
