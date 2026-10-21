import { render } from "@solidjs/web";
import App from "./App";
import "./shell-layout.css";
import "virtual:uno.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Shell root element was not found.");
}

render(() => <App />, root);
