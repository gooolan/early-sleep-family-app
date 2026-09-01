type PriceGlyphProps = {
  name: "search";
  className?: string;
};

export function PriceGlyph({ className }: PriceGlyphProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10.8" cy="10.8" r="5.8" />
      <path d="m15.2 15.2 4 4" />
    </svg>
  );
}
