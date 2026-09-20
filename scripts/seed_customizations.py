#!/usr/bin/env python3
"""
seed_customizations.py — generates public.customizations_catalog seed SQL
from the extracted Discord assets in AnymeX-Preview/discord_assets.

Uses points (4,100+ points) based on Discord's native orb pricing.
Staff roles (owner, app_owner, super_admin, admin, mod) bypass points requirement.
No USD or real-currency fields.

Outputs:
  supabase/migrations/035_seed_customizations.sql

Idempotent: Uses ON CONFLICT (id) DO UPDATE so it can be re-run safely.
"""

import json
import os
import sys

def sql_str(v):
    if v is None:
        return "NULL"
    clean = str(v).replace("'", "''")
    return f"'{clean}'"

def sql_json(obj):
    if obj is None:
        return "'{}'::jsonb"
    raw = json.dumps(obj, ensure_ascii=False)
    clean = raw.replace("'", "''")
    return f"'{clean}'::jsonb"

def main():
    script_dir = os.path.dirname(__file__)
    project_root = os.path.dirname(script_dir)
    
    assets_dir = os.path.abspath(os.path.join(project_root, '..', 'AnymeX-Preview', 'discord_assets'))
    if not os.path.exists(assets_dir):
        print(f"Error: discord_assets directory not found at {assets_dir}")
        sys.exit(1)

    out_file = os.path.join(project_root, 'supabase', 'migrations', '035_seed_customizations.sql')

    print(f"Reading assets from: {assets_dir}")
    print(f"Output SQL file: {out_file}")

    # Extract official Discord Orbs points by SKU
    raw_path = os.path.join(assets_dir, 'raw_categories.json')
    sku_points_map = {}
    if os.path.exists(raw_path):
        with open(raw_path, 'r', encoding='utf-8') as f:
            raw_cats = json.load(f)
        for c in raw_cats:
            for p in c.get('products', []):
                sku = p.get('sku_id')
                orbs = 0
                for tier, tier_data in p.get('prices', {}).items():
                    for pr in tier_data.get('country_prices', {}).get('prices', []):
                        if pr.get('currency') == 'discord_orb':
                            orbs = pr.get('amount', 0)
                if sku and orbs > 0:
                    sku_points_map[sku] = orbs

                for bp in p.get('bundled_products', []):
                    bp_sku = bp.get('sku_id')
                    bp_orbs = 0
                    for tier, tier_data in bp.get('prices', {}).items():
                        for pr in tier_data.get('country_prices', {}).get('prices', []):
                            if pr.get('currency') == 'discord_orb':
                                bp_orbs = pr.get('amount', 0)
                    if bp_sku:
                        sku_points_map[bp_sku] = bp_orbs or orbs
        print(f"Extracted Discord points for {len(sku_points_map)} SKUs")

    rows = []

    # 1. Avatar Decorations (Default: 4100 points)
    deco_path = os.path.join(assets_dir, 'avatar_decorations.json')
    if os.path.exists(deco_path):
        with open(deco_path, 'r', encoding='utf-8') as f:
            decos = json.load(f)
        for i, d in enumerate(decos):
            item_id = d.get('id') or f"{d.get('asset_id')}.png"
            sku = d.get('sku_id')
            points = sku_points_map.get(sku) or 4100
            
            rows.append({
                'id': item_id,
                'type': 'decoration',
                'title': d.get('title', 'Avatar Decoration'),
                'category': d.get('category', 'General'),
                'url': d.get('url') or d.get('cdn_url', ''),
                'asset_id': d.get('asset_id', ''),
                'description': d.get('description', ''),
                'points_required': points,
                'metadata': {
                    'sku_id': sku,
                    'file': d.get('file')
                },
                'display_order': i
            })
        print(f"Loaded {len(decos)} decorations (priced at {min(r['points_required'] for r in rows if r['type']=='decoration')} - {max(r['points_required'] for r in rows if r['type']=='decoration')} points)")

    # 2. Nameplates (Default: 4100 points)
    np_path = os.path.join(assets_dir, 'nameplates.json')
    if os.path.exists(np_path):
        with open(np_path, 'r', encoding='utf-8') as f:
            nps = json.load(f)
        for i, n in enumerate(nps):
            item_id = f"nameplate_{n.get('sku_id')}"
            sku = n.get('sku_id')
            points = sku_points_map.get(sku) or 4100

            rows.append({
                'id': item_id,
                'type': 'nameplate',
                'title': n.get('title', 'Nameplate'),
                'category': n.get('category', 'General'),
                'url': n.get('webm_url', ''),
                'asset_id': n.get('asset_path', ''),
                'description': n.get('label', ''),
                'points_required': points,
                'metadata': {
                    'sku_id': sku,
                    'palette': n.get('palette'),
                    'static_url': n.get('static_url')
                },
                'display_order': i
            })
        print(f"Loaded {len(nps)} nameplates (priced at {points} points)")

    # 3. Profile Effects (4100 - 8200 points)
    eff_path = os.path.join(assets_dir, 'profile_effects.json')
    if os.path.exists(eff_path):
        with open(eff_path, 'r', encoding='utf-8') as f:
            effects = json.load(f)
        for i, e in enumerate(effects):
            item_id = f"effect_{e.get('sku_id')}"
            sku = e.get('sku_id')
            primary_url = e.get('thumbnail_url') or (e.get('effects', [{}])[0].get('src') if e.get('effects') else '')
            points = sku_points_map.get(sku) or 4100

            rows.append({
                'id': item_id,
                'type': 'effect',
                'title': e.get('title', 'Profile Effect'),
                'category': e.get('category', 'General'),
                'url': primary_url,
                'asset_id': sku or '',
                'description': e.get('description', ''),
                'points_required': points,
                'metadata': {
                    'sku_id': sku,
                    'thumbnail_url': e.get('thumbnail_url'),
                    'reduced_motion_url': e.get('reduced_motion_url'),
                    'effects': e.get('effects', [])
                },
                'display_order': i
            })
        print(f"Loaded {len(effects)} profile effects")

    # 4. Profile Frames (4100 points)
    frame_path = os.path.join(assets_dir, 'profile_frames.json')
    if os.path.exists(frame_path):
        with open(frame_path, 'r', encoding='utf-8') as f:
            frames = json.load(f)
        for i, fr in enumerate(frames):
            item_id = f"frame_{fr.get('sku_id')}"
            sku = fr.get('sku_id')
            points = sku_points_map.get(sku) or 4100

            rows.append({
                'id': item_id,
                'type': 'frame',
                'title': fr.get('title', 'Profile Frame'),
                'category': fr.get('category', 'General'),
                'url': '',
                'asset_id': sku or '',
                'description': fr.get('label', ''),
                'points_required': points,
                'metadata': {
                    'sku_id': sku,
                    'layers': fr.get('layers', []),
                    'inner_width': fr.get('inner_width'),
                    'overflow_top': fr.get('overflow_top'),
                    'overflow_bottom': fr.get('overflow_bottom'),
                    'overflow_horizontal': fr.get('overflow_horizontal')
                },
                'display_order': i
            })
        print(f"Loaded {len(frames)} profile frames")

    # 5. Category Banners (0 points = Free background artwork)
    banner_path = os.path.join(assets_dir, 'category_banners.json')
    if os.path.exists(banner_path):
        with open(banner_path, 'r', encoding='utf-8') as f:
            banners = json.load(f)
        for i, b in enumerate(banners):
            cat_clean = b.get('category', 'General').replace(' ', '_')
            btype = b.get('type', 'banner')
            item_id = f"banner_{cat_clean}_{btype}_{i}"
            rows.append({
                'id': item_id,
                'type': 'banner',
                'title': f"{b.get('category')} - {btype.replace('_', ' ').title()}",
                'category': b.get('category', 'General'),
                'url': b.get('url', ''),
                'asset_id': '',
                'description': f"Collectible banner for {b.get('category')}",
                'points_required': 0,  # Free for all users
                'metadata': {
                    'banner_type': btype,
                    'category_sku_id': b.get('category_sku_id')
                },
                'display_order': i
            })
        print(f"Loaded {len(banners)} banners (Free / 0 points)")

    print(f"\nTotal items to seed: {len(rows)}")

    # Write SQL
    batch_size = 500
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write("-- =======================================================\n")
        f.write("-- MIGRATION 035 (SEED): POPULATE CUSTOMIZATIONS CATALOG\n")
        f.write("-- Items priced in Points (4,100+ points)\n")
        f.write("-- Staff roles (owner, app_owner, super_admin, admin, mod) get 100% free access\n")
        f.write(f"-- Total items seeded: {len(rows)}\n")
        f.write("-- =======================================================\n\n")

        for i in range(0, len(rows), batch_size):
            batch = rows[i:i + batch_size]
            f.write("INSERT INTO public.customizations_catalog (\n")
            f.write("    id, type, title, category, url, asset_id, description, points_required, metadata, display_order\n")
            f.write(") VALUES\n")

            value_lines = []
            for r in batch:
                line = f"  ({sql_str(r['id'])}, {sql_str(r['type'])}, {sql_str(r['title'])}, {sql_str(r['category'])}, {sql_str(r['url'])}, {sql_str(r['asset_id'])}, {sql_str(r['description'])}, {r['points_required']}, {sql_json(r['metadata'])}, {r['display_order']})"
                value_lines.append(line)

            f.write(",\n".join(value_lines))
            f.write("\nON CONFLICT (id) DO UPDATE SET\n")
            f.write("    title = EXCLUDED.title,\n")
            f.write("    category = EXCLUDED.category,\n")
            f.write("    url = EXCLUDED.url,\n")
            f.write("    asset_id = EXCLUDED.asset_id,\n")
            f.write("    description = EXCLUDED.description,\n")
            f.write("    points_required = EXCLUDED.points_required,\n")
            f.write("    metadata = EXCLUDED.metadata,\n")
            f.write("    display_order = EXCLUDED.display_order;\n\n")

    print(f"Successfully generated {out_file} ({os.path.getsize(out_file):,} bytes)")

if __name__ == '__main__':
    main()
