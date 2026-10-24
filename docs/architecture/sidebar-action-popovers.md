# Sidebar action popovers

The workspace sidebar's More options button opens a menu beside the sidebar.
Render the menu in a portal attached to the document body so the sidebar's
layout, scrolling, and stacking contexts cannot clip it or place it over menu
labels. Anchor it to the sidebar's outside edge and align its top with the
trigger where possible. Keep the menu within the viewport vertically, with its
own scroll area when the action list is taller than the available space.

Sidebar rows keep the item name and More options button visible first. Show
secondary inline actions such as Add, Edit, visibility, and Delete only when
the row has room for them. When space is tight, hide those secondary controls
instead of hiding the item name or its options trigger. Align the options
trigger at the far right of the row.

The menu is a transient layer. Dismiss it when the user:

- clicks or taps anywhere outside the trigger and menu;
- presses Escape;
- scrolls the page or sidebar; or
- resizes the viewport.

An outside pointer press must also release focus from a menu control. Let the
clicked control receive focus normally. Escape closes the menu and returns focus
to its trigger. Activating an action closes the menu before navigating or
changing workspace configuration.

Use Lucide icons from the shell's icon map for menu actions. Keep the trigger's
expanded state and menu relationship exposed to assistive technology.

## Button bindings

Each menu item can store a `buttonActions` binding for Edit, visibility,
Delete, Add, and move controls in workspace configuration. A binding targets
either a registered client action (`type: "client"`, `clientId`, and
`actionId`) or a registered component (`type: "component"` and
`componentId`). Resolve these IDs through the shell/admin registries; never
load executable code directly from workspace configuration.

The default Edit binding opens the menu item editor component. It receives
the selected entry and opens the matching group or entry modal. Other default
bindings invoke the workspace menu client actions. Unknown IDs should report a
clear unavailable-handler message and must not silently run a different
action.
