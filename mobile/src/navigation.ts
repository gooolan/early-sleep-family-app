import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
    window.removeEventListener("popstate", listener);
  };
}

export function useLocation() {
  return useSyncExternalStore(subscribe, () => window.location.hash.slice(1) || "/today");
}

export function navigate(path: string, replace = false) {
  if (window.location.hash === `#${path}`) return;
  const from = replace ? window.history.state?.from : window.location.hash.slice(1) || "/today";
  window.history[replace ? "replaceState" : "pushState"]({ from }, "", `#${path}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  window.scrollTo({ top: 0, behavior: "instant" });
}

export function backTo(path: string) {
  if (window.history.state?.from === path) window.history.back();
  else navigate(path, true);
}
