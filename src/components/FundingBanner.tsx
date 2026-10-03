import { useEffect, useState } from "react";
import { X, Rocket } from "lucide-react";

const DISMISS_KEY = "lemtik_funding_banner_dismissed_v1";

export function FundingBanner() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (sessionStorage.getItem(DISMISS_KEY)) {
      setVisible(false);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setVisible(false);
  }

  return (
    <div className="relative z-[60] flex items-center justify-center gap-2 bg-primary px-4 py-2 text-center text-xs font-medium text-primary-foreground sm:text-sm">
      <Rocket className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">We're raising our pre-seed round to fund our first pilot.</span>
      <a
        href="mailto:amisuhikmot@gmail.com?subject=Lemtik%20Security%20—%20Investor%20Interest"
        className="shrink-0 underline underline-offset-2 hover:no-underline"
      >
        Get in touch
      </a>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 opacity-80 hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
