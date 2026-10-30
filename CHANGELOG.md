Changelog
All notable changes to the Flexible Vector Map Card will be documented in this file.
[1.1.0] - 2026-10-29
Added
 * Click-to-Zoom Behavior: Clicking an entity marker on the map now intercepts the default more-info action, preventing the modal dialog from opening and smoothly centering and zooming the map directly onto that entity's coordinates.
 * Smart Device Tracker Filtering: Enhanced the add_all_entities auto-fill logic to automatically scan and exclude individual device trackers bound to a person entity, perfectly mirroring native Home Assistant map behavior and eliminating duplicate markers.
[1.0.0] - Initial Release
Features
 * Dynamic resizable container with automatic ResizeObserver adjustment.
 * Smart auto-discovery toggle (add_all_entities) with entity registry filtering.
 * Built-in UI controls cleanup to hide native zoom and orientation/recenter buttons.
 * Customizable hold actions with haptic vibration feedback.
 * Native Home Assistant visual editor (ha-form) support.
