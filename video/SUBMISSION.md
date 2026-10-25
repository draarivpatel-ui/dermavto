# DermaVTO | YouCam API Skin AI and eCommerce VTO Hackathon

## Name

DermaVTO, a colorimetric skin tone reader and virtual try on studio

## Tagline

Match skin by measured light.

## Description

DermaVTO starts from a plain idea. A shade match should be a measurement, not a guess. It reads the colour of a skin sample in CIE L*a*b*, places it on the Individual Typology Angle scale, and ranks 24 reference shades by CIEDE2000, the colour difference formula the colour science community uses for small differences.

Then it shows you the match. A divider splits a skin specimen, or a photo from your device, into the raw sample on one side and either a chromophore map or a try on on the other. The map separates a redness proxy from a pigment proxy so blotches and spots stand out from the lighting. The try on moves the sample toward a foundation shade in L*a*b* and colours the lips with the finish you pick. The reading panel plots the sample against the ITA bands, marks the three closest foundations, and shows an undertone compass with its heuristic labelled as one.

For YouCam, DermaVTO builds the exact request bodies for the skin analysis and makeup try on endpoints, with the same checks the API makes. HD and SD actions cannot be mixed, source links must be public https, and every intensity is an integer from 0 to 100. A response inspector reads a task response or a score_info.json into a table and a routine and shade receipt. Raw scores come first, because the documentation says the UI score is adjusted upward on purpose.

The page can also run both tasks live from your browser with your own API key. Nothing is sent until you tick a consent box and press Run live, the key stays in memory, and a link run sends only the link.

Honest limits. The reading is a colour measurement for cosmetic and educational use, not a clinical assessment. Undertone, the concealer target and the lip target are labelled heuristics. The live run has been checked against the real service only as far as the browser preflight and the key rejection response, and the rest of the flow is covered by tests with a scripted network. The skin specimen is drawn in code and is not a picture of a person.

## How it uses the YouCam API

The skin analysis task and the makeup try on task, both from the `v2.0` endpoints, plus the File API for uploads. The page creates the task, polls until it finishes, and turns the result into the receipt or shows the returned try on image. The request builder and normalizer follow Perfect Corp's published OpenAPI files, read on 25 October 2026.

## Built with

Vanilla JavaScript, HTML canvas, SVG, CSS custom properties, self hosted Cormorant Garamond, Plus Jakarta Sans and JetBrains Mono, and node:test. No dependencies and no build step.

## Try it

https://aariv.me/dermavto/

## Code

https://github.com/draarivpatel-ui/dermavto

## Voiceover script

This is the 55 word script for the demo video. It has no hyphens so the voice model reads it cleanly. It is also saved as `narration.txt` beside this file.

Load a photo, or pick a starting point. DermaVTO reads the colour in L star a star b star, measures the typology angle, and ranks twenty four shades by CIEDE2000. Drag the divider to compare the raw sample with a chromophore map or a try on. Then build the YouCam request and run it live.

## Before submitting

1. Get a YouCam API key from the hackathon page and run one live skin analysis and one live try on, so the demo video shows the real integration.
2. Record a demo video of 1 to 3 minutes that explains the YouCam API used and shows the studio working, then upload it to YouTube and paste the link into the form.
3. Add screenshots from the `screenshots` folder.
4. Confirm the repository link and the live link both open without signing in.
