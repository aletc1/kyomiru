export function Spotlights() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
      <div
        style={{ background: 'radial-gradient(closest-side, hsl(238 74% 65% / 0.42), transparent)' }}
        className="absolute -top-48 -left-40 h-[70vw] w-[70vw] rounded-full blur-3xl animate-spotlight-a motion-reduce:animate-none mix-blend-screen"
      />
      <div
        style={{ background: 'radial-gradient(closest-side, hsl(258 70% 62% / 0.30), transparent)' }}
        className="absolute top-1/3 -right-48 h-[60vw] w-[60vw] rounded-full blur-3xl animate-spotlight-b motion-reduce:animate-none mix-blend-screen"
      />
      <div
        style={{ background: 'radial-gradient(closest-side, hsl(220 80% 55% / 0.22), transparent)' }}
        className="absolute bottom-0 left-1/4 h-[55vw] w-[55vw] rounded-full blur-3xl animate-spotlight-c motion-reduce:animate-none mix-blend-screen"
      />
    </div>
  )
}
