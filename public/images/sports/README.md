# Sport photography

These decorative photos are bundled locally for the discovery cards.
They represent a sport, not a specific session, venue, or participant.
Next.js and Storybook serve them without contacting Unsplash at runtime.

The mobile header uses the separate user-supplied `../mobile-hero.png`, documented
in [`../README.md`](../README.md).

All six source pages identify the photos as free under the
[Unsplash License](https://unsplash.com/license), verified on 1 October 2026.
They are not Unsplash+ assets. Attribution is recorded here for the photographers.

| Local file | Photographer | Original photo |
| --- | --- | --- |
| `badminton.jpg` | [Glen Carrie](https://unsplash.com/@glencarrie) | [Badminton racket with a white shuttle](https://unsplash.com/photos/a-badminton-racket-with-a-white-shuttle-on-it-wieTrtA9v6I) |
| `basketball.jpg` | [Markus Spiske](https://unsplash.com/@markusspiske) | [Ball under basketball ring](https://unsplash.com/photos/ball-under-basketball-ring-BfphcCvhl6E) |
| `football.jpg` | [Giero Saaski](https://unsplash.com/@giero) | [Soccer ball on a green field](https://unsplash.com/photos/a-soccer-ball-sitting-on-top-of-a-lush-green-field-HPus1oCcOdk) |
| `futsal.jpg` | [Alfonso Scarpa](https://unsplash.com/@lucidistortephoto) | [Two athletes playing futsal](https://unsplash.com/photos/two-male-athletes-playing-futsal-in-a-stadium-f44zfM0Vn8w) |
| `tennis.jpg` | [Moises Alex](https://unsplash.com/@arnok) | [Man playing tennis](https://unsplash.com/photos/man-playing-tennis-WqI-PbYugn4) |
| `volleyball.jpg` | [Vince Fleming](https://unsplash.com/@vincefleming) | [Women playing volleyball inside court](https://unsplash.com/photos/women-playing-volleyball-inside-court-aZVpxRydiJk) |

## Asset preparation

The Unsplash image service produced 960 × 540 JPEG crops with
`fit=crop&crop=entropy&fm=jpg&w=960&h=540&q=75`; football uses `q=57`
to keep its detailed grass texture within the size budget. Every final crop was
visually checked. Each file is smaller than 150 KiB.

| Local file | Unsplash image identifier |
| --- | --- |
| `badminton.jpg` | `photo-1722003180803-577efd6d2ecc` |
| `basketball.jpg` | `photo-1546519638-68e109498ffc` |
| `football.jpg` | `photo-1634114441919-7636abb21cae` |
| `futsal.jpg` | `photo-1763775594018-4a84eeadd83d` |
| `tennis.jpg` | `photo-1554068865-24cecd4e34b8` |
| `volleyball.jpg` | `photo-1547347298-4074fc3086f0` |

The application maps sport names to these paths in
`lib/sessions/sport-image.ts`. Use empty alternative text for these decorative
images and reserve their 16:9 aspect ratio to prevent layout shift.
