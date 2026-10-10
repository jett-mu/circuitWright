# Gatewright

Design, simulate, understand. Gatewright is a browser sandbox for building logic circuits: drag parts onto a canvas, wire them together, and watch the signals propagate. It is a plain static site (HTML, CSS and ES modules) with no build step and no dependencies.

Source: https://github.com/jett-mu/logicGated

## Running it

ES modules do not load from `file://`, so serve the folder over http:

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Publishing on GitHub Pages

1. Push the repository to GitHub.
2. In Settings, Pages, choose "Deploy from a branch", branch `main`, folder `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`.

All paths are relative, so it works from a project subpath. The only external request is the Google Fonts import at the top of `styles.css`; offline the app falls back to system fonts.

## What it does

- Parts: switch, push button, clock (0.05 to 30 Hz), number pad, AND, OR, XOR, NAND, NOR, XNOR, NOT, BUFFER, lightbulb, display, and free wires.
- Number pads and displays are configurable: 1 to 8 bits, binary, decimal or hex, and a selectable range on pads.
- Wires can be open ended. Dropping a part on a wire splices it in.
- Undo and redo, autosave to localStorage, and save/open as JSON.
- Gate level export to PNG or SVG, with a live preview and options for curved or straight wires, terminals instead of widgets, and deactivated inputs.
- Transistor level export (CMOS MOSFET or BJT NPN RTL) as a real schematic with hop-over arcs and junction dots.
- Relay export: every gate built from 5-terminal changeover relays (1-2 coil, 3 normally open, 4 common, 5 normally closed) powered from one wired DC source, with optional flyback diodes across every coil and an optional red / blue power rail colouring (beta) that works for every technology.

## Code layout

```
index.html        page shell, toolbar, dialogs
styles.css        LATCH design system (tokens and components)
css/style.css     app layout built on the design system
js/
  model.js        part catalogue, Circuit class, pin geometry
  sim.js          logic simulation
  render.js       SVG drawing of parts and wires
  main.js         interaction, history, inspector, clocks, dialogs
  storage.js      localStorage autosave and JSON file save/open
  examples.js     starter circuits
  export.js       gate level PNG/SVG export and shared rasterizer
  exportview.js   export-time substitutions (terminals, inputs off)
  orthowires.js   straight, separated wire routing for the export
  netlist.js      gates reduced to NOT / NAND2 / NOR2 stages
  cells.js        transistor cells per technology
  symbols.js      MOSFET, BJT, resistor, supply and ground symbols
  schematic.js    placement, routing and SVG for the transistor export
```

### Data model (`js/model.js`)

`DEFS` is the part catalogue: label, palette group, size, and pin counts. Some parts change shape per instance, so geometry always goes through `dims(component)`, which accounts for number pad range and bit count, display width, and so on. `localPin` and `pinPos` give pin coordinates; inputs sit on the left edge and outputs on the right, spaced evenly.

A `Circuit` holds `components` and `wires`:

```json
{
  "app": "gatewright",
  "version": 1,
  "components": [{ "id": 1, "type": "switch", "x": 60, "y": 60, "state": { "on": false } }],
  "wires": [{ "id": 3, "from": { "c": 1, "p": 0 }, "to": { "c": 2, "p": 0 } }]
}
```

A wire end is either a pin `{c, p}` or a free point `{x, y}`, which is how open ended wires are stored. An input pin accepts one wire; outputs fan out freely. Pin 0 on number pads and displays is the most significant bit, so `configure()` shifts wires when the bit count changes and new bits appear at the top.

### Simulation (`js/sim.js`)

`simulate(circuit, out)` is a fixed point evaluation. `out` maps `"componentId:pin"` to 0 or 1 and is reused between calls, which is what lets feedback circuits such as an SR latch hold state. Each pass walks the components in order, updating outputs in place, until nothing changes or 100 passes elapse. Only fully pinned wires carry signal. Unconnected inputs read 0.

### Rendering and interaction

`render.js` builds SVG with a small `el()` helper. Colors come from CSS variables (`--ink`, `--on`, `--off` and friends), so the same markup themes the live canvas and the print exports. `main.js` uses pointer events on the SVG and event delegation through `data-*` attributes (`data-pin`, `data-ctl`, `data-comp`, `data-wire`). The canvas is redrawn from the model after each change.

Undo works on snapshots of the circuit, recorded whenever structure changes (parts, positions, bits, wires). Runtime values such as switch states are deliberately not part of history.

### Clocks

Each clock keeps a phase in the range 0 to 2 (low half, then high half). Its level is derived from elapsed time rather than accumulated toggles, so fast clocks do not drift and several clocks stay aligned. The phase is written into the saved state, so a reopened project resumes with every clock in sync. Examples always start from phase 0.

### Gate level export (`export.js`, `exportview.js`, `orthowires.js`)

`exportView` derives the circuit that is actually drawn: it can replace inputs and outputs with one terminal per bit, or recompute signals with every input low. `routeOrtho` assigns each net a vertical trunk and slides trunks and lanes sideways so different nets keep at least `MIN_GAP` apart, which is 1.5 times the hop diameter. `wirePrims` then adds hop arcs where nets cross and dots where three or more directions of one net meet.

### Transistor level export (`netlist.js`, `cells.js`, `schematic.js`)

1. `buildNetlist` reduces every gate to `not`, `nand2` and `nor2` stages (AND is NAND plus NOT, XOR is four NANDs, and so on) and collects input and output terminals.
2. `cells.js` provides a hand drawn cell for each stage in CMOS, BJT NPN RTL or relay form.
3. `layoutSchematic` assigns stages to columns by logic depth, orders rows by barycenter, and routes every net on unique tracks, using a lane above the cells for nets that skip columns.
4. `wirePrims` resolves crossings and junctions, and `renderSchematic` emits the SVG with a title block.

Because the output is plain SVG text with no DOM use, it can be run and checked from Node.

## Styling

`styles.css` is the LATCH design system: a light, matte, square cornered palette with hard offset shadows, using Chakra Petch and IBM Plex Mono. `css/style.css` only adds app layout on top of its tokens. The fonts are self-hosted in `fonts/` (SIL Open Font License, texts included), so the app makes no third party requests.

## Disclaimer and safety

Gatewright is an educational tool. The software and every schematic, netlist or image it produces are provided "as is", without warranty of any kind (see `LICENCE.md`). Generated circuits, especially the transistor level export, are not verified, not checked against real component ratings, and have no protection circuitry. Do not use them for mains voltage, high current, batteries, or any safety critical purpose. Check every design yourself before you build it. You build and use anything made with this tool at your own risk, and the author is not liable for injury, property damage or any other loss.

## Notes and limits

- XOR and XNOR expand to four NAND stages in the transistor export, so they are larger than a dedicated XOR cell.
- Open ended wires are ignored by the transistor export.
- Straight wire routing does not route around parts; it separates wires from each other.

&copy; 2026 Jett Mu
