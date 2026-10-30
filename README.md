# Flexible Vector Map Card for Home Assistant

A dynamic, resizable custom map card for Home Assistant built for modern dashboard layouts. It features smart entity auto-discovery, clutter-free UI controls, flexible sizing options, and custom hold actions.

---

## Features

* **Smart Auto-Fill (`add_all_entities`):** Automatically detects and plots all entities with location attributes (`latitude` and `longitude`). Like native Home Assistant maps, it automatically filters out individual device trackers that are already assigned to a `person` entity to prevent duplicate markers.
* **Registry-Aware:** Automatically respects entities hidden in the Home Assistant entity registry.
* **UI Clean-up:** Built-in toggles to strip away unwanted clutter, letting you hide native zoom controls and orientation/recenter buttons.
* **Hold Actions:** Configure custom long-press behavior (with haptic vibration feedback) supporting `more-info`, `toggle`, `navigate`, `url`, or custom service calls (`perform-action`).
* **Visual Customization:** Adjust map styles (`default`, `colorful`, `natural`, `muted`, `gray`, `toner`), theme modes (`auto`, `light`, `dark`), clustering, history path trails, and scale rulers.
* **Fully Responsive:** Adapts seamlessly to grid layouts, sections views, and custom card sizes with automatic resizing observers.
* **Native Visual Editor:** Configurable directly through the Home Assistant UI editor using standard form elements.

---

## Installation

### Manual Installation
1. Download the `flexible-map-card.js` file.
2. Place it in your Home Assistant `www` directory (e.g., `/config/www/flexible-map-card.js`).
3. Add the resource reference to your dashboards or `ui-lovelace.yaml`:
   ```yaml
   resources:
     - url: /local/flexible-map-card.js
       type: module
   ```

### HACS Installation (Custom Repository)
1. Open HACS in your Home Assistant instance.
2. Go to **Frontends**.
3. Click the three dots in the top right corner and select **Custom repositories**.
4. Add your repository URL, select **Lovelace** as the category, and click **Add**.
5. Install **Flexible Vector Map Card**.

---

## Configuration Options

| Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `type` | string | **Required** | `custom:flexible-map-card` |
| `title` | string | `null` | Optional card header title. |
| `entities` | list | `[]` | List of specific entity IDs to display on the map. |
| `add_all_entities` | boolean | `false` | Automatically include all entities with location data (excluding person-bound device trackers and hidden entities). |
| `card_height` | integer | `250` | Height of the map card in pixels. |
| `full_width` | boolean | `true` | Whether the card stretches to fill the container width. |
| `card_width` | integer | `400` | Fixed width in pixels (only applies when `full_width` is disabled). |
| `default_zoom` | integer | `14` | Initial map zoom level (1–20). |
| `hours_to_show` | integer | `0` | Number of hours of historical tracking paths to display. |
| `theme_mode` | string | `auto` | Color theme mode: `auto`, `light`, or `dark`. |
| `map_style` | string | `default` | Map style: `default`, `colorful`, `natural`, `muted`, `gray`, or `toner`. |
| `auto_fit` | boolean | `false` | Automatically center and zoom the map to fit all visible markers. |
| `fit_zones` | boolean | `false` | Include zones when auto-fitting bounds. |
| `show_zone_radius` | boolean | `false` | Display the radius circle around zones. |
| `scale_ruler` | boolean | `false` | Show map scale bar. |
| `cluster` | boolean | `true` | Group nearby markers into clusters. |
| `hide_zoom_controls` | boolean | `false` | Hide the map zoom buttons (+/-). |
| `hide_orient_buttons` | boolean | `false` | Hide orientation, compass, and recenter buttons. |
| `hold_action` | object | `none` | Action to run on a long-press (supports `more-info`, `toggle`, `navigate`, `url`, `perform-action`). |

---

## Example YAML Configuration

```yaml
type: custom:flexible-map-card
title: Family & Home Map
add_all_entities: true
card_height: 350
default_zoom: 15
map_style: muted
cluster: true
hide_zoom_controls: true
hide_orient_buttons: true
entities:
  - person.jon
  - person.mj
hold_action:
  action: more-info
```
