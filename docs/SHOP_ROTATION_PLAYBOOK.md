# Shop Rotation Playbook

## Purpose
This playbook is the project reference for planning and managing:

- Featured Rotations
- Limited / Rotation-Only cosmetics
- Featured drops
- announcement coordination

The goal is to make future shop rotations repeatable and safe without relying on memory.

Future implementation prompts should review this playbook before changing shop rotation or limited cosmetic behavior.

## Core Rule
Final rotation choices are manual business/design decisions.

- AI may suggest rotations
- Codex only implements approved rules
- Do not automate cosmetic removal from availability without explicit approval
- rotation affects **Store visibility only**
- owned cosmetics must remain visible and equippable forever

## What Featured Rotation Means
Featured Rotation is a Store presentation layer.

It means:
- a server-side config chooses a themed set of cosmetics
- those cosmetics appear in the Store's Featured panel
- they still use normal Store card behavior
- the full Store below can continue working normally

Featured Rotation does **not** automatically mean:
- discount
- bundle buying
- hidden-from-store behavior
- ownership changes
- reward changes

## What Limited / Rotation-Only Means
Limited / Rotation-Only cosmetics are cosmetics that are not meant to stay always available in the Store.

The intended future behavior is:
- hidden from the Store by default
- temporarily allowed by an active shop rotation
- visible again in the Store only while approved by that rotation

Important:
- this affects Store visibility only
- it must not remove ownership
- it must not unequip items
- it must not remove items from the owned Cosmetics screen
- it must not break profile display or equipped cosmetics

## Currently Approved Rotation-Only Items
The current approved `rotationOnly` list is:

- `avatar_voidbound_entity`
- `void_card_back`
- `void_altar_background`
- `avatar_inferno_crown_f`
- `avatar_inferno_crown_m`
- `fire_variant_crownfire`
- `lava_throne_background`
- `avatar_golden_menace`
- `avatar_astral_archon`
- `bg_celestial_observatory`
- `elemental_chest_cardback`

Changes to this list should remain manual business/design decisions.

## Difference Between Collection, Featured Rotation, Limited / Rotation-Only, and Announcement

### Collection
A Collection is a cosmetic grouping label.

Examples:
- Void
- Celestial
- Cutesy
- Founder Pack

Collections help organization and filtering. They do not control availability by themselves.

### Featured Rotation
A Featured Rotation is the active Store spotlight.

It controls:
- which cosmetics are highlighted in the Featured panel
- the rotation title
- the rotation message
- optional time window

It does not automatically mean an item is limited.

### Limited / Rotation-Only
Limited / Rotation-Only is a visibility rule for specific cosmetics.

It means:
- hidden from Store by default
- temporarily allowed only when a rotation explicitly exposes them

This is separate from being merely featured.

### Announcement
An Announcement is a menu communication card.

It tells players:
- what event or rotation is live
- what theme is active
- why they may want to check the Store

Announcements do not control cosmetic availability by themselves.

## What Should Stay Always Available
These are strong default candidates for permanent Store availability:

- Common cosmetics
- most Rare cosmetics
- starter-friendly cheap cosmetics
- Starter Set
- basic cosmetics that help new users buy something early

General philosophy:
- new players should always have affordable options
- the Store should never feel empty or locked behind rotations

## What Can Rotate Sometimes
These are strong candidates for being featured on a schedule:

- Epic cosmetics
- themed collection pieces
- seasonal cosmetics
- cosmetic drops
- event cosmetics

These may remain always available or may later become limited, depending on approved design direction.

## What Should Be Rotation-Only
These are good candidates for future limited visibility:

- selected purchasable Legendary cosmetics
- seasonal or event premium cosmetics
- future premium drops
- special returning cosmetics

Use rotation-only selectively. It should feel intentional, not random.

## What Should Never Rotate or Be Removed
These should remain protected:

- owned player cosmetics
- equipped cosmetics
- Starter Set from player inventory
- Level Rewards
- Achievement Rewards
- Founder Pack unless manually approved
- supporter or founder grants unless manually approved
- internal or legacy `storeHidden` content

Even if Store visibility changes later, owned inventory must remain intact.

## Weekly Featured Rotation Recipe
Recommended weekly mix:

- 1 Legendary
- 1 Epic
- 2-4 themed support items
- 1 matching announcement card

This keeps the panel focused and makes each rotation feel deliberate without overwhelming the Store.

## How to Build a Weekly Rotation
Use this checklist:

1. Choose a theme.
2. Pick one anchor item, usually a Legendary or headline cosmetic.
3. Add one supporting Epic.
4. Add 2-4 matching support pieces.
5. Decide whether any items are just featured, or also temporarily allowed limited items.
6. Write `shop-rotation.json`.
7. Write a matching `announcements.json` entry.
8. Double-check item IDs.
9. Confirm that owned cosmetics are unaffected.
10. Confirm that rotation changes Store visibility only.

## Current Approved Weekly Schedule
The current approved weekly schedule order is:

- `void-week-01`
- `flame-king-weekend-01`
- `lucky-drop-01`
- `celestial-feature-01`
- `frostveil-court-01`
- `goldbound-relics-01`
- `neon-arcana-01`
- `vampire-elegance-01`
- `lycan-power-01`

## How `shop-rotation.json` Works
Path:

```text
<dataDir>/server-data/shop-rotation.json
```

Recommended schema:

```json
{
  "activeRotationId": "void-week-01",
  "title": "Void Week",
  "message": "Void Collection cosmetics are featured this week.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_voidbound_entity",
    "cardback_void_tease",
    "void_card_back",
    "void_altar_background",
    "title_void_doll"
  ],
  "allowLimitedCosmeticIds": [
    "avatar_voidbound_entity",
    "void_card_back",
    "void_altar_background"
  ]
}
```

### Field meanings
- `activeRotationId`: unique ID for the active rotation
- `title`: Featured panel title
- `message`: Featured panel supporting copy
- `startsAt`: optional start time
- `endsAt`: optional end time
- `featuredCosmeticIds`: controls what appears in the Featured panel
- `allowLimitedCosmeticIds`: controls which `rotationOnly` cosmetics are temporarily allowed

### Important notes
- `featuredCosmeticIds` controls Featured panel content
- `allowLimitedCosmeticIds` controls temporary limited-item exposure
- during the current MVP, `allowLimitedCosmeticIds` may match `featuredCosmeticIds` when testing limited items
- if you are only running a normal Featured panel and not enabling limited items, `allowLimitedCosmeticIds` can be empty

## When to Leave `allowLimitedCosmeticIds` Empty
Leave it empty when:

- the rotation is just a spotlight, not a limited-release event
- all featured items are already normally available
- you want Featured presentation without changing availability rules

Example:

```json
{
  "activeRotationId": "starter-friendly-week-01",
  "title": "Starter Friendly Picks",
  "message": "Affordable cosmetics are featured for newer players.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_arcane_gambler",
    "avatar_bubble_brat",
    "avatar_moss_mood",
    "cardback_lucky_you"
  ],
  "allowLimitedCosmeticIds": []
}
```

## How to Coordinate `announcements.json` with `shop-rotation.json`
Use announcements to tell players that a rotation is live.

Simple coordination pattern:

1. Pick a rotation ID and title.
2. Use matching language in the announcement title/message.
3. Align `startsAt` and `endsAt` when needed.
4. Keep the announcement player-facing and short.
5. Keep `shop-rotation.json` operational and `announcements.json` promotional.

Suggested workflow:
- write `shop-rotation.json` first
- confirm the cosmetic IDs
- then write the matching `announcements.json` entry

## Example Rotations

### Example 1: Void Week
`shop-rotation.json`

```json
{
  "activeRotationId": "void-week-01",
  "title": "Void Week",
  "message": "Void Collection cosmetics are featured this week.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_voidbound_entity",
    "cardback_void_tease",
    "void_card_back",
    "void_altar_background",
    "title_void_doll"
  ],
  "allowLimitedCosmeticIds": [
    "avatar_voidbound_entity",
    "cardback_void_tease",
    "void_card_back",
    "void_altar_background",
    "title_void_doll"
  ]
}
```

Matching `announcements.json` entry:

```json
{
  "id": "void-week-01-announcement",
  "title": "Void Week is Live",
  "message": "Void Collection cosmetics are featured in the Store for a limited time.",
  "type": "Event",
  "priority": 20,
  "active": true,
  "dismissible": true,
  "startsAt": null,
  "endsAt": null
}
```

### Example 2: Flame King Weekend
`shop-rotation.json`

```json
{
  "activeRotationId": "flame-king-weekend-01",
  "title": "Flame King Weekend",
  "message": "Rule the arena with Flame King Collection cosmetics.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_inferno_crown_f",
    "avatar_inferno_crown_m",
    "cardback_flame_tyrant",
    "lava_throne_background",
    "fire_variant_crownfire",
    "title_crownless_king"
  ],
  "allowLimitedCosmeticIds": [
    "avatar_inferno_crown_f",
    "avatar_inferno_crown_m",
    "lava_throne_background",
    "fire_variant_crownfire"
  ]
}
```

### Example 3: Lucky Drop
`shop-rotation.json`

```json
{
  "activeRotationId": "lucky-drop-01",
  "title": "Lucky Drop",
  "message": "Lucky Collection cosmetics are featured in the Store.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_arcane_gambler",
    "avatar_mimic_entity",
    "elemental_chest_cardback",
    "cardback_lucky_you"
  ],
  "allowLimitedCosmeticIds": [
    "elemental_chest_cardback"
  ]
}
```

### Example 4: Cutesy Chaos Week
`shop-rotation.json`

```json
{
  "activeRotationId": "cutesy-chaos-week-01",
  "title": "Cutesy Chaos Week",
  "message": "Cute, chaotic, and slightly dangerous cosmetics are featured now.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_bubble_brat",
    "avatar_moss_mood",
    "avatar_neon_puff",
    "avatar_stone_cold_cutie",
    "avatar_storm_brat",
    "outplayed_too_easy_cardback",
    "cry_about_it_cardback",
    "cardback_sweet_but_deadly",
    "title_pretty_problem"
  ],
  "allowLimitedCosmeticIds": [
    "avatar_bubble_brat",
    "avatar_moss_mood",
    "avatar_neon_puff",
    "avatar_stone_cold_cutie",
    "avatar_storm_brat",
    "outplayed_too_easy_cardback",
    "cry_about_it_cardback",
    "cardback_sweet_but_deadly",
    "title_pretty_problem"
  ]
}
```

### Example 5: Celestial Feature
`shop-rotation.json`

```json
{
  "activeRotationId": "celestial-feature-01",
  "title": "Celestial Feature",
  "message": "Celestial Collection cosmetics are featured in the Store.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_riot_halo",
    "avatar_golden_menace",
    "avatar_astral_archon",
    "celestial_void_background",
    "celestial_chamber_background",
    "bg_celestial_observatory",
    "title_divine_menace"
  ],
  "allowLimitedCosmeticIds": [
    "avatar_astral_archon",
    "avatar_golden_menace",
    "bg_celestial_observatory",
  ]
}
```

### Example 6: New Player Friendly Rotation
`shop-rotation.json`

```json
{
  "activeRotationId": "starter-friendly-week-01",
  "title": "Starter Friendly Picks",
  "message": "Affordable cosmetics are featured for newer players.",
  "startsAt": null,
  "endsAt": null,
  "featuredCosmeticIds": [
    "avatar_arcane_gambler",
    "avatar_bubble_brat",
    "avatar_moss_mood",
    "cardback_lucky_you"
  ],
  "allowLimitedCosmeticIds": []
}
```

## Decision Guide
Use this quick guide when deciding how to classify a cosmetic:

- always available:
  - Common
  - most Rare
  - cheap starter-friendly items
- featured sometimes:
  - Epic items
  - themed collection items
  - seasonal drops
- rotation-only:
  - selected purchasable Legendary items
  - special event premium items
  - future premium drops
- never rotate:
  - owned inventory
  - equipped cosmetics
  - Level Rewards
  - Achievement Rewards
  - Founder Pack unless manually approved
  - supporter or founder grants unless manually approved
  - internal or legacy `storeHidden` content

## Approval Rules
Before activating a rotation, confirm:

- the chosen items match the intended theme
- any rotation-only items were manually approved
- owned inventory remains unaffected
- Store visibility is the only thing changing
- the matching announcement is ready

## LATER: Bundles and Discounts
Not part of the current MVP.

Possible future additions:
- collection bundles
- featured bundle pricing
- discounted event packs
- bundle-specific announcements

These should be designed separately from simple Featured Rotation.

## LATER: Admin Dashboard Editing
Not part of the current MVP.

Current expectation:
- manual editing of `shop-rotation.json`
- manual editing of `announcements.json`

Future Admin Dashboard goals could include:
- selecting featured cosmetics
- toggling rotation-only exposure
- scheduling starts and ends
- previewing matching announcements
