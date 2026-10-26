/* ============ music.js — game music scores ============
 * Composed for this game (not Nintendo themes). Played by the
 * core/audio.js synthesizer.
 *
 * melody: bars such as "A4:4 C5:2 -:2" — note:duration in sixteenth notes
 *         (16 per bar), "-" = rest.
 * parts:  generated from `chords` with a 16-character pattern per bar:
 *           R root (chord bass with useBass) · F fifth · O octave · T third
 *           0-5 chord notes (0 root, 1 third, 2 fifth, 3 octave...)
 *           C full chord · "-" extend previous note · "." rest
 * drums:  X loud · x medium · o soft · . none
 */
G.MUSIC = {
  // ---------------- Menu: a quiet village ----------------
  village: {
    bpm: 100, swing: 0.18,
    chords: ['F', 'C/E', 'Dm', 'Bb', 'F', 'C', 'Bb', 'C',
             'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'F'],
    melody: [{ inst: 'flute', vel: 1, bars: [
      'A4:4 C5:2 A4:2 G4:4 F4:4', 'G4:6 A4:2 C5:4 -:4', 'D5:4 C5:2 A4:2 F4:4 A4:4', 'G4:12 -:4',
      'A4:4 C5:2 F5:2 E5:4 D5:4', 'C5:6 A4:2 G4:4 E4:4', 'F4:4 G4:2 A4:2 D5:4 C5:4', 'C5:12 -:4',
      'D5:2 D5:2 F5:4 D5:4 Bb4:4', 'C5:2 C5:2 E5:4 G5:4 E5:4', 'A5:6 G5:2 E5:4 C5:4', 'D5:8 C5:4 A4:4',
      'Bb4:4 D5:4 G5:4 F5:2 D5:2', 'E5:4 G5:2 E5:2 C5:4 Bb4:4', 'A4:4 C5:4 F5:6 E5:2', 'F5:12 -:4'] }],
    parts: [
      { inst: 'bass', octave: 2, useBass: true, vel: 0.9, pattern: 'R--F--O-R--F--T-' },
      { inst: 'bell', octave: 4, vel: 0.5, pattern: '0.1.2.1.3.2.1.2.' },
      { inst: 'pad', octave: 3, vel: 0.9, pattern: 'C---------------' }
    ],
    drums: { kick: 'x.......x.......', snare: '....o.......o...', shaker: 'o.x.o.x.o.x.o.x.' }
  },

  // ---------------- Run: Shadow Forest ----------------
  forest: {
    bpm: 122,
    chords: ['Dm', 'C', 'Bb', 'A', 'Dm', 'C', 'Bb', 'A',
             'Bb', 'C', 'Dm', 'Dm', 'Bb', 'C', 'A', 'A'],
    melody: [{ inst: 'flute', vel: 1, bars: [
      'D5:3 E5:1 F5:4 A5:4 G5:2 F5:2', 'E5:6 D5:2 C5:4 E5:4', 'F5:4 D5:4 Bb4:4 D5:4', 'C#5:8 E5:4 A4:4',
      'D5:2 F5:2 A5:4 D6:4 C6:2 A5:2', 'G5:4 E5:4 C5:4 E5:4', 'F5:3 G5:1 F5:4 D5:4 Bb4:4', 'A4:4 C#5:4 E5:4 A5:4',
      'D5:8 F5:8', 'E5:8 G5:8', 'A5:12 F5:4', 'D5:16',
      'F5:4 E5:4 D5:4 C5:4', 'E5:4 D5:4 C5:4 G4:4', 'A4:8 C#5:8', 'E5:16'] }],
    parts: [
      { inst: 'bass', octave: 2, vel: 0.9, pattern: 'R.R.R.R.F.F.O.F.' },
      { inst: 'pluck', octave: 4, vel: 0.6, pattern: '0.2.1.2.3.2.1.2.' },
      { inst: 'pad', octave: 3, vel: 0.6, pattern: 'C-------C-------' }
    ],
    drums: { kick: 'X.....x.X.......', snare: '....X.......X...', hat: 'x.o.x.o.x.o.x.o.' }
  },

  // ---------------- Run: Crystal Cave ----------------
  cave: {
    bpm: 92, swing: 0.1,
    chords: ['Am', 'F', 'G', 'Em', 'Am', 'F', 'Dm', 'E',
             'F', 'G', 'Em', 'Am', 'Dm', 'Em', 'F', 'E'],
    melody: [{ inst: 'flute', vel: 0.85, bars: [
      'E5:6 A5:2 G5:4 E5:4', 'F5:8 C5:4 A4:4', 'D5:6 G5:2 F5:4 D5:4', 'E5:12 -:4',
      'C6:4 B5:2 A5:2 E5:4 C5:4', 'A5:6 G5:2 F5:4 C5:4', 'D5:4 F5:4 A5:4 G5:2 F5:2', 'E5:4 G#5:4 B5:8',
      'A5:4 C6:4 A5:4 F5:4', 'B5:4 D6:4 B5:4 G5:4', 'G5:6 E5:2 B4:8', 'C5:4 E5:4 A5:8',
      'F5:4 A5:4 D6:4 C6:4', 'B5:6 G5:2 E5:8', 'A5:4 G5:4 F5:4 E5:4', 'E5:8 -:8'] }],
    parts: [
      { inst: 'bell', octave: 4, vel: 0.5, pattern: '0.2.4.2.3.2.4.2.' },
      { inst: 'bass', octave: 2, vel: 0.8, pattern: 'R-------F-------' },
      { inst: 'pad', octave: 3, vel: 1, pattern: 'C---------------' }
    ],
    drums: { kick: 'o.......o.......', hat: '..o...o...o...o.' }
  },

  // ---------------- Run: Ashen Volcano ----------------
  volcano: {
    bpm: 132,
    chords: ['Em', 'F', 'Em', 'D', 'Em', 'F', 'G', 'F'],
    melody: [{ inst: 'lead', vel: 0.9, bars: [
      'E5:2 -:2 E5:2 F5:2 G5:4 F5:2 E5:2', 'F5:2 -:2 F5:2 G5:2 A5:4 G5:2 F5:2',
      'G5:4 B5:4 A5:2 G5:2 F5:2 E5:2', 'D5:8 F#5:4 A5:4',
      'B5:4 A5:2 G5:2 E5:4 G5:4', 'C6:4 B5:2 A5:2 F5:4 A5:4',
      'B5:2 D6:2 B5:2 G5:2 D5:4 G5:4', 'A5:4 G5:4 F5:4 E5:4'] }],
    parts: [
      { inst: 'bass', octave: 2, vel: 1, pattern: 'R.R.R.R.R.R.F.O.' },
      { inst: 'pluck', octave: 3, vel: 0.5, pattern: '0.0.1.0.2.0.1.0.' },
      { inst: 'pad', octave: 3, vel: 0.5, pattern: 'C-------C-------' }
    ],
    drums: { kick: 'X..x..X.X..x..X.', snare: '....X.......X..x', hat: 'xoxoxoxoxoxoxoxo' }
  },

  // ---------------- Boss battle ----------------
  boss: {
    bpm: 150,
    chords: ['Em', 'C', 'D', 'B', 'Em', 'C', 'D', 'B'],
    melody: [{ inst: 'lead', vel: 1, bars: [
      'E5:2 E5:2 G5:2 E5:2 B5:4 A5:2 G5:2', 'E5:2 E5:2 G5:2 E5:2 C6:4 B5:2 A5:2',
      'F#5:4 A5:4 D6:4 C6:2 B5:2', 'D#5:8 F#5:4 B5:4',
      'G5:2 F#5:2 E5:2 F#5:2 G5:4 B5:4', 'A5:2 G5:2 E5:2 G5:2 A5:4 C6:4',
      'B5:4 A5:4 F#5:4 D5:4', 'D#5:4 F#5:4 A5:4 B5:4'] }],
    parts: [
      { inst: 'bass', octave: 2, vel: 1, pattern: 'R.RR.RR.R.RR.RF.' },
      { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.1.2.1.0.1.2.3.' }
    ],
    drums: { kick: 'X.x.X.x.X.x.X.x.', snare: '....X.......X.X.', hat: 'oooooooooooooooo' }
  }
};

// Added outside the object to avoid modifying the other tracks.
/* ---------------- Rift: legendary duel ----------------
 * Faster and more tense than the boss theme: A minor, galloping bass, and the
 * melody rising to the upper octave in the second half. */
G.MUSIC.rift = {
  bpm: 164,
  chords: ['Am', 'F', 'G', 'E', 'Am', 'F', 'Dm', 'E',
           'F', 'G', 'Am', 'Am', 'Dm', 'E', 'Am', 'E'],
  melody: [{ inst: 'lead', vel: 1, bars: [
    'A5:2 C6:2 E6:4 D6:2 C6:2 B5:4', 'A5:2 F5:2 A5:4 C6:4 F6:4',
    'G5:2 B5:2 D6:4 C6:2 B5:2 G5:4', 'G#5:8 B5:4 E6:4',
    'A5:2 A5:2 C6:2 A5:2 E6:4 D6:2 C6:2', 'F6:4 E6:2 D6:2 C6:4 A5:4',
    'D6:4 C6:2 A5:2 F5:4 A5:4', 'G#5:4 B5:4 D6:4 E6:4',
    'F6:2 E6:2 C6:4 A5:4 C6:4', 'G6:2 F6:2 D6:4 B5:4 D6:4',
    'E6:4 C6:2 A5:2 E6:4 A6:4', 'A6:12 -:4',
    'F6:4 D6:2 A5:2 F6:4 E6:2 D6:2', 'E6:2 G#6:2 B6:4 G#6:4 E6:4',
    'A6:4 E6:2 C6:2 A5:4 C6:4', 'B5:4 G#5:4 E5:4 -:4'] }],
  parts: [
    { inst: 'bass', octave: 2, vel: 1, pattern: 'R.RRR.RRF.FFO.OF' },
    { inst: 'pluck', octave: 4, vel: 0.5, pattern: '0.2.3.2.1.2.3.4.' },
    { inst: 'pad', octave: 3, vel: 0.55, pattern: 'C-------C-------' }
  ],
  drums: { kick: 'X.x.X.x.X.x.X.xx', snare: '....X.......X..X', hat: 'xoxoxoxoxoxoxoxo' }
};

/* ---------------- Arceus Judgment (minute 30) ----------------
 * Solemn and inescapable: D minor with an E-flat (Phrygian) for a darker feel,
 * low bells on every bar, and the melody rising through to the end. */
G.MUSIC.judgment = {
  bpm: 140,
  chords: ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Eb', 'C', 'A',
           'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A', 'Dm', 'A'],
  melody: [{ inst: 'lead', vel: 1, bars: [
    'D5:4 F5:4 A5:6 G5:2', 'F5:4 D5:4 Bb4:8',
    'G5:4 Bb5:4 D6:4 C6:2 Bb5:2', 'A5:8 C#6:4 E6:4',
    'D6:6 C6:2 A5:4 F5:4', 'G5:4 Eb5:4 G5:4 Bb5:4',
    'C6:4 E5:2 G5:2 C6:4 E6:4', 'C#6:12 -:4',
    'D6:2 D6:2 F6:4 D6:4 Bb5:4', 'C6:2 C6:2 E6:4 C6:4 G5:4',
    'A5:4 D6:4 F6:4 E6:2 D6:2', 'D6:12 -:4',
    'Bb5:4 D6:4 G6:4 F6:2 D6:2', 'E6:4 C#6:4 A5:4 E6:4',
    'F6:4 E6:2 D6:2 A5:4 F5:4', 'E5:4 A5:4 C#6:4 E6:4'] }],
  parts: [
    { inst: 'bass', octave: 2, vel: 1, pattern: 'R.RRR.RRR.RRF.OF' },
    { inst: 'bell', octave: 4, vel: 0.6, pattern: '0.......2.......' },
    { inst: 'pad', octave: 3, vel: 0.8, pattern: 'C---------------' }
  ],
  drums: { kick: 'X..xX..xX..xX.xx', snare: '....X.......X..X', hat: 'x.x.x.x.x.x.x.x.' }
};

/** Track for each biome during a run. */
G.BIOME_MUSIC = ['forest', 'cave', 'volcano'];
