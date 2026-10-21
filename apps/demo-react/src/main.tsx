import { mount } from "./mount";

const root = document.getElementById("root");

if (!root) {
  throw new Error("React remote root element was not found.");
}

mount(root);