import type { JSX } from "@solidjs/web";
import { cva } from "class-variance-authority";

const badgeVariants = cva("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-secondary text-secondary-foreground",
      outline: "text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge(props: JSX.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "secondary" | "outline" }) {
  return <span {...props} class={badgeVariants({ variant: props.variant, className: props.class })} />;
}
