# Programmer Handoff — U DINK STORE

## Priority
1. Preserve the V3 / V4 master visual system and page hierarchy.
2. Convert prototype product data to a real data model.
3. Add official product images, inventory, variants and retail pricing.
4. Persist cart and order state.
5. Add Thailand-ready checkout: shipping + PromptPay / cards when approved.
6. Add admin CRUD for products, stock, status and orders.
7. Keep motion subtle, performant and respectful of `prefers-reduced-motion`.

## Product states
- NEW
- LIMITED
- PRE-ORDER
- COMING SOON
- SOLD OUT

## Brand / UX direction
- Minimal premium pickleball retail
- Black / charcoal / white
- Neon pickleball chartreuse used as a controlled accent
- Mobile-first shopping experience
- Community is part of the store experience, not a separate visual language

## Existing prototype functionality
- responsive storefront
- search and filters
- product status states
- product detail interaction
- cart drawer
- checkout preview
- motion / hover / scroll interaction

## Production work still required
- real product / variant schema
- inventory source of truth
- customer / order records
- order lifecycle and admin tools
- shipping rules for Thailand
- approved payment gateway
- LINE contact / support workflow
- validation, error states, security and privacy review
- analytics and SEO

## Important design constraint
Do not replace the V3 / V4 layout with a new template as part of backend implementation. Functional changes should be integrated into the approved visual master unless a redesign is explicitly approved.

## Preview
https://udink-store-v4-fixed.vercel.app
