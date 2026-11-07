import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Sparkles, type LucideIcon } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import type { FileRoutesByTo } from "@/routeTree.gen";

export type AppPath = keyof FileRoutesByTo;
export type PaletteGroup = { label: string; items: { to: AppPath; label: string; icon: LucideIcon }[] };

export function useCommandPaletteShortcut(setOpen: (fn: (open: boolean) => boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
  groups,
  canAsk,
  placeholder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: PaletteGroup[];
  canAsk: boolean;
  placeholder: string;
}) {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const question = text.trim();

  useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const go = (to: AppPath) => {
    onOpenChange(false);
    navigate({ to });
  };

  const ask = () => {
    if (!question) return;
    onOpenChange(false);
    navigate({ to: "/app", search: { ask: question } });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput value={text} onValueChange={setText} placeholder={placeholder} />
      <CommandList>
        <CommandEmpty>No matching page.</CommandEmpty>
        {canAsk && question ? (
          <CommandGroup heading="Ask Lemtik" forceMount>
            <CommandItem value="__ask__" forceMount onSelect={ask}>
              <Sparkles className="text-ai" />
              <span className="trunc">Ask “{question}”</span>
            </CommandItem>
          </CommandGroup>
        ) : null}
        {groups.map((group) => (
          <CommandGroup key={group.label} heading={group.label}>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <CommandItem key={item.to} value={`${item.label} ${group.label}`} onSelect={() => go(item.to)}>
                  <Icon />
                  {item.label}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
