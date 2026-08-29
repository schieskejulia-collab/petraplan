import type { ReactNode } from "react";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70 bg-background/95">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div>
            <p className="text-sm font-semibold text-primary">PetraPlan · N64</p>
            <p className="text-xs text-muted-foreground">Legacy verstehen, bevor etwas verändert wird.</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
