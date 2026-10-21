import { useState } from "react";

export default function RemoteApp(props: { route: { id: string; path: string } }) {
  const [count, setCount] = useState(0);

  return (
    <section className="remote-surface" data-testid="remote-surface">
      <p>React application page loaded from a separate production build: {props.route.path}</p>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        React remote clicks: {count}
      </button>
    </section>
  );
}
