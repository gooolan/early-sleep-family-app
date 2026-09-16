import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LiveUpdatePrompt } from "./LiveUpdatePrompt";
import "./styles.css";
import "./theme.css";
import "./settings.css";
import "./experience.css";
import { preserveLegacyCache } from "./backup";
import { initializeLiveUpdates } from "./updater";

// Rescue the old view before any startup request or live update can replace it.
try { preserveLegacyCache(); } catch { /* Leave the original cache untouched. */ }
initializeLiveUpdates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <LiveUpdatePrompt />
  </StrictMode>,
);
