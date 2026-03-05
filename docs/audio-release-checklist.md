# Audio Release Checklist

Run this checklist on staging before promoting to production.

## 1. Unlock + Lifecycle

- Open app with sound enabled and confirm first user gesture unlocks audio.
- Verify menu music starts after first interaction.
- Start a race and confirm gameplay music starts.
- Background tab/app for 10+ seconds, return, and confirm audio resumes cleanly.
- Switch between menu -> lobby -> race -> result -> menu and confirm no stuck loops.

## 2. Core Gameplay Cues

- Countdown ticks play at `3`, `2`, `1`, and `GO`.
- Item pickup cue plays when receiving an item.
- Item use/hit cues play on ability activation and successful impacts.
- Lap/finish cues play once per event and do not spam.
- Win/loss stinger plays at race end based on local result.

## 3. UI Cues

- Hovering major buttons produces subtle UI hover cue.
- Confirm actions (start/create/join/apply/save/continue) produce confirm cue.
- Back/leave actions produce back cue.
- Cues are audible but not louder than gameplay-critical SFX.

## 4. Settings + Accessibility

- Master/music/game SFX/UI sliders update sound levels immediately.
- Mute toggle silences all channels and can be toggled back reliably.
- Dynamic range modes (`full`, `medium`, `low`) audibly change compression behavior.
- Reduced sensory mode lowers perceived harshness of repetitive gameplay cues.
- Reload page and confirm settings persist from local storage.

## 5. Performance + Stability

- During busy race moments, no audible crackle/dropout under normal FPS.
- No console errors related to audio decode/fetch/unlock.
- Voice cap behavior prevents runaway overlapping sounds.
- Missing audio files (if simulated) fail gracefully without breaking gameplay.

## 6. Browser/Device Matrix

- Desktop Chrome (latest)
- Desktop Edge (latest)
- Desktop Firefox (latest)
- Desktop Safari (latest)
- iOS Safari (latest supported)
- Android Chrome (latest)

Mark each as pass/fail and attach notes for regressions.
