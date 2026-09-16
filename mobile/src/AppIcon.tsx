export function AppIcon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    "☾": "M20.5 13.2A8.7 8.7 0 0 1 10.8 3.5 8.8 8.8 0 1 0 20.5 13.2Z",
    "✓": "M8 4H6a2 2 0 0 0-2 2v14h16V6a2 2 0 0 0-2-2h-2M9 3h6v4H9zM8 13l3 3 5-6",
    "⌕": "m4 9 2 11h12l2-11ZM8 9l4-6 4 6M9 13v3m6-3v3M3 9h18",
    "▥": "M4 3v17h17M8 15v-4m5 4V6m5 9V9",
    "⚙": "M4 7h16M4 17h16M9 4v6m6 4v6",
  };
  return <svg className="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths["☾"]} /></svg>;
}
