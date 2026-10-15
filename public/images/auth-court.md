# Authentication court background

`auth-court.webp` was reconstructed from the left-hand court scene of the
user-supplied desktop authentication mockup on 2026-10-15 with the built-in
`image_gen` edit tool. The source reference is
`codex-clipboard-2aa353af-3f51-4a87-ac00-fa60156ed34a.png`.

The edit removes the source's overlaid wordmark, slogans, and footer lettering
and excludes the form UI. It preserves the reference's descending concrete
wall edge, tennis-net placement, court lines, and diagonal shadows. This is an
AI reconstruction rather than a pixel-identical extraction; photographic
textures and small details can differ from the supplied image.

- Dimensions: 720 × 1024 pixels.
- Format: WebP, encoded with Sharp at quality 88.
- Intended use: desktop full-height authentication background.
- Accessibility: treat it as decorative, with empty alternative text when used as an image.

## Mobile background

`auth-court-mobile.webp` was reconstructed separately from the visible court
in `codex-clipboard-4895ec8b-2967-4f05-a5ef-ba6c5c53c731.png` using the built-in
`image_gen` edit tool on 2026-10-15. It retains the mobile reference's shallow
V-shaped wall, left-side shadow, and right-side net. Text, phone hardware,
status-bar icons, and the registration card are excluded. The small strip of
court hidden behind the original card is reconstructed.

- Dimensions: 1422 × 1000 pixels (711:500 aspect ratio).
- Format: WebP, encoded with Sharp at quality 86.
- Intended use: mobile authentication background, with empty alternative text.

### Mobile edit prompt

```text
Use case: precise-object-edit
Asset type: mobile webpage photographic background extraction.
Input image: the attached mobile registration screenshot is the edit target, not merely inspiration.
Primary request: reconstruct ONLY the app's court background inside the phone screen, approximately source rectangle x=116..827 and y=140..640. Output a landscape 711:500 aspect ratio image of that exact rectangular scene, with no phone frame and no interface.
Preserve the exact composition inside that source rectangle: blank pale grey/off-white top area; concrete wall top edge forms a shallow V, descending from local x=0,y=88 to its corner near x=305,y=182 then rising to local x=711,y=58; the wall corner is slightly left of center. A large triangular shadow crosses the left concrete wall from its upper left to the floor near local x=290,y=334. Wall/floor boundary is near y=334. The tennis net is on the RIGHT half, with its left post near local x=378,y=262 and the net extending right out of the image; net bottom near y=360 left and y=395 right. Crisp white court lines cross the grey lower area and angle toward the bottom edge. Fill the small region hidden by the rounded card at the very bottom with a natural continuation of the court.
Remove the Booking wordmark, People Courts Community letters, and short rule beneath that lettering. Reconstruct those small regions with the original sky or concrete background texture. Exclude ALL status bar elements, phone border, device camera island, registration card, controls, and outside background.
Constraints: preserve the same camera, architectural wall angles, sunlight and shadow, net position, pale sky tone, grey concrete texture, and overall grayscale exposure. Do not use the desktop scene. Do not mirror the net. No text, UI, borders, logos, watermarks, people, vegetation, or equipment beyond the net. Edge-to-edge opaque photograph.
```

## Final edit prompt

```text
Use case: precise-object-edit
Asset type: photographic background extraction for an authentication webpage.
Input image: the attached desktop webpage mockup is the edit target, not merely inspiration.
Primary request: extract the exact architectural tennis court scene from the LEFT 720 pixels of this 1536 by 1024 reference image, remove all overlaid lettering, and output just that scene as a portrait image with approximately 720:1024 aspect ratio. The output must correspond to the leftmost 47% of the source, full source height.
Preserve the source scene precisely: near-white blank sky at the top; a pale concrete wall whose top edge descends diagonally from x=0,y=153 to x=720,y=431; black tennis net from the left edge at y=520 to its black right post near x=510,y=502, with net bottom near y=677 left and y=632 right; wall/court boundary near y=580-610; white court lines; angular sunlit and shadowed areas; dark shadow across lower left; photographic textures and grayscale tonal balance.
Remove the Booking wordmark at upper left, the Great Games Start Here lettering and small line, and the tiny Booking/People Courts Community text at bottom left. Fill these small removed areas naturally with their original sky, wall, and court background textures.
Exclude the entire form, card, registration controls, top-right login, and all right-hand webpage content by cropping exactly to the left scene. Do not invent a new scene, reverse the diagonal wall, change the viewpoint, add a second wall corner, move the net, or add more sky. Preserve the image's original composition and sun shadows. No letters, logos, watermark, UI, or device frame. Edge-to-edge opaque photograph.
```
