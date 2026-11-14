# Landing media: Higgsfield prompt pack

Higgsfield's unlimited generations are refused from Claude Code ("available in: Claude chat, Claude Cowork,
ChatGPT"; checked 2026-11-14 for image and video, credit balance 1.75). Run these in Claude chat or Cowork with the
Higgsfield connector, download the results, and save them under `web/public/media/` with the file names below.
The landing reads every path from `web/src/landing/media.ts`, so a new file only needs its entry there.

Rules for every asset (project rules, do not relax):
- Illustrative only. The page captions each one "Illustrative image/animation, not NASA imagery".
- Never a "photo" of a specific real site, no NASA insignia, no flags, no logos, no text in frame, no spacecraft
  that could be read as a real mission.
- One look across all assets: hard unfiltered sunlight from the horizon, very long shadows, pure black sky with no
  stars, grey regolith, the only colour a small warm orange at the Sun (and blue-white on Earth when it appears).
- Keep the empty black sky on the side named in the prompt: text sits there.

Shared style suffix (append to every prompt):
`Photorealistic, shot like real mission photography, 24mm lens, high dynamic range, sharp detail, hard unfiltered
light, deep permanent shadow, muted natural greys, pure black sky with no stars, no people, no spacecraft, no text,
no logos, no lens flare streaks.`

## 1. Hero still: `hero-poster.jpg`
Model `nano_banana_pro`, aspect 16:9, resolution 4k. Generate 4 and pick one.
> Wide view standing on the lunar south pole highlands. The Sun sits exactly on the horizon at the far right, half
> hidden behind a jagged distant ridge, casting extremely long black shadows across grey regolith toward the
> camera. Empty black sky fills the upper half and the whole left half of the frame. Foreground: fine dusty
> regolith, small rocks, one shallow crater rim catching warm low sunlight.

## 2. Hero loop: `hero-loop.mp4`
Model `seedance_2_5`, mode `omni_reference`, start_image AND end_image = the chosen hero still (so it loops),
16:9, 1080p, 10 s, `generate_audio: false`.
> Locked-off camera, no camera movement. The Sun creeps a tiny distance sideways along the horizon and back while
> the long shadows lengthen and shorten almost imperceptibly. Dust and rocks stay perfectly still. Calm, slow,
> seamless loop.

After download: `ffmpeg -i in.mp4 -an -vf scale=1920:-2 -c:v libx264 -crf 24 -preset slow -movflags +faststart
web/public/media/hero-loop.mp4` and keep it under about 2.5 MB.

## 3. Why a day matters: `why-ridge.mp4` + `why-ridge.jpg`
Still first (`nano_banana_pro`, 21:9, 4k), then video from it (`seedance_2_5`, start_image = the still, 21:9,
1080p, 10 s, no audio).
> Still: Telephoto view along the lunar horizon. A low rugged ridge runs across the frame; the Sun's disc sits just
> above the ridge line on the left third, grazing it. Black sky above, ridge and foreground in deep shadow with
> thin sunlit edges.
> Video: Locked-off camera. The Sun slides slowly to the right, parallel to the horizon, and slips behind a higher
> part of the ridge until only a faint glow remains. Shadows sweep across the foreground as the light goes.

## 4. Closing band: `closing-horizon.jpg`
`nano_banana_pro`, 21:9, 4k.
> Low wide view across a dark lunar plain toward a bright sunlit ridge on the horizon. A small blue-white Earth
> hangs low above the horizon at the right third. The lower third of the frame is in deep shadow, empty and dark.

## 5. Bento texture: `texture-regolith.jpg`
`nano_banana_pro`, 1:1, 2k.
> Top-down close view of lunar regolith raked by grazing sunlight from the left: fine dust, a few pebbles, every
> grain throwing a long thin shadow. No horizon, no sky.

## 6. Audience: `audience-team.jpg`
`soul_2` (2k) or `nano_banana_pro`, 3:2.
> Four university students around a table at night, one laptop open, a large printed grey relief map of a cratered
> polar region spread out between them, one student pointing at a ridge on the map. Warm desk lamp, dark room,
> candid documentary photo, no visible screens content, no logos, no text.
(Do not append the lunar style suffix to this one.)

## Optional, for the submission video (not used by the page)
A 30 s teaser: 3 clips of 10 s from stills 1, 3 and 4 with `seedance_2_5`, narration with `text2speech_v2`.
Open on the question "If your Moon mission slips by one day, does your start date still fit your limits?", then
screen-record the real 0 h to 8.9 h change in the app. Numbers come from the app recording, never from narration
written in advance.
