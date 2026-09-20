# Customizations API Reference - Commentum v2

Comprehensive technical documentation for the Customizations System in Commentum v2, including the public catalog API, point store unlock system, role-based free bypass, and profile integrations.

---

## 🌐 Base URL
```http
https://anymex.duckdns.org/functions/v1
```

---

## 📑 Table of Contents
1. [Architecture & Linkage](#-architecture--linkage)
2. [Public Catalog API (`GET /customizations`)](#1-public-catalog-api-get-customizations)
3. [Item Types & URL Generation](#2-item-types--url-generation)
   - [Avatar Decorations](#a-avatar-decorations-typedecoration)
   - [Nameplates](#b-nameplates-typenameplate)
   - [Profile Effects](#c-profile-effects-typeeffect)
   - [Profile Frames & Layers](#d-profile-frames-typeframe)
   - [Category Banners](#e-category-banners-typebanner)
4. [Unlocking Items (`POST /users` -> `unlock_customization`)](#3-unlocking-items-post-users)
5. [Equipping Customizations (`POST /users` -> `update_customizations`)](#4-equipping-customizations-post-users)
6. [Leaderboard & Comment Batch RPCs](#5-leaderboard--comment-batch-rpcs)
7. [Caching & Performance](#6-caching--performance)

---

## 🏗 Architecture & Linkage

The customization catalog is completely decoupled from client codebases and stored in Supabase:

```
                          ┌────────────────────────┐
                          │ customizations_catalog │
                          │ (1,703 Discord Assets) │
                          └───────────┬────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
    ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
    │  Comment Threads  │   │    Leaderboard    │   │   User Profile    │
    │  & Batch User RPC │   │  (Rankings & Top) │   │ & Points Store    │
    ├───────────────────┤   ├───────────────────┤   ├───────────────────┤
    │ - Author Avatar   │   │ - Rank #1 - #100  │   │ - Equip / Unequip │
    │   Decoration      │   │ - Avatar Deco     │   │ - Point Unlocks   │
    │ - Custom Nameplate│   │ - Nameplate Theme │   │ - User Inventory  │
    │ - Banner Url      │   │ - Banner Theme    │   │ - Linked Accounts │
    │ - Profile Effect  │   │ - Banner Url      │   │ - Staff Bypass    │
    └───────────────────┘   └───────────────────┘   └───────────────────┘
```

---

## 1. Public Catalog API (`GET /customizations`)

Returns items from `public.customizations_catalog`. This endpoint is **public**, requires **no authentication**, and is edge-cached.

### Query Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :---: | :---: | :---: | :--- |
| `type` | `string` | No | `all` | Filter by type: `decoration`, `nameplate`, `banner`, `effect`, `frame`. |
| `category` | `string` | No | - | Filter by category name (e.g. `Mermaid Melodies`, `Palworld`, `Dark Folklore`). |
| `search` | `string` | No | - | Case-insensitive search matching item `title` or `description`. |
| `categorized` | `boolean` | No | `false` | When `true` (specifically for `type=banner`), returns an object grouped by category `{ [category]: Item[] }`. |
| `limit` | `number` | No | `200` | Max items returned (max allowed: 2000). |
| `offset` | `number` | No | `0` | Pagination offset. |

---

## 2. Item Types & URL Generation

### A. Avatar Decorations (`type=decoration`)
- **Total Count**: 457 items
- **Typical Price**: 4,100 points
- **URL Pattern**:
  ```http
  https://cdn.discordapp.com/avatar-decoration-presets/{asset_id}.png
  ```
- **Example Response**:
  ```json
  {
    "id": "a_47202ff223e839a2ecf14a8b0f3ce7a1.png",
    "type": "decoration",
    "title": "Leafy Loaf",
    "category": "Fall Foragers",
    "url": "https://cdn.discordapp.com/avatar-decoration-presets/a_47202ff223e839a2ecf14a8b0f3ce7a1.png",
    "file": "Leafy_Loaf.png",
    "asset_id": "a_47202ff223e839a2ecf14a8b0f3ce7a1",
    "description": "A black cat lounges in a pile of autumn leaves.",
    "points_required": 4100,
    "metadata": {
      "sku_id": "1545530967433674853",
      "file": "Leafy_Loaf.png"
    }
  }
  ```

---

### B. Nameplates (`type=nameplate`)
- **Total Count**: 246 items
- **Typical Price**: 4,100 points
- **URL Pattern**:
  - Animated: `https://cdn.discordapp.com/assets/collectibles/{asset_id}asset.webm`
  - Static fallback: `metadata.static_url` (`https://cdn.discordapp.com/assets/collectibles/{asset_id}static.png`)
- **Example Response**:
  ```json
  {
    "id": "nameplate_1511105808501444649",
    "type": "nameplate",
    "title": "Austria",
    "category": "Gooooal!",
    "url": "https://cdn.discordapp.com/assets/collectibles/nameplates/austria/1511105808501444649/asset.webm",
    "file": "Austria_1511105808501444649.webm",
    "asset_id": "nameplates/austria/1511105808501444649/",
    "description": "Austria's flag representation",
    "points_required": 4100,
    "metadata": {
      "sku_id": "1511105808501444649",
      "palette": "crimson",
      "static_url": "https://cdn.discordapp.com/assets/collectibles/nameplates/austria/1511105808501444649/static.png"
    }
  }
  ```

---

### C. Profile Effects (`type=effect`)
- **Total Count**: 270 items
- **Price Range**: 4,100 – 8,200 points
- **URL Pattern**:
  - Intro Animation: `metadata.effects[0].src`
  - Loop Animation: `metadata.effects[1].src` (or main `url`)
  - Thumbnail Preview: `metadata.thumbnailPreviewSrc`
- **Example Response**:
  ```json
  {
    "id": "effect_1545538298884259930",
    "type": "effect",
    "title": "Odette",
    "category": "Fall Foragers",
    "url": "https://cdn.discordapp.com/media/v1/collectibles-shop/42b9a68dea261dcde438a0efd924bc131d788d7cd2900ee6f362bbbd3a0416ea",
    "description": "Show this effect when others view your profile.",
    "points_required": 4100,
    "metadata": {
      "sku_id": "1545538298884259930",
      "thumbnailPreviewSrc": "https://cdn.discordapp.com/media/v1/collectibles-shop/2ea54999168210cb9b989fa7942891211248431b9f807b24ba51eb43e8a4d819",
      "effects": [
        {
          "src": "https://cdn.discordapp.com/media/v1/collectibles-shop/db755b9de7681c2eb53c21739e83d625d86d9a3ff24b64c263ae384bc3f3dae5",
          "loop": false,
          "duration": 4981,
          "start": 0,
          "zIndex": 110
        },
        {
          "src": "https://cdn.discordapp.com/media/v1/collectibles-shop/42b9a68dea261dcde438a0efd924bc131d788d7cd2900ee6f362bbbd3a0416ea",
          "loop": true,
          "duration": 4980,
          "start": 7981,
          "zIndex": 100
        }
      ]
    }
  }
  ```

---

### D. Profile Frames & Layers (`type=frame`)

#### Why is `url` empty for Profile Frames?
Unlike avatar decorations (which are single circular PNG images), Discord **Profile Frames** wrap around the **entire user profile card**. Because profile cards have dynamic dimensions, Discord splits frames into **modular responsive anchors**:

```json
{
  "id": "frame_1545538607811534988",
  "type": "frame",
  "title": "Leafy Loaf",
  "category": "Fall Foragers",
  "url": "",
  "points_required": 4100,
  "metadata": {
    "sku_id": "1545538607811534988",
    "inner_width": 1200,
    "overflow_top": 304,
    "overflow_bottom": 212,
    "overflow_horizontal": 56,
    "layers": [
      {
        "id": "1549900374805184522",
        "type": "staple",
        "order": "front",
        "anchor": "top",
        "responsive": false
      },
      {
        "id": "1549900379196624936",
        "type": "staple",
        "order": "front",
        "anchor": "bottom",
        "responsive": false
      },
      {
        "id": "1549900383076220939",
        "type": "staple",
        "order": "back",
        "anchor": "top",
        "responsive": false
      },
      {
        "id": "1549900387216269445",
        "type": "staple",
        "order": "back",
        "anchor": "bottom",
        "responsive": false
      }
    ]
  }
}
```

#### How to Render Profile Frames:
1. **Bundle/Shop Preview Artwork**:
   In the shop or preview modal, Discord uses the bundle preview asset:
   ```http
   https://cdn.discordapp.com/media/v1/collectibles-shop/bundle-fg-static/{bundle_sku_id}
   ```
2. **Layer Layout in Profile Cards**:
   - `layers`: Anchored slices placed at `top` and `bottom` of the card.
   - `order`: `front` (overlays the banner/avatar) and `back` (renders behind).
   - `inner_width`: Reference width (1200px) used to scale padding and border offsets.

---

### E. Category Banners (`type=banner`)
- **Total Count**: 699 items
- **Points Required**: **0 points** (100% Free background art for all users)
- **URL Pattern**:
  ```http
  https://cdn.discordapp.com/media/v1/collectibles-shop/{hash}
  ```
- **Example Request with Category Grouping**:
  ```http
  GET /functions/v1/customizations?type=banner&categorized=true
  ```
- **Example Response**:
  ```json
  {
    "Fall Foragers": [
      {
        "id": "banner_Fall_Foragers_hero_banner_url_0",
        "type": "banner",
        "title": "Fall Foragers - Hero Banner Url",
        "category": "Fall Foragers",
        "url": "https://cdn.discordapp.com/media/v1/collectibles-shop/f9bca9ab15cb116106fd293fac4fb4d206c467f8ac866e3b209341ef712b9e28",
        "points_required": 0
      }
    ],
    "Mermaid Melodies": [ ... ]
  }
  ```

---

## 3. Unlocking Items (`POST /users`)

Action: `unlock_customization`

Allows users to spend points from their `user_points` balance to permanently unlock an item into their `commentum_users.unlocked_customizations` array.

### Staff Role Free Bypass:
If the user's role is any of the following staff roles:
* `owner`
* `app_owner`
* `super_admin`
* `admin`
* `moderator`

**The system skips the points check completely and unlocks the item for 0 points (Free)!**

### Request
```http
POST /functions/v1/users
Content-Type: application/json
```
```json
{
  "action": "unlock_customization",
  "client_type": "anilist",
  "access_token": "user_oauth_token",
  "moderator_id": "123456",
  "customization_id": "a_47202ff223e839a2ecf14a8b0f3ce7a1.png"
}
```

### Success Response (Staff Role)
```json
{
  "success": true,
  "message": "Unlocked for free (Staff privilege)",
  "staff": true,
  "customization_id": "a_47202ff223e839a2ecf14a8b0f3ce7a1.png"
}
```

### Success Response (Regular User with Points)
```json
{
  "success": true,
  "message": "Successfully unlocked Leafy Loaf!",
  "customization_id": "a_47202ff223e839a2ecf14a8b0f3ce7a1.png",
  "points_spent": 4100,
  "remaining_points": 1250
}
```

### Error Response (Insufficient Points)
```json
{
  "error": "Insufficient points",
  "required_points": 4100,
  "current_points": 800
}
```

---

## 4. Equipping Customizations (`POST /users`)

Action: `update_customizations`

Updates the user's currently equipped customization URLs on their profile.

### Request
```http
POST /functions/v1/users
Content-Type: application/json
```
```json
{
  "action": "update_customizations",
  "client_type": "anilist",
  "access_token": "user_oauth_token",
  "moderator_id": "123456",
  "avatar_decoration": "https://cdn.discordapp.com/avatar-decoration-presets/a_47202ff223e839a2ecf14a8b0f3ce7a1.png",
  "nameplate_theme": "https://cdn.discordapp.com/assets/collectibles/nameplates/harvest_mouse/1545534249216638986/asset.webm",
  "banner_url": "https://cdn.discordapp.com/media/v1/collectibles-shop/f9bca9ab15cb116106fd293fac4fb4d206c467f8ac866e3b209341ef712b9e28",
  "banner_theme": "autumn",
  "profile_effect_url": "https://cdn.discordapp.com/media/v1/collectibles-shop/42b9a68dea261dcde438a0efd924bc131d788d7cd2900ee6f362bbbd3a0416ea"
}
```

### Response
```json
{
  "success": true,
  "customizations": {
    "avatar_decoration": "https://cdn.discordapp.com/avatar-decoration-presets/a_47202ff223e839a2ecf14a8b0f3ce7a1.png",
    "nameplate_theme": "https://cdn.discordapp.com/assets/collectibles/nameplates/harvest_mouse/1545534249216638986/asset.webm",
    "banner_url": "https://cdn.discordapp.com/media/v1/collectibles-shop/f9bca9ab15cb116106fd293fac4fb4d206c467f8ac866e3b209341ef712b9e28",
    "banner_theme": "autumn",
    "profile_effect_url": "https://cdn.discordapp.com/media/v1/collectibles-shop/42b9a68dea261dcde438a0efd924bc131d788d7cd2900ee6f362bbbd3a0416ea"
  }
}
```

---

## 5. Leaderboard & Comment Batch RPCs

### A. Leaderboard Customizations (`get_points_leaderboard`)
The points leaderboard query automatically includes equipped cosmetics:

```sql
SELECT * FROM get_points_leaderboard('anilist', 100);
```

**Returned Columns**:
- `user_id` (TEXT)
- `total_points` (NUMERIC)
- `rank` (BIGINT)
- `tier` (TEXT)
- `avatar_decoration` (TEXT)
- `nameplate_theme` (TEXT)
- `banner_theme` (TEXT)
- `banner_url` (TEXT)

---

### B. Batch Comment Author Customizations (`get_batch_user_customizations`)
Fetches equipped customizations for a list of user IDs in a single query:

```sql
SELECT * FROM get_batch_user_customizations(ARRAY['123', '456'], 'anilist');
```

**Returned Record**:
- `user_id`
- `avatar_decoration`
- `banner_url`
- `banner_theme`
- `nameplate_theme`
- `profile_effect_url`

---

## 6. Caching & Performance

The `GET /customizations` endpoint sets HTTP cache headers:
```http
Cache-Control: public, max-age=3600, s-maxage=86400
```
- **Browser Cache**: 1 hour (`max-age=3600`)
- **Edge/CDN Cache (Cloudflare)**: 24 hours (`s-maxage=86400`)

This ensures blazing-fast responses globally while keeping database load minimal.
