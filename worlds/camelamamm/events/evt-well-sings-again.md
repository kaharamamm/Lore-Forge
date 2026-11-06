---
id: evt-well-sings-again
type: event
name: The Night the Well Sang
kind: Celebration
outcome: The well sings again, Malquor is arrested, and the Well Wardens have two new members.
date: "14.03.512"
place: place-singing-well
participants:
  - id: char-mr-camel
    role: warden
  - id: char-pip
    role: apprentice
  - id: char-samira
    role: queen
  - id: char-malquor
    role: prisoner
  - id: fac-well-wardens
    role: restored
actions:
  - actor: char-samira
    verb: arrested
    target: char-malquor
  - actor: char-samira
    verb: dissolved
    target: fac-dry-hand
visual:
  scene: Night, lanterns around a green-brick well, water spilling over its rim, a whole city dancing.
  mood: Joyful, wet, loud.
picture:
  image: images/evt-well-sings-again/scene.png
images:
  - file: images/evt-well-sings-again/scene.png
    view: scene
    provenance:
      tool: Grok Bot image generation
      date: "2026-11-05"
      rights: Made for the Lore-Forge sample world; MIT like the rest of the repo
      prompt: Painterly fantasy concept art of The Night the Well Sang, from its visual description
---

The well sang at midnight instead of dawn, and nobody in [[place-camelamamm|Camelamamm]] slept.
