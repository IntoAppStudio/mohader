import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "light" | "dark" | "system";

type Ctx = { mode: ThemeMode; resolved: "light" | "dark"; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<Ctx | null>(null);
const STORAGE_KEY = "mahader.theme";

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Light is the default so the app never flashes from light to dark on load.
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === "light" || stored === "dark" || stored === "system") setModeState(stored);
  }, []);


  useEffect(() => {
    const apply = () => {
      const next = mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode;
      setResolved(next);
      document.documentElement.classList.toggle("dark", next === "dark");
    };
    apply();
    if (mode !== "system") return undefined;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    window.localStorage.setItem(STORAGE_KEY, m);
  }, []);

  const value = useMemo<Ctx>(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
