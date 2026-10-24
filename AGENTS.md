# Repository guidance

- Use the Lucide icon pack used by the shadcnblocks Admin reference for application icons. In Solid 2 apps, use `@lucide/solid`.
- Do not hand-draw icons with inline SVG path data or substitute icons with Unicode glyphs. Add icons from Lucide and keep the app's icon names mapped to Lucide components.
- Sidebar action popovers must render in a viewport-level portal beside the sidebar, not inside or over the sidebar rows. Keep each menu item name and its More options button visible before showing secondary buttons; hide secondary buttons when the row lacks room. Popovers close on outside pointer, Escape, scroll, or viewport resize; outside clicks dismiss the popover and release focus from its controls. Follow [the sidebar action behavior](docs/architecture/sidebar-action-popovers.md).
