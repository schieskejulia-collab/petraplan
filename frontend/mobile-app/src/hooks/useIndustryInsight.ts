import { useState, useEffect, useRef } from "react";

export interface IndustryInsight {
  detected_industry: string | null;
  industry_label: string | null;
  tools_old: string[];
  tools_modern: string[];
  tools_unknown: string[];
  migration_hints: Record<string, string[]>;
  integrations: string[];
  modern_suggestions: string[];
  automation_suggestions: string[];
}

const EMPTY: IndustryInsight = {
  detected_industry: null,
  industry_label: null,
  tools_old: [],
  tools_modern: [],
  tools_unknown: [],
  migration_hints: {},
  integrations: [],
  modern_suggestions: [],
  automation_suggestions: [],
};

export function useIndustryInsight(
  industry: string,
  tools: string[],
  extraText: string,
  debounceMs = 600,
) {
  const [insight, setInsight] = useState<IndustryInsight | null>(null);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const corpus = [industry, tools.join(" "), extraText].filter(Boolean).join(" ");

  useEffect(() => {
    if (corpus.trim().length < 3) {
      setInsight(null);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/industry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: corpus, tools }),
        });
        if (res.ok) {
          const data = await res.json();
          setInsight({ ...EMPTY, ...data });
        } else {
          setInsight(EMPTY);
        }
      } catch {
        setInsight(null);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [corpus]);

  return { insight, loading };
}