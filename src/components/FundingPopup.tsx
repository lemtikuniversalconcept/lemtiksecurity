import { useEffect, useState } from "react";
import { Rocket } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

const SEEN_KEY = "lemtik_funding_popup_seen_v1";

export function FundingPopup() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem(SEEN_KEY)) return;
    const timer = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem(SEEN_KEY, "1");
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <div className="grid h-10 w-10 place-items-center rounded-md bg-primary/15 border border-primary/40">
            <Rocket className="h-5 w-5 text-primary" />
          </div>
          <DialogTitle className="mt-3">We're raising our pre-seed round</DialogTitle>
          <DialogDescription>
            Lemtik is pre-revenue and onboarding pilot partners — estates, hotels, and institutions
            in Lagos replacing WhatsApp-group security operations with a real command and control
            platform. We're raising $100k to fund our first pilot. If you're an investor, operator,
            or just curious how it works, we'd welcome the conversation.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm hover:bg-surface-2">
            Maybe later
          </DialogClose>
          <a
            href="mailto:amisuhikmot@gmail.com?subject=Lemtik%20Security%20—%20Investor%20Interest"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Get in touch
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
