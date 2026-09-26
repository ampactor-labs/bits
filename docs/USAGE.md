# Using BITS

Detail behind the README's [Usage](../README.md#usage) section: every puppet
tool, the effects, body passes and how people work together.

## Puppet tools

Tap a puppet to select it. Its tools appear in a bar above it, or below it
when there is no room above.

- **Snip**: draw a line across a puppet and the side away from its centre
  splits off. The piece hangs from the line's midpoint like a paper-doll
  joint and swings with the motion. A pass can grab the piece itself.
- **Mouth**: flaps with the voice track. A puppet with no passes talks all
  the time. Once it has passes, it talks only while one of them covers the
  moment. This is the talker rule: holding a puppet is how you say who is
  speaking.
- **Eyes**: googly eyes whose pupils lag the motion.
- **Pin**: bends an uncut photo puppet around the pins, and a pass can drag
  a pin. A puppet takes pins or snips, never both.
- **Flip**: mirrors the puppet.
- **More**: name, size, spring feel (paper, felt or rubber), wires, a voice
  take of the puppet's own, the hand that drives it in a body pass, duplicate
  and layer order.

A long press selects a puppet with a short buzz and keeps hold of it, so the
same press can go on to drag it.

## Wires, foley and boil

Wires make a puppet bounce, shake or lean with the voice track, or bounce and
shake on the beat grid, at gentle or wild strength. The beat grid is the set
of onsets (sudden rises in loudness) found in the sound, and the timeline
shows them as ticks.

The bit's menu adds ghost trails behind motion and foley (sound effects) on
hard landings. While recording, a foley board plays five synthesized sounds
into the pass: boing, slap, honk, scratch and drop. They land in the recipe,
so the film mixes the same samples.

Doodles and words boil: their lines jitter eight times a second, like
hand-drawn animation. The jitter comes from the bit's seed, so it replays the
same way every time.

## Body passes

A body pass drives puppets with your wrists. Assign a hand to a puppet under
More, then record: MediaPipe pose tracking on the front camera moves it, with
a camera preview in the corner. The result is stored as an ordinary pass. The
pose model is 5.8 MB and downloads on first use.

## Collaboration

There is no server, so people collaborate by sharing a phone or a file.

On one phone, the sound is recorded together and passes are performed one
player at a time. The talker rule makes hand-offs read as dialogue. A body
pass gives two hands to two puppets, one player can work the foley board
while another drags, and perform mode shows the stage and nothing else.
Blind recording hides the earlier passes while you record, and the whole show
appears on playback. It works like the exquisite-corpse drawing game, where
each player adds a part without seeing the rest.

Across phones, the unit is the bit file. "send the bit" exports one
`.bit.json` file holding the recipe and every asset it uses. The receiver
opens it with "open a bit file" on the bits list, or from the share sheet on
an installed copy, which registers as a share target. It arrives as the full
working show, credited as a remix of the original, ready to re-perform.
Import copies the assets under fresh ids, so deleting either bit never
breaks the other. A bit whose sound went missing still opens and offers to
record it again.

Films leave as mp4 files through the share sheet, or as a download where the
browser cannot share files.

Nothing merges. Two people editing the same bit on two phones end up with two
bits.
