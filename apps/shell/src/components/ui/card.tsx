import type { JSX } from "@solidjs/web";

export function Card(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} class={`rounded-xl border border-border bg-card text-foreground shadow-sm ${props.class ?? ""}`} />;
}

export function CardHeader(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} class={`flex flex-col space-y-1.5 p-6 ${props.class ?? ""}`} />;
}

export function CardTitle(props: JSX.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 {...props} class={`text-lg font-semibold leading-none tracking-tight ${props.class ?? ""}`} />;
}

export function CardDescription(props: JSX.HTMLAttributes<HTMLParagraphElement>) {
  return <p {...props} class={`text-sm text-muted-foreground ${props.class ?? ""}`} />;
}

export function CardContent(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} class={`p-6 pt-0 ${props.class ?? ""}`} />;
}

export function CardFooter(props: JSX.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} class={`flex items-center p-6 pt-0 ${props.class ?? ""}`} />;
}
