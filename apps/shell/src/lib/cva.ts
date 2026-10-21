import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export { cva };
export const cx = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(...inputs));
