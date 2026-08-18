---
title: ProstheticGrip
date: 2024
tags: [Prosthetics, EMG, CAD]
image: /assets/images/prosthetic-hand.svg
summary: A 3D-printed myoelectric prosthetic hand prototype, controlled by forearm EMG signals, designed for low-cost fabrication.
stack: [EMG Sensors, Arduino, SolidWorks, 3D Printing]
---

## The problem

Commercial myoelectric prosthetic hands can cost tens of thousands of dollars. ProstheticGrip explores how far a 3D-printed, EMG-controlled hand can get on a student budget and a desktop printer.

## Approach

Two surface EMG electrodes read forearm muscle activity, which is thresholded and mapped to a small set of grip patterns (open, closed, pinch) driven by five servo-actuated tendons routed through a 3D-printed hand skeleton. The socket and finger geometry were modeled in SolidWorks and iterated across four printed revisions.

## Results so far

The current prototype reliably distinguishes between open, closed, and pinch grips with about a quarter-second of latency, and can hold objects up to roughly 500 grams without slipping.

## What's next

Reducing latency, adding a proportional grip strength control instead of fixed patterns, and getting feedback from an actual prosthetic user — which matters more than any spec on this list.
