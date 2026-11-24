"use strict";

// ---------- Constants & key map ----------
const PX_PER_BEAT = 120;          // block height for one beat
const MAX_FRAME_SECONDS = 0.1;    // cap big jumps (e.g. after a hidden tab)
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// event.code is the PHYSICAL key, so this works on any layout.
const KEY_TO_PITCH = {
    KeyA: "C4", KeyW: "C#4", KeyS: "D4", KeyE: "D#4", KeyD: "E4",
    KeyF: "F4", KeyT: "F#4", KeyG: "G4", KeyY: "G#4", KeyH: "A4",
    KeyU: "A#4", KeyJ: "B4", KeyK: "C5", KeyO: "C#5", KeyL: "D5",
    KeyP: "D#5", Semicolon: "E5",
};

const $ = (id) => document.getElementById(id);
const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
};

// ---------- Pitch helpers ----------
function midiOf(pitch) {                       // "C#4" -> 61
    const octave = Number(pitch.slice(-1));
    return (octave + 1) * 12 + NAMES.indexOf(pitch.slice(0, -1));
}
const freqOf = (pitch) => 440 * 2 ** ((midiOf(pitch) - 69) / 12);

// ---------- Piano layout (derived from KEY_TO_PITCH) ----------
const PIANO = Object.entries(KEY_TO_PITCH)
    .map(([code, pitch]) => ({
        code, pitch,
        black: pitch.includes("#"),
        label: code === "Semicolon" ? ";" : code.replace("Key", ""),
    }))
    .sort((a, b) => midiOf(a.pitch) - midiOf(b.pitch));

let whiteCount = 0;
PIANO.forEach((key) => {                       // centre, measured in white-key widths
    key.center = key.black ? whiteCount : whiteCount + 0.5;
    if (!key.black) whiteCount++;
});
const UNIT = 100 / whiteCount;                 // % width of one white key
const KEY_BY_PITCH = Object.fromEntries(PIANO.map((k) => [k.pitch, k]));

function placeInColumn(el, key) {
    const width = key.black ? 0.6 : 1;
    el.style.left = `${(key.center - width / 2) * UNIT}%`;
    el.style.width = `${width * UNIT}%`;
}

// ---------- Sound ----------
let audio = null;
function ensureAudio() {                       // called from a user gesture
    audio ??= new AudioContext();
    if (audio.state === "suspended") audio.resume();
}

function playTone(pitch) {
    ensureAudio();
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.value = freqOf(pitch);
    gain.gain.setValueAtTime(0.0001, t);                    // short attack avoids clicks
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1);   // fade out
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 1.05);
}

// ---------- Game state ----------
const state = {
    mode: "menu",        // "menu" | "song" | "free" | "results"
    song: null,          // song with start beats
    blocks: [],
    nextIndex: 0,
    songBeat: 0,
    misses: 0,
    waiting: false,
    lastTime: null,
    rafId: null,
    hitY: 0,
};
const held = new Set();
const keyEls = {};

function withStartBeats(notes) {
    let beat = 0;
    return notes.map((note) => {
        const timed = { ...note, start: beat };
        beat += note.beats;
        return timed;
    });
}