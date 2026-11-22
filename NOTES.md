# DermaVTO working notes

Built 25 October 2026 for the YouCam API Skin AI and eCommerce VTO Hackathon, deadline 2 November 2026 at 11:45am EST.

## What the brief said versus what the API is

The brief named `v1.0/task/skin-analysis` and `v1.0/task/makeup-vto`. Those paths do not exist. Perfect Corp's published OpenAPI files, read on 25 October 2026, give these.

- Skin analysis, `/s2s/v2.0/task/skin-analysis` (also a `v2.1` variant). Source https://docs.perfectcorp.com/_bundle/reference/ai_skin_analysis.json
- Makeup try on, `/s2s/v2.0/task/makeup-vto`. Source https://docs.perfectcorp.com/_bundle/reference/makeup_vto.json
- File upload, `/s2s/v2.0/file`. Source https://docs.perfectcorp.com/_bundle/reference/file.json
- The "V1.0" tag in the makeup documentation is the version of the effect specification, sent as the body field `version`.

Everything in `engine.js` follows the live paths. The function names from the brief (`buildYouCamTaskPayload`, `normalizeYouCamSkinResponse`) were kept. `dst_actions` values are the real enum, including the eight HD ones the brief listed.

## Hackathon rule that shaped the build

The Devpost page says all solutions must integrate at least one YouCam API into a functional prototype, and one judging criterion is how thoroughly the project integrates it. A page that only builds payloads would not satisfy that, so `youcam-live.js` runs the real flow from the browser when someone supplies their own key. Read from the Devpost page on 25 October 2026. The page also asks for a 1 to 3 minute demo video that explains the YouCam API used and shows the project working, screenshots, and a public repository.

## Screening literacy workbench, added 22 November 2026

`fairness-lab.js` is a UMD module with no DOM and no network, in the style of `render.js`. The ABCDE checklist weights Asymmetry, Border and Colour 1 each, Diameter 1.25 and Evolution 2, scaled to 100. Evolution carries the most weight because public guidance treats change over time as the strongest reason to be seen. The urgency tag follows the total and the Evolution grade, with a prompt review at a total of 70 or more or an Evolution grade of 3. None of it reads a photo.

The fairness audit generates 360 synthetic records, 60 per Fitzpatrick type with exactly the same positive share in each, from a fixed seed so the table and chart are identical on every load. The planted assessor is deliberately weaker on types V and VI (separation steps down from 0.62 on type I to 0.30 on type VI), which reproduces the direction of the published concern that visual lesion aids perform worse on darker skin. The numbers demonstrate the audit method. They are not evidence about any real product.

The SHA-256 in `fairness-lab.js` is a from scratch FIPS 180-4 implementation. It passes the four published known answer vectors and agrees with Node crypto on the padding boundary lengths 55, 56, 63, 64 and 119 and on one million `a` characters. It is unkeyed, so the export digest detects a changed file but cannot stop a deliberate rewrite and cannot say who wrote it.

The photo gate reads only the pixels of whatever sits in the studio. Its checks are minimum side length, mean and spread of CIE L*, a Laplacian sharpness proxy and the share of the frame that reads as skin coloured. The scale reference item is a checkbox the user confirms. It cannot be measured from pixels.

## Verified, and how

| Claim | How it was checked |
| :--- | :--- |
| CIEDE2000 is correct | All 34 published pairs from the Sharma data file pass to four decimals. The file was downloaded from the Rochester site and sits in `tests/fixtures/`. The host has no robots.txt. |
| sRGB to L*a*b* is correct | Red, green and blue match published D65 values to 0.001. |
| ITA bands | Thresholds 55, 41, 28, 10 and minus 30 and the six names match the table in the Del Bino, Duval and Bernerd 2018 review (PMC6163216). The Chardon 1991 and Del Bino 2006 papers themselves could not be fetched, so they are not cited directly. |
| API paths and schemas | Read from the OpenAPI JSON bundles above. |
| CORS | A preflight `OPTIONS` request with `Origin`, `Access-Control-Request-Method` and `Access-Control-Request-Headers` set was answered with `access-control-allow-origin: *` and `authorization, content-type` allowed. |
| Invalid key response | `POST` with the key `INVALID_TEST_KEY` returned HTTP 401 `{"error_code":"InvalidApiKey"}`, and the page in a real browser shows the friendly message. No real key was used or exists in this repository. |
| Layout | Headless Chrome at 320, 375, 414, 768 and 1024 wide. No horizontal overflow, and no two line buttons or nav links. |
| Workbench layout | Real headless Chrome 22 November 2026 at 1440x900 and 390x844. Zero console errors, page errors, external requests, failed requests and horizontal overflow. The fairness SVG renders at both widths. |
| In page self tests | All 17 pass in real headless Chrome, including the four SHA-256 known answer vectors, Wilson interval ordering, ECE bounds, cohort partition conservation, CSV escaping and export tamper detection. |
| Bookmark round trip | A `#derm=` hash was loaded in real headless Chrome and restored the checklist answers, the threshold and the scale confirmation. |

## Not verified

- A full live run with a valid key. The flow is covered by unit tests with a scripted network only.
- Whether the signed upload address allows a cross origin browser `PUT`. If it does not, the upload option fails with a clear message and the link option still works.
- Lip shape names other than `original`. The documentation points to a `lipshape.json` that was not available.
- The ITA band names are the commonly tabulated ones. Only the review's lowercase list was seen.
- Fonts were fetched from Google Fonts once and are committed. They were not compared byte for byte with the upstream release.
- The fairness cohort is synthetic and planted. Whether its gap magnitudes resemble any real product is unknown, and the page says so.
- The photo gate thresholds were tuned on the procedural specimen and a small set of test frames. They have not been checked against real telederm submissions.
- The bookmark codec was checked in headless Chrome on this machine, not across browsers.

## Heuristics that must stay labelled

- Undertone zones (a* over b* cut points 0.72, 0.52 and 0.40).
- Concealer target is the sample with L* plus 3.
- Lip target is the sample with L* minus 14, a* plus 22 and b* minus 2.
- The erythema and melanin numbers are three channel proxies. The erythema proxy rises with deeper tone, which is why redness coverage is reported as well.
- Local scores map only to pores, texture, oiliness and redness. Wrinkle, blemish, moisture and radiance are marked as needing the API, because a flat patch cannot say anything honest about them. Radiance in particular would have scored dark skin lower by construction.
- ABCDE letter weights 1, 1, 1, 1.25 and 2, the band edges at 20, 45 and 70, and the urgency thresholds are judgement calls on published education material, not measured values.
- Photo gate thresholds are a 480 pixel minimum side, L* mean 18 to 92, L* spread 2 to 32, Laplacian spread 0.7 and skin share 0.2.
- The planted separation schedule in the synthetic cohort, 0.62 down to 0.30 by type, is tuned so the default threshold shows a visible gap. It is a teaching device, not a fitted model.

## Design record

Macrostructure Workbench, custom theme (porcelain paper `#FAF7F2`, surface `#F1ECE3`, espresso ink `#181514`, carmine `#B84A39`, sage `#2A6F62`), Cormorant Garamond display kept roman, Plus Jakarta Sans body, JetBrains Mono for numbers. Audience was inferred as hackathon judges and beauty shoppers, the job as reading a tone and trying a shade, and the tone as editorial atelier. No eyebrow labels, no emoji, no uppercase styling, no dashes. See `DESIGN.md`.

## Lessons from this build

- A `*/` inside a block comment ends it. "a*/b*" in a comment broke `render.js` until it ran in a browser, because the Node tests had not loaded that file yet. Test every file that ships.
- A tool that writes files can turn a unicode escape in source into the real character (here the escapes for the en dash and em dash). The dash scan caught it in a test file, so the checks now build their patterns from `String.fromCharCode`.
- Browsers cache a plain static server's files hard. Use `Cache-Control: no-store` when checking edits.
- A shading gradient dominates a melanin proxy. The chromophore map subtracts a wide local average first, and scales by the median absolute deviation so the lips do not set the threshold.
- Headless Chrome enforces a minimum window width, so a 375 pixel screenshot is cropped layout, not a mobile layout. Measure inside an iframe of the real width instead.

## Open items for a human

1. Get a YouCam API key from the hackathon page, run the live skin analysis and try on once, and record that run in the demo video.
2. Record the demo video (1 to 3 minutes) using `video/narration.txt`, then add its link to the Devpost form.
3. Decide whether to submit. Eligibility and the final rules text on Devpost were not fully readable by the tools used here.
