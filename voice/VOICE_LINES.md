# Gore Lab voice lines

Record any of these and the game plays your take instead of its built-in synthesized cry. Lines you don't record keep the synth sound, so you can do them a few at a time.

## How to add a recording

1. Record the line and save it as an **.mp3** named exactly like the *File* column, e.g. `hurt_01.mp3`.
2. Put it in the `gore-lab/voice/` folder.
3. Add the file name to `voice/manifest.json`, e.g. `["hurt_01.mp3", "die_02.mp3"]`.
4. Upload the new files (or ask Claude to). Each event picks one of its recorded lines at random.

Tips: about 1–3 seconds each, a little silence trimmed off the front, no music or room echo. Giants and bosses play your clips deeper and runners play them a bit higher automatically.

## The lines

| # | File | When it plays | Line | How to say it |
|---|---|---|---|---|
| 1 | `hurt_01.mp3` | Hit, but not badly (a punch, a graze, a small shot). | Agh! | Short, sharp, surprised. |
| 2 | `hurt_02.mp3` | Hit, but not badly (a punch, a graze, a small shot). | Ow! Ow! | Quick, stung. |
| 3 | `hurt_03.mp3` | Hit, but not badly (a punch, a graze, a small shot). | Hey! Stop it! | Annoyed more than scared. |
| 4 | `hurt_04.mp3` | Hit, but not badly (a punch, a graze, a small shot). | What was that for?! | Offended, a little shaky. |
| 5 | `hurt_05.mp3` | Hit, but not badly (a punch, a graze, a small shot). | Nngh! | Through gritted teeth. |
| 6 | `hurt_06.mp3` | Hit, but not badly (a punch, a graze, a small shot). | That really hurt! | Whiny, voice cracking. |
| 7 | `hurt_bad_01.mp3` | Hit hard, or badly hurt already (below about a third of their health). | AAAGH! Please, no more! | Panicked, close to crying. |
| 8 | `hurt_bad_02.mp3` | Hit hard, or badly hurt already (below about a third of their health). | I'm bleeding! I'm bleeding! | Rising panic. |
| 9 | `hurt_bad_03.mp3` | Hit hard, or badly hurt already (below about a third of their health). | Why are you doing this?! | Desperate, pleading. |
| 10 | `hurt_bad_04.mp3` | Hit hard, or badly hurt already (below about a third of their health). | Somebody help me! | Shouted, voice breaking. |
| 11 | `stabbed_01.mp3` | A blade goes in and stays in. | Ghk... it's in me... | Strained whisper, shocked. |
| 12 | `stabbed_02.mp3` | A blade goes in and stays in. | AH! Get it out! Get it out! | Frantic. |
| 13 | `stabbed_03.mp3` | A blade goes in and stays in. | Oh god... oh god... | Breathy, horrified. |
| 14 | `dismember_01.mp3` | An arm or leg comes off while they're still alive. | MY ARM! WHERE'S MY ARM?! | Screamed, total disbelief. |
| 15 | `dismember_02.mp3` | An arm or leg comes off while they're still alive. | I can't feel my leg! | Panicked, high. |
| 16 | `dismember_03.mp3` | An arm or leg comes off while they're still alive. | Put it back! Put it back on! | Hysterical. |
| 17 | `dismember_04.mp3` | An arm or leg comes off while they're still alive. | (long, raw scream) | Full scream, two to three seconds. |
| 18 | `gutted_01.mp3` | Belly slashed open and the guts spill out. | Is that... is that mine? | Quiet, shocked, slowing down. |
| 19 | `gutted_02.mp3` | Belly slashed open and the guts spill out. | Hold it in... hold it in... | Gasping, talking to himself. |
| 20 | `gutted_03.mp3` | Belly slashed open and the guts spill out. | (wet, choking scream) | Scream that breaks into coughing. |
| 21 | `heart_01.mp3` | You punch their heart out. | (sharp gasp, then silence) | One big gasp, cut off. |
| 22 | `heart_02.mp3` | You punch their heart out. | My... heart... | Barely a whisper, last words. |
| 23 | `die_01.mp3` | They die (not from fire, and not when the head comes off). | No... not like this... | Fading, slow. |
| 24 | `die_02.mp3` | They die (not from fire, and not when the head comes off). | (long death rattle) | Breath running out. |
| 25 | `die_03.mp3` | They die (not from fire, and not when the head comes off). | Tell my mom... | Weak, trailing off mid-sentence. |
| 26 | `die_04.mp3` | They die (not from fire, and not when the head comes off). | It's getting... cold... | Slow, quiet. |
| 27 | `burn_start_01.mp3` | They catch fire. | FIRE! I'M ON FIRE! | Shrieked. |
| 28 | `burn_start_02.mp3` | They catch fire. | Put it out! PUT IT OUT! | Frantic, high. |
| 29 | `burn_start_03.mp3` | They catch fire. | It burns! It burns! | Screamed, fast. |
| 30 | `burning_01.mp3` | Every so often while they burn. | (high, sustained scream) | Two to three seconds, no words. |
| 31 | `burning_02.mp3` | Every so often while they burn. | AAAH! HELP! HELP! | Panicked, running. |
| 32 | `burning_03.mp3` | Every so often while they burn. | Water! I need water! | Desperate. |
| 33 | `burn_die_01.mp3` | They die while on fire. | (scream that fades into a croak) | Ends weak and raspy. |
| 34 | `burn_die_02.mp3` | They die while on fire. | Can't... breathe... | Smoke-choked whisper. |
| 35 | `choke_01.mp3` | You grab them by the throat, and while you keep squeezing. | (gagging and spluttering) | Two to three seconds. |
| 36 | `choke_02.mp3` | You grab them by the throat, and while you keep squeezing. | Can't... let... go... | Strangled, forced out. |
| 37 | `choke_03.mp3` | You grab them by the throat, and while you keep squeezing. | (gasping for air) | Short desperate breaths. |
| 38 | `passout_01.mp3` | They pass out from being choked. | (weak gurgle, then a long breath out) | Going limp. |
| 39 | `passout_02.mp3` | They pass out from being choked. | Mmh... | Barely there, fading. |
| 40 | `wake_01.mp3` | They come round, ten seconds after passing out. | Ugh... what happened? | Groggy, confused. |
| 41 | `wake_02.mp3` | They come round, ten seconds after passing out. | My head... where am I? | Slow, dazed. |
| 42 | `grabbed_01.mp3` | You pick them up by anything other than the throat. | Hey! Put me down! | Indignant. |
| 43 | `grabbed_02.mp3` | You pick them up by anything other than the throat. | Let go of me! | Struggling. |
| 44 | `grabbed_03.mp3` | You pick them up by anything other than the throat. | Whoa whoa whoa! | Startled. |
| 45 | `attack_01.mp3` | A hostile dummy or zombie lands a hit on you. | (angry grunt) | Short effort sound, like swinging. |
| 46 | `attack_02.mp3` | A hostile dummy or zombie lands a hit on you. | Get over here! | Growled. |
| 47 | `attack_03.mp3` | A hostile dummy or zombie lands a hit on you. | You're mine! | Snarled. |
| 48 | `taunt_01.mp3` | A gunman hits you. | You can't hide forever! | Gunman, cocky. |
| 49 | `taunt_02.mp3` | A gunman hits you. | Missed me! | Gunman, mocking. |
| 50 | `bomber_01.mp3` | A bomber gets close and starts his countdown. | For the lab! | Bomber, shouted as he runs in. |
| 51 | `bomber_02.mp3` | A bomber gets close and starts his countdown. | See you in pieces! | Bomber, manic laugh after. |
