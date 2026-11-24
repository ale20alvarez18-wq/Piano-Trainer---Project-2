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

// ---------- Screens ----------
function showScreen(name) {
    ["menu", "game", "results"].forEach((id) => { $(id).hidden = id !== name; });
}

function goMenu() {
    stopLoop();
    releaseAll();
    state.mode = "menu";
    showScreen("menu");
}

function buildMenu() {
    $("song-list").replaceChildren(...SONGS.map((song) => {
        const card = make("button", "song-card");
        card.append(
            make("b", "", song.title),
            make("span", "", `${song.composer} · ${song.notes.length} notes · ${song.bpm} bpm`),
        );
        card.addEventListener("click", () => startSong(song));
        return card;
    }));
}

// ---------- Keyboard UI ----------
function buildKeyboard() {
    let mouseKey = null;
    $("keyboard").replaceChildren(...PIANO.map((key) => {
        const el = make("div", `key ${key.black ? "black" : "white"}`, key.label);
        placeInColumn(el, key);
        el.addEventListener("pointerdown", (e) => { e.preventDefault(); mouseKey = key.pitch; pressKey(key.pitch); });
        const release = () => { if (mouseKey === key.pitch) { mouseKey = null; releaseKey(key.pitch); } };
        el.addEventListener("pointerup", release);
        el.addEventListener("pointerleave", release);
        el.addEventListener("pointercancel", release);
        keyEls[key.pitch] = el;
        return el;
    }));
}

function flashWrong(pitch) {
    const el = keyEls[pitch];
    el.classList.remove("wrong");
    void el.offsetWidth;                         // restart the animation
    el.classList.add("wrong");
}

function markTarget() {                        // highlights the key you must press next
    document.querySelectorAll(".key.target").forEach((el) => el.classList.remove("target"));
    const next = state.song?.notes[state.nextIndex];
    if (state.mode === "song" && next) keyEls[next.pitch].classList.add("target");
}

// ---------- Input: keyboard and mouse share pressKey() ----------
function pressKey(pitch) {
    if ((state.mode !== "song" && state.mode !== "free") || held.has(pitch)) return;
    held.add(pitch);
    keyEls[pitch].classList.add("down");
    playTone(pitch);
    if (state.mode === "song") judge(pitch);
}

function releaseKey(pitch) {
    held.delete(pitch);
    keyEls[pitch].classList.remove("down");
}

function releaseAll() { [...held].forEach(releaseKey); }

function judge(pitch) {
    if (pitch !== state.song.notes[state.nextIndex].pitch) {
        state.misses++;
        flashWrong(pitch);
        updateHud();
    } else if (state.waiting) {
        advance();
    }
}

function advance() {
    state.blocks[state.nextIndex].classList.add("hit");
    state.nextIndex++;
    setWaiting(false);
    updateHud();
    markTarget();
    if (state.nextIndex === state.song.notes.length) finishSong();
}

document.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const pitch = KEY_TO_PITCH[event.code];
    if (!pitch) return;
    event.preventDefault();
    pressKey(pitch);
});
document.addEventListener("keyup", (event) => {
    const pitch = KEY_TO_PITCH[event.code];
    if (pitch) releaseKey(pitch);
});
window.addEventListener("blur", releaseAll);   // no stuck keys when the tab loses focus

// ---------- Animation loop ----------
function setWaiting(value) {
    if (state.waiting === value) return;
    state.waiting = value;
    $("stage").classList.toggle("waiting", value);
}

function frame(now) {
    if (state.lastTime !== null) {
        const seconds = Math.min((now - state.lastTime) / 1000, MAX_FRAME_SECONDS);
        state.songBeat += seconds * (state.song.bpm / 60);
        const next = state.song.notes[state.nextIndex];
        if (next && state.songBeat >= next.start) {   // wait at the line
            state.songBeat = next.start;
            setWaiting(true);
        }
    }
    state.lastTime = now;
    draw();
    state.rafId = requestAnimationFrame(frame);
}

function draw() {                                // only transforms: blocks are created once
    state.song.notes.forEach((note, i) => {
        const bottom = state.hitY - (note.start - state.songBeat) * PX_PER_BEAT;
        state.blocks[i].style.transform = `translateY(${bottom - note.beats * PX_PER_BEAT}px)`;
    });
}

function stopLoop() {
    cancelAnimationFrame(state.rafId);             // never two loops at once
    state.rafId = null;
}

function measureStage() {
    state.hitY = $("lane").clientHeight;
    if (state.mode === "song") draw();
}
window.addEventListener("resize", measureStage);