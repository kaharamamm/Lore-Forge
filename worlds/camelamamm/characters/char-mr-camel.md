---
id: char-mr-camel
type: character
name: Mr Camel
aliases:
  - Barnaby Camel
summary: Patient camel-folk tea merchant of Camelamamm, once a caravan map-reader, who wakes the Singing Well.
race: camel-folk
gender: Male
occupation: Tea merchant, retired caravan map-reader
personality: Slow to speak and slower to anger. Believes most problems look smaller after a cup of tea.
goals: Keep the kettle warm, the well singing and his friends out of trouble.
skills: Map-reading, tea-blending, listening, staying calm in a sandstorm
home: place-patient-kettle
possessions:
  - item-humming-map
born: "471"
status: alive
locations:
  - place: place-camelamamm
    from: "490"
relations:
  - type: owns
    target: item-humming-map
    from: "498"
  - type: owns
    target: place-patient-kettle
    from: "498"
  - type: member-of
    target: fac-well-wardens
    from: "512"
  - type: ally-of
    target: char-samira
visual:
  appearance: Humanoid camel, honey-brown fur going grey at the muzzle, long eyelashes, kind half-closed eyes.
  build: Tall (2 m with hump), round-bellied, unhurried.
  clothing: Cream linen waistcoat, rolled sleeves, a dusty green fez, brass spectacles on a chain.
  palette: Honey brown, cream, sage green, brass.
  features: A chipped front tooth and a single grey tuft between the ears.
  props: A battered brass kettle and the Humming Map in a leather tube.
looks:
  - id: caravan-days
    name: Caravan days
    reason: As a young camel he read maps for the long caravans of the Sunsea, until Ozra left him her map and told him to stay home.
    before: evt-passing-of-ozra
    visual:
      appearance: Humanoid camel, honey-brown fur with no grey yet, bright wide-open eyes, sun-cracked lips.
      clothing: Sun-bleached travelling robe, a sand scarf wound over the green fez, a brass compass on a cord.
      palette: Sand white, honey brown, faded indigo, brass.
      features: Both front teeth whole; no grey tuft yet.
      props: A satchel of rolled caravan maps and a sweating water skin.
picture:
  icon: camel-head
  color: "#5a3a1e"
  accent: "#f2c46d"
  image: images/char-mr-camel/concept-mr-camel.gif
images:
  - file: images/char-mr-camel/three-quarter.png
    view: three-quarter
    provenance:
      tool: Grok Bot image generation
      prompt: Painterly fantasy concept art of Mr Camel, from its visual description
      date: "2026-11-05"
      rights: Made for the Lore-Forge sample world; MIT like the rest of the repo
  - file: images/char-mr-camel/concept-mr-camel.gif
    view: concept
    provenance:
      tool: Python (Pillow), animated over the three-quarter painting
      prompt: Steam rising from the kettle's spout, a glint across the brass and a sparkle on the spectacles, looping
      date: "2026-11-08"
      rights: Made for the Lore-Forge sample world; MIT like the rest of the repo
---

Mr Camel keeps [[place-patient-kettle|The Patient Kettle]], the smallest tea house in [[place-camelamamm|Camelamamm]]. As a young camel he read maps for the long caravans of the [[place-sunsea|Sunsea]], until his old teacher [[char-ozra|Ozra]] left him her map and told him to stay home and listen.

He is not brave in the way songs like. He is brave in the way that waits, and keeps waiting, until the other side gets bored or ashamed.
