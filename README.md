# How do i add more blogs and projects

Two steps for either one — write the markdown file, then register its filename in one config array.

Adding a blog post

1. Create a new file in content/blog/, e.g. content/blog/my-new-post.md:

```md
title: Your Post Title
date: August 2026
author: Sajib Nipon
tags: [Tag One, Tag Two]
image: /assets/images/circuit-board.svg
summary: One or two sentences — this is what shows on the preview card.

---

Write the full post here in regular markdown. Headings, lists, **bold**,
```

whatever you want — it gets rendered automatically.

## A subheading works too

For image, reuse one of the existing files in assets/images/ (ecg-waveform.svg, circuit-board.svg, care-heart.svg, brain-waves.svg, prosthetic-hand.svg), or drop in your own image file anywhere under assets/ and point to it.

2. Register the slug — open js/main.js, find the SECTIONS array near the top (~line 38), and add the filename (without .md) to the blog entry's slugs list:

js
{ id: "blog", label: "Blog", eyebrow: "Case Item 04", kind: "collection", contentDir: "blog",
slugs: ["my-new-post", "why-school-health", "building-a-diy-ecg-patch", "welcome-to-the-lab"] },
Order in that list = display order, newest-first is the convention I used. That's it — it'll show up as a card in the Blog popup, with its own shareable URL at #blog/my-new-post.

Adding a project
Same pattern, just in content/projects/:

## markdown

title: Your Project Name
date: 2026
tags: [Tag One, Tag Two]
image: /assets/images/prosthetic-hand.svg
summary: One or two sentences for the preview card.
stack: [Tool, Tool, Tool]

---

## The problem

...

## Approach

...

## Results so far

...
Then add its slug to the work entry's slugs list right above the blog one in SECTIONS.

One thing to flag: since content loads via fetch(), this only works when the site is served over http (npx serve . from the project root) — not when index.html is opened directly by double-clicking it.

```

```
