import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LiveUpdatePrompt } from "./LiveUpdatePrompt";
import "./styles.css";
import { initializeLiveUpdates } from "./updater";

initializeLiveUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <LiveUpdatePrompt />
  </StrictMode>,
);
