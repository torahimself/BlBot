# Your own card backgrounds

1. Put a picture here (PNG / JPG / WebP). Best size: **1100 × 640** or bigger, same proportions. Dark pictures look best,
   the bot adds a soft dark veil so the text stays readable.
2. Add a line to `backgrounds.json` (create the file if it doesn't exist):

```json
[
  { "id": "shadow", "file": "shadow.png", "label": "Shadow Monarch", "emoji": "🗡️", "unlock": { "streak": 14 } },
  { "id": "free-one", "file": "calm.jpg", "label": "Calm", "emoji": "🍃" }
]
```

* `id` — letters / numbers / `-` / `_`, up to 24, unique.
* `unlock` (optional — leave it out and the background is free for everybody). Any of these, combined if you like:
  * `"streak": 30` — best daily streak ever reached
  * `"level": 20` — profile level
  * `"title": "gb_first_win"` — owns a title whose id starts with that text
    (`gb_` = game badges, `st_` = streak badges, `event_halloween2026` = Halloween titles)
* Restart the bot. Members pick it from **/profile → Customize → Background**.
* At most 24 backgrounds in total (the 10 drawn ones count).
