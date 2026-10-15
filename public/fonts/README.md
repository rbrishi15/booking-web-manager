# Inter

Inter by the Inter Project Authors is bundled as unchanged variable WOFF2 files
from [Google Fonts](https://fonts.google.com/specimen/Inter), CSS version v20.
The normal face supports weights 100–900. All supplied language subsets are
retained; their Unicode ranges let browsers load only the files they need.

Source stylesheet:
<https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap>

The app and Storybook share `app/fonts.css` and Tailwind's Inter `font-sans`
stack. Both preload the Latin subset. No external font request is needed at
build time or in the browser.

The Booking. wordmark matches Figma node `2116:12362`: Inter Black (900), 20px,
normal line height, zero letter spacing, and black in light mode. The large
desktop discovery heading uses the same wordmark at its display size.

License: [SIL Open Font License 1.1](OFL.txt).
Original license: <https://github.com/google/fonts/blob/main/ofl/inter/OFL.txt>.

# Landing page: Outfit

The public landing page scopes its typography to Outfit, a geometric sans with
single-storey `a` and `g`, selected by visual comparison with the supplied
desktop and mobile references. The screenshot does not identify an exact font.
The rest of the app retains Inter and its existing wordmark specification.

`outfit-latin-variable.woff2` is the unchanged Latin subset from Google Fonts
CSS version v15, with normal weights 100–900. The landing CSS loads it locally;
no external font request is required. The headline uses weight 500, while the
hero eyebrow uses weight 400 with deliberately wide tracking.

Source stylesheet:
<https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap>

License: [SIL Open Font License 1.1](Outfit-OFL.txt).
Original license: <https://github.com/google/fonts/blob/main/ofl/outfit/OFL.txt>.
