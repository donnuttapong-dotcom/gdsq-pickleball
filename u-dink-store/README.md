# U DINK STORE

Development handoff for **U DINK STORE**.

## Current master
The current frontend direction is **V4: V3 visual layout + motion / interaction layer**.

## Version history
- **V1** — original storefront prototype
- **V2** — expanded catalog / filter / cart experiment
- **V3** — original-layout master
- **V4** — V3 master + motion and interaction

## Brand architecture
- **U DINK CLUB** — community / events
- **U DINK STORE** — products / merch / gear
- **U DINK I DRIVE** — performance
- **U DINK I DRINK** — social / lifestyle

Main line: **PLAY · WEAR · DINK.**

## Visual system
- Black / charcoal
- White
- Neon pickleball chartreuse accent
- Subtle dark-green pickleball-court texture
- Minimal premium sport retail

## Current prototype features
- responsive desktop / mobile storefront
- product search
- brand / category / status filters
- NEW / LIMITED / PRE-ORDER / COMING SOON / SOLD OUT states
- product detail interaction
- cart / remove from cart
- checkout preview
- scroll reveal
- hero parallax
- product-card tilt / spotlight
- marquee motion
- scroll progress
- back-to-top
- reduced-motion accessibility fallback

## Still to implement
- official product photography
- final Thai retail prices
- live stock / inventory
- product variants
- persistent cart and order state
- admin product / stock / order management
- Thailand checkout / PromptPay / card integration
- LINE contact / payment workflow
- analytics / SEO

## Current preview
https://udink-store-v4-fixed.vercel.app

## Complete source archive
The complete source package and prototype history are stored under `archive/` as seven Base64 parts because the GitHub connector used for the handoff writes text files.

Run:

```bash
python tools/restore_source.py
```

This recreates `U_DINK_STORE_ALL_SOURCE.zip` and extracts all saved source versions into `restored-source/`.

## Development note
Treat the **V3 / V4 visual composition as the design master**. Extend functionality without redesigning the overall hierarchy unless the owner approves the change.
